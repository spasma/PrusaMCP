import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { rotateOntoBed } from "../geometry.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import { encodePng } from "../png.js";
import { renderViews, VIEW_DESCRIPTIONS, type ViewName } from "../renderer.js";
import { parseModel } from "./analyze-mesh.js";

const VIEWS = ["iso", "iso_below", "front", "back", "left", "right", "top", "bottom"] as const;
const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "row 3 left", "row 3 right", "row 4 left", "row 4 right"];

export function registerRenderModel(server: McpServer) {
  server.registerTool(
    "render_model",
    {
      title: "Render a model",
      description:
        "Renders an STL or 3MF to a PNG with up to eight orthographic views (default: iso, front, right and iso_below in a 2×2 grid), " +
        "overhangs that need support in red; they face down, so iso_below or bottom shows them. Works without PrusaSlicer and without screen access. " +
        "Pass rotation_x/y/z (degrees) to preview an orientation from suggest_orientation; the model is dropped on the bed after rotating.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to the STL or 3MF file"),
        views: z
          .array(z.enum(VIEWS))
          .min(1)
          .max(8)
          .default(["iso", "front", "right", "iso_below"])
          .describe("Views to render, in grid order (left to right, top to bottom)"),
        size: z.number().int().min(256).max(2048).default(1024).describe("Image width in pixels"),
        rotation_x: z.number().default(0).describe("Rotation about X in degrees, applied first"),
        rotation_y: z.number().default(0).describe("Rotation about Y in degrees, applied second"),
        rotation_z: z.number().default(0).describe("Rotation about Z in degrees, applied last"),
        highlight_overhangs: z.boolean().default(true).describe("Color overhanging faces red"),
      },
      annotations: {
        title: "Render a model",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path, views, size, rotation_x, rotation_y, rotation_z, highlight_overhangs }) => {
      try {
        if (!existsSync(file_path)) {
          return error(`File not found: ${file_path}`);
        }
        const ext = extname(file_path).toLowerCase();
        if (ext !== ".stl" && ext !== ".3mf") {
          return error("render_model supports STL and 3MF files.");
        }

        const model = await parseModel(file_path);
        if (model.triangles.length === 0) {
          return error("The file contains no printable triangles.");
        }

        const triangles = rotateOntoBed(model.triangles, { x: rotation_x, y: rotation_y, z: rotation_z });
        const analysis = analyzeMesh({ ...model, triangles });
        const image = renderViews(triangles, { size, views: views as ViewName[], highlightOverhangs: highlight_overhangs });
        const png = encodePng(image.width, image.height, image.rgba);

        const bb = analysis.boundingBox.size;
        const rotated = rotation_x || rotation_y || rotation_z;
        const layout = views.length === 1
          ? [`${views[0]}: ${VIEW_DESCRIPTIONS[views[0]]}`]
          : views.map((v, i) => `${POSITIONS[i]}: ${v}, ${VIEW_DESCRIPTIONS[v]}`);

        const lines = [
          `## Render: ${model.name}`,
          ...layout.map((l) => `- ${l}`),
          "",
          `**Colors**: grey = model${highlight_overhangs ? ", red = overhang that needs support (faces on the bed excluded)" : ""}; dark lines = edges.`,
          `**Size on the bed**: ${bb.x.toFixed(1)} × ${bb.y.toFixed(1)} × ${bb.z.toFixed(1)} mm`,
          `**Overhangs**: ${analysis.overhangPercent.toFixed(1)}% of faces`,
          rotated ? `**Rotation**: X ${rotation_x}°, Y ${rotation_y}°, Z ${rotation_z}°, then placed on the bed` : null,
        ].filter((l) => l !== null) as string[];

        return {
          content: [
            { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" as const },
            { type: "text" as const, text: lines.join("\n") },
          ],
        };
      } catch (err) {
        return error(`Render error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}

function error(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}
