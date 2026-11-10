import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { parseModel } from "./analyze-mesh.js";
import { suggestOrientation } from "../orientation.js";

export function registerSuggestOrientation(server: McpServer) {
  server.registerTool(
    "suggest_orientation",
    {
      title: "Suggest the best print orientation",
      description:
        "Tests the 6 principal orientations of a 3D model and ranks each one " +
        "by overhangs, print height, bed contact and support volume. " +
        "Returns a ranking with a score and an explanation per orientation.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to the STL or 3MF file"),
      },
      annotations: {
        title: "Suggest the best print orientation",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path }) => {
      try {
        if (!existsSync(file_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `File not found: ${file_path}` }],
          };
        }

        console.error(`[suggest_orientation] Analyzing orientations for ${file_path}...`);
        const mesh = await parseModel(file_path);
        const results = suggestOrientation(mesh);

        const lines: string[] = [
          `## Print orientations, ranked`,
          "",
        ];

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const medal = i === 0 ? " **RECOMMENDED**" : "";
          lines.push(`### ${i + 1}. ${r.name}${medal}`);
          lines.push(`- **Score**: ${r.score}/100`);
          lines.push(`- **Overhangs**: ${r.overhangPercent.toFixed(1)}%`);
          lines.push(`- **Height**: ${r.printHeight.toFixed(1)}mm`);
          lines.push(`- **Bed contact**: ${r.bedContact.toFixed(1)}mm²`);
          lines.push(`- **Estimated supports**: ${r.supportVolume.toFixed(0)}mm³`);
          if (r.rotation.axisX !== 0 || r.rotation.axisY !== 0) {
            lines.push(`- **Rotation**: X=${r.rotation.axisX}° Y=${r.rotation.axisY}°`);
          }
          lines.push(`- _${r.reasoning}_`);
          lines.push("");
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
