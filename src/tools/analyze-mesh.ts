import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { parseStl } from "../stl-parser.js";
import { parse3mf } from "../threemf-parser.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import type { StlData } from "../types.js";

/**
 * Parse any supported 3D file format.
 */
export async function parseModel(filePath: string): Promise<StlData> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".3mf")) return parse3mf(filePath);
  if (lower.endsWith(".stl")) return parseStl(filePath);
  throw new Error(`Unsupported format. Accepted formats: STL, 3MF`);
}

export function registerAnalyzeMesh(server: McpServer) {
  server.registerTool(
    "analyze_mesh",
    {
      title: "Analyze a 3D mesh",
      description:
        "Analyzes an STL or 3MF file and returns dimensions, volume, surface area, " +
        "overhang percentage, fine detail detection and a manifold check.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to the STL or 3MF file"),
      },
      annotations: {
        title: "Analyze a 3D mesh",
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

        const lower = file_path.toLowerCase();
        if (!lower.endsWith(".stl") && !lower.endsWith(".3mf")) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Supported formats: STL, 3MF" }],
          };
        }

        console.error(`[analyze_mesh] Parsing ${file_path}...`);
        const mesh = await parseModel(file_path);
        console.error(`[analyze_mesh] Parsed ${mesh.triangles.length} triangles, analyzing...`);
        const analysis = analyzeMesh(mesh);

        const bb = analysis.boundingBox;
        const lines = [
          `## Mesh analysis: ${mesh.name}`,
          "",
          `**Dimensions (XYZ)**: ${bb.size.x.toFixed(2)} × ${bb.size.y.toFixed(2)} × ${bb.size.z.toFixed(2)} mm`,
          `**Volume**: ${analysis.volume.toFixed(2)} mm³ (${(analysis.volume / 1000).toFixed(2)} cm³)`,
          `**Surface area**: ${analysis.surfaceArea.toFixed(2)} mm²`,
          `**Triangles**: ${analysis.triangleCount.toLocaleString()}`,
          "",
          `### Overhangs`,
          `- Overhanging faces (>45°): **${analysis.overhangPercent.toFixed(1)}%** (${analysis.overhangTriangles} triangles)`,
          analysis.overhangPercent > 5
            ? `- Supports probably needed`
            : `- Few overhangs, supports likely not needed`,
          "",
          `### Fine details`,
          `- Small triangles: ${analysis.smallDetailPercent.toFixed(1)}%`,
          analysis.hasSmallDetails
            ? `- Fine details detected, a small layer height is recommended`
            : `- No critical fine details`,
          "",
          `### Manifold`,
          analysis.isManifold
            ? `- Manifold mesh (closed, ready to print)`
            : `- Non-manifold mesh (${analysis.nonManifoldEdges} problem edges), repair recommended`,
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Analysis error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
