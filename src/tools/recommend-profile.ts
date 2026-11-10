import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { recommendProfile } from "../profile-engine.js";
import { parseStl } from "../stl-parser.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import type { MeshAnalysis } from "../types.js";

export function registerRecommendProfile(server: McpServer) {
  server.registerTool(
    "recommend_profile",
    {
      title: "Recommend a print profile",
      description:
        "Generates a complete print profile with a reason for every setting. " +
        "Takes the goal (draft, quality, strong...), the nozzle, the material " +
        "and, optionally, a mesh analysis into account.",
      inputSchema: {
        printer: z
          .string()
          .default("Generic")
          .describe("Printer name (e.g. MK4S, MINI, CR30, Ender3)"),
        nozzle: z
          .number()
          .default(0.4)
          .describe("Nozzle diameter in mm (e.g. 0.4, 0.6, 0.8, 1.0)"),
        goal: z
          .string()
          .describe(
            "Print goal: 'draft', 'standard', 'quality', 'strong', 'vase' or 'speed'. " +
            "Aliases such as 'fast', 'fine', 'robust', 'spiral' and the French 'prototype rapide', " +
            "'beau rendu', 'production solide' also work; anything else falls back to 'standard'"
          ),
        material: z
          .string()
          .default("PLA")
          .describe("Material: PLA, PETG, ABS, ASA, TPU, NYLON, PC"),
        stl_path: z
          .string()
          .optional()
          .describe("Optional path to an STL for automatic analysis (overhangs, details, size)"),
      },
      annotations: {
        title: "Recommend a print profile",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ printer, nozzle, goal, material, stl_path }) => {
      try {
        // Optional mesh analysis
        let meshAnalysis: MeshAnalysis | undefined;
        if (stl_path && existsSync(stl_path)) {
          console.error(`[recommend_profile] Analyzing mesh: ${stl_path}`);
          const stl = await parseStl(stl_path);
          meshAnalysis = analyzeMesh(stl);
          console.error(`[recommend_profile] Mesh: ${meshAnalysis.triangleCount} tris, ${meshAnalysis.overhangPercent.toFixed(1)}% overhangs`);
        }

        const profile = recommendProfile(printer, nozzle, goal, material, meshAnalysis);

        // Format output
        const lines = [
          `## Recommended profile`,
          `**Printer**: ${profile.printer} | **Nozzle**: ${profile.nozzle}mm | **Material**: ${profile.material}`,
          `**Goal**: ${profile.goal}`,
          "",
        ];

        // Settings with justifications
        const categories: Record<string, string[]> = {
          "Layers & dimensions": ["layer_height", "line_width"],
          "Walls & infill": ["perimeters", "infill_density", "fill_pattern"],
          "Temperatures": ["nozzle_temperature", "first_layer_nozzle_temperature", "bed_temperature", "first_layer_bed_temperature"],
          "Speed & flow": ["print_speed", "travel_speed", "first_layer_speed", "max_volumetric_speed"],
          "Supports & adhesion": ["support_material", "support_material_style", "support_material_contact_distance", "brim_width"],
          "Cooling": ["fan_speed", "min_fan_speed", "bridge_fan_speed", "min_layer_time"],
          "Retraction & extrusion": ["retraction_length", "retraction_speed", "extrusion_multiplier"],
          "Motion": ["acceleration"],
        };

        for (const [category, keys] of Object.entries(categories)) {
          lines.push(`### ${category}`);
          for (const key of keys) {
            const setting = profile.settings[key as keyof typeof profile.settings];
            if (setting) {
              const displayKey = key.replace(/_/g, " ");
              lines.push(`- **${displayKey}**: \`${setting.value}\``);
              lines.push(`  _${setting.reason}_`);
            }
          }
          lines.push("");
        }

        // Warnings
        if (profile.warnings.length > 0) {
          lines.push("### Warnings");
          for (const w of profile.warnings) {
            lines.push(`- ⚠ ${w}`);
          }
          lines.push("");
        }

        // Mesh context if available
        if (meshAnalysis) {
          const bb = meshAnalysis.boundingBox;
          lines.push("### Mesh context");
          lines.push(`- Dimensions: ${bb.size.x.toFixed(1)} × ${bb.size.y.toFixed(1)} × ${bb.size.z.toFixed(1)} mm`);
          lines.push(`- Volume: ${(meshAnalysis.volume / 1000).toFixed(2)} cm³`);
          lines.push(`- Overhangs: ${meshAnalysis.overhangPercent.toFixed(1)}%`);
          lines.push(`- Manifold: ${meshAnalysis.isManifold ? "Yes" : "No"}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Recommendation error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
