import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { parseModel } from "./analyze-mesh.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import { detectPrintIssues } from "../print-issues.js";

export function registerCheckPrintability(server: McpServer) {
  server.registerTool(
    "check_printability",
    {
      title: "Check model printability",
      description:
        "Analyzes a 3D model (STL/3MF) for print problems: " +
        "walls too thin, bridges too long, overhangs, non-manifold mesh, stability and more. " +
        "Returns a printability score and recommendations.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to the STL or 3MF file"),
        nozzle_diameter: z
          .number()
          .default(0.4)
          .describe("Nozzle diameter in mm (used to calibrate the thresholds)"),
      },
      annotations: {
        title: "Check model printability",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path, nozzle_diameter }) => {
      try {
        if (!existsSync(file_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `File not found: ${file_path}` }],
          };
        }

        console.error(`[check_printability] Analyzing ${file_path}...`);
        const mesh = await parseModel(file_path);
        const analysis = analyzeMesh(mesh);
        const report = detectPrintIssues(mesh.triangles, analysis, nozzle_diameter);

        const lines: string[] = [
          `## Printability report`,
          `**Score**: ${report.score}/100`,
          `**Verdict**: ${report.summary}`,
          `**Nozzle**: ${nozzle_diameter}mm`,
          "",
        ];

        if (report.issues.length === 0) {
          lines.push("No problems found. The part is ready to print.");
        } else {
          // Group by severity
          const errors = report.issues.filter((i) => i.severity === "error");
          const warnings = report.issues.filter((i) => i.severity === "warning");
          const infos = report.issues.filter((i) => i.severity === "info");

          if (errors.length > 0) {
            lines.push("### Critical errors");
            for (const issue of errors) {
              lines.push(`- **[${issue.category}]** ${issue.message}`);
              if (issue.detail) lines.push(`  _${issue.detail}_`);
            }
            lines.push("");
          }

          if (warnings.length > 0) {
            lines.push("### Warnings");
            for (const issue of warnings) {
              lines.push(`- **[${issue.category}]** ${issue.message}`);
              if (issue.detail) lines.push(`  _${issue.detail}_`);
            }
            lines.push("");
          }

          if (infos.length > 0) {
            lines.push("### Info");
            for (const issue of infos) {
              lines.push(`- **[${issue.category}]** ${issue.message}`);
              if (issue.detail) lines.push(`  _${issue.detail}_`);
              if (issue.bibleFdmRef) lines.push(`  _FDM Bible: ${issue.bibleFdmRef}_`);
            }
          }
        }

        // FDM Bible diagnostic hints
        if (report.diagnosticHints && report.diagnosticHints.length > 0) {
          lines.push("");
          lines.push("### FDM Bible diagnostics");
          for (const hint of report.diagnosticHints) {
            lines.push(`**${hint.defect}**`);
            lines.push(`  Likely causes: ${hint.causes.join(", ")}`);
            lines.push(`  Recommended actions:`);
            for (const fix of hint.fixes) {
              lines.push(`  - ${fix}`);
            }
            lines.push("");
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
