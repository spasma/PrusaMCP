import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { parseModel } from "./analyze-mesh.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import { detectPrintIssues } from "../print-issues.js";
import { suggestOrientation } from "../orientation.js";
import { recommendProfile } from "../profile-engine.js";
import { estimateCostFromMesh } from "../cost-estimator.js";
import { profileToIniSettings, serializeIni } from "../ini-writer.js";

export function registerPrintWizard(server: McpServer) {
  server.registerTool(
    "print_wizard",
    {
      title: "Print wizard",
      description:
        "Full analysis of a 3D model with recommendations. " +
        "Returns: mesh analysis, detected issues, best orientation, " +
        "recommended profile, cost estimate, and questions to ask the user " +
        "to refine the settings. A good entry point for a new print.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to the STL or 3MF file"),
        printer: z.string().optional().describe("Printer (if known)"),
        nozzle: z.number().optional().describe("Nozzle diameter in mm (if known)"),
        material: z.string().optional().describe("Material (if known)"),
        goal: z.string().optional().describe(
          "Print goal (if known): 'draft', 'standard', 'quality', 'strong', 'vase' or 'speed'; " +
          "accepts the same aliases as recommend_profile"
        ),
      },
      annotations: {
        title: "Print wizard",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path, printer, nozzle, material, goal }) => {
      try {
        if (!existsSync(file_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `File not found: ${file_path}` }],
          };
        }

        console.error(`[print_wizard] Full analysis of ${file_path}...`);
        const mesh = await parseModel(file_path);
        const analysis = analyzeMesh(mesh);
        const issues = detectPrintIssues(mesh.triangles, analysis, nozzle ?? 0.4);
        const orientations = suggestOrientation(mesh);
        const bestOrientation = orientations[0];

        const bb = analysis.boundingBox;
        const lines: string[] = [];

        // ─── Section 1: Mesh analysis ─────────────────
        lines.push("## 1. Model analysis");
        lines.push(`- **Dimensions**: ${bb.size.x.toFixed(1)} × ${bb.size.y.toFixed(1)} × ${bb.size.z.toFixed(1)} mm`);
        lines.push(`- **Volume**: ${(analysis.volume / 1000).toFixed(2)} cm³`);
        lines.push(`- **Triangles**: ${analysis.triangleCount.toLocaleString()}`);
        lines.push(`- **Manifold**: ${analysis.isManifold ? "OK" : "NO (repair needed)"}`);
        lines.push("");

        // ─── Section 2: Printability ──────────────────
        lines.push(`## 2. Printability: ${issues.score}/100`);
        lines.push(`_${issues.summary}_`);
        if (issues.issues.length > 0) {
          for (const issue of issues.issues) {
            const icon = issue.severity === "error" ? "ERROR" : issue.severity === "warning" ? "WARNING" : "INFO";
            lines.push(`- **[${icon}] ${issue.category}**: ${issue.message}`);
          }
        }
        lines.push("");

        // ─── Section 3: Orientation ───────────────────
        lines.push("## 3. Recommended orientation");
        lines.push(`**${bestOrientation.name}** (score ${bestOrientation.score}/100)`);
        lines.push(`- Overhangs: ${bestOrientation.overhangPercent.toFixed(1)}% | Height: ${bestOrientation.printHeight.toFixed(1)}mm | Bed contact: ${bestOrientation.bedContact.toFixed(1)}mm²`);
        if (bestOrientation.rotation.axisX !== 0 || bestOrientation.rotation.axisY !== 0) {
          lines.push(`- _Rotation: X=${bestOrientation.rotation.axisX}° Y=${bestOrientation.rotation.axisY}°_`);
        }
        lines.push("");

        // ─── Section 4: Profile, when enough info is given ──
        if (goal) {
          const p = printer ?? "Generic";
          const n = nozzle ?? 0.4;
          const m = material ?? "PLA";
          const profile = recommendProfile(p, n, goal, m, analysis);

          lines.push(`## 4. Recommended profile (${profile.goal})`);
          const keySettings = [
            `Layer: ${profile.settings.layer_height.value}mm`,
            `Speed: ${profile.settings.print_speed.value}mm/s`,
            `MVS: ${profile.settings.max_volumetric_speed.value}mm³/s`,
            `Infill: ${profile.settings.infill_density.value}%`,
            `Perimeters: ${profile.settings.perimeters.value}`,
            `Nozzle: ${profile.settings.nozzle_temperature.value}°C`,
            `Bed: ${profile.settings.bed_temperature.value}°C`,
            `Supports: ${profile.settings.support_material.value ? "Yes" : "No"}`,
          ];
          lines.push(keySettings.join(" | "));

          // Cost estimate
          const cost = estimateCostFromMesh(
            analysis,
            profile.settings.layer_height.value as number,
            profile.settings.infill_density.value as number,
            profile.settings.perimeters.value as number,
            profile.settings.print_speed.value as number,
            m,
          );
          lines.push(`**Estimated time**: ${cost.printTimeFormatted} | **Cost**: ~€${cost.totalCostEur} (${cost.filamentWeightG}g of filament)`);
          lines.push("");
        }

        // ─── Section 5: Multiple-choice questions ─────
        lines.push("## 5. Questions to refine the settings");
        lines.push("_To tune the settings, ask the user:_");
        lines.push("");

        // Dynamic questions based on the analysis
        const questions: Array<{ question: string; options: string[] }> = [];

        if (!goal) {
          questions.push({
            question: "What is the goal of this print?",
            options: [
              "Quick prototype (fast, quality secondary)",
              "Standard (good balance of quality and time)",
              "High quality (clean finish, fine detail)",
              "Strong / structural (mechanical strength)",
              "As fast as possible",
            ],
          });
        }

        if (!material) {
          questions.push({
            question: "Which material will you use?",
            options: ["PLA", "PETG", "ABS", "TPU (flexible)", "Other"],
          });
        }

        if (analysis.overhangPercent > 5) {
          questions.push({
            question: `The model has ${analysis.overhangPercent.toFixed(0)}% overhangs. Do you want supports?`,
            options: [
              "Yes, supports everywhere",
              "Yes, only where needed",
              "No, try without (risky)",
              "Reorient the part to avoid supports",
            ],
          });
        }

        if (bb.size.z > 2 * Math.max(bb.size.x, bb.size.y) || analysis.overhangPercent < 2) {
          questions.push({
            question: "Do you want a brim for bed adhesion?",
            options: [
              "Yes, 5mm brim (recommended for this part)",
              "No brim",
              "Full raft (maximum adhesion)",
            ],
          });
        }

        if (!nozzle) {
          questions.push({
            question: "Which nozzle is installed on your printer?",
            options: ["0.4mm (standard)", "0.5mm", "0.6mm", "0.8mm", "1.0mm"],
          });
        }

        for (const q of questions) {
          lines.push(`**${q.question}**`);
          for (let i = 0; i < q.options.length; i++) {
            lines.push(`  ${i + 1}. ${q.options[i]}`);
          }
          lines.push("");
        }

        if (questions.length === 0) {
          lines.push("_All required information is available. Ready to generate the config._");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Wizard error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
