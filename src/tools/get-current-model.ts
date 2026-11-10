import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { existsSync } from "node:fs";
import type { PrusaConfig } from "../types.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import { getPrusaSlicerWindow } from "../platform/index.js";
import {
  readPrusaSlicerState,
  parseWindowTitle,
  matchRecentProjects,
  findFileByName,
  candidateFileNames,
  defaultSearchDirs,
  findRecentModels,
} from "../prusaslicer-state.js";
import { readPrusaProject, PROJECT_SUMMARY_KEYS } from "../project-3mf.js";
import { parseModel } from "./analyze-mesh.js";

const ANALYZABLE_EXTENSIONS = [".3mf", ".stl"];

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function registerGetCurrentModel(server: McpServer, config: PrusaConfig) {
  server.registerTool(
    "get_current_model",
    {
      title: "Model open in PrusaSlicer",
      description:
        "Finds the project or model open in PrusaSlicer (from the window title, else PrusaSlicer's recent projects) " +
        "and returns its path, the selected presets, a mesh analysis, and for a 3MF saved by PrusaSlicer " +
        "the project's settings, per-object overrides and its thumbnail. Needs no screenshot.",
      inputSchema: {
        analyze: z.boolean().default(true).describe("Run the mesh analysis"),
        include_thumbnail: z.boolean().default(true).describe("Return the project's thumbnail image (3MF saved by PrusaSlicer)"),
        full_config: z.boolean().default(false).describe("Return every setting of the project instead of a summary"),
      },
      annotations: {
        title: "Model open in PrusaSlicer",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ analyze, include_thumbnail, full_config }) => {
      try {
        const lines: string[] = [];
        const content: Content[] = [];
        const state = await readPrusaSlicerState(config.profilesDir);

        const window = await getPrusaSlicerWindow();
        if (!window) {
          return error("PrusaSlicer does not seem to be running. Start it and load a model.");
        }

        lines.push("## PrusaSlicer");
        lines.push(`**Printer**: ${state.presets.printer || "not set"}`);
        lines.push(`**Filament**: ${state.presets.filament || "not set"}`);
        lines.push(`**Print**: ${state.presets.print || "not set"}`);
        lines.push("");

        // 1. Find the file: from the window title, or the most recent project when the title is unreadable
        let filePath: string | null = null;
        let modified = false;

        if (window.title === null) {
          lines.push(window.note ? `_Window title unreadable: ${window.note}_` : "_Window title unreadable._");
          filePath = state.recentProjects.find((p) => existsSync(p)) ?? null;
          if (!filePath) {
            lines.push("", "_No recent project found. Give me the full path to analyze it._");
            return text(lines);
          }
          lines.push("_Assuming PrusaSlicer's most recent project._", "");
          lines.push(`## Model: ${basename(filePath)}`);
        } else {
          const title = parseWindowTitle(window.title);
          modified = title.modified;

          if (!title.name) {
            lines.push("**Model**: none (untitled project)");
            lines.push("", "_Load an STL/3MF in PrusaSlicer so I can analyze it._");
            return text(lines);
          }

          lines.push(`## Model: ${title.name}`);

          const searchDirs = defaultSearchDirs(state.skeinDirectory);
          const recentMatches = matchRecentProjects(title.name, state.recentProjects);
          filePath =
            recentMatches.find((p) => existsSync(p)) ??
            (await findFileByName(candidateFileNames(title.name), searchDirs));

          if (!filePath) {
            lines.push(`**Path**: "${title.name}" not found in recent projects or the usual folders.`);
            if (recentMatches.length > 0) {
              lines.push(`Last known location: ${recentMatches[0]} (moved or deleted since?)`);
            }
            lines.push(`Searched: ${searchDirs.join(", ")}`);
            lines.push("", "_Give me the full path to analyze it._");
            return text(lines);
          }
        }

        lines.push(`**Path**: ${filePath}`);
        try {
          const fileStats = await stat(filePath);
          lines.push(`**Size**: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
          lines.push(`**Modified**: ${fileStats.mtime.toLocaleString()}`);
        } catch { /* skip */ }
        if (modified) {
          lines.push("_PrusaSlicer has unsaved changes: the file below shows the last saved state._");
        }
        lines.push("");

        const ext = extname(filePath).toLowerCase();

        // 2. Project settings (3MF saved by PrusaSlicer)
        if (ext === ".3mf") {
          const project = await readPrusaProject(filePath).catch(() => null);
          if (project?.config) {
            lines.push("## Project settings");
            const keys = full_config ? [...project.config.keys()].sort() : PROJECT_SUMMARY_KEYS;
            const settingLines = keys
              .filter((k) => project.config!.has(k))
              .map((k) => `${k} = ${project.config!.get(k)}`);
            lines.push("```ini", ...settingLines, "```");
            lines.push("");
          } else if (project) {
            lines.push("_This 3MF has no PrusaSlicer project settings (exported by another program)._", "");
          }

          const special = (project?.objects ?? []).filter(
            (o) => Object.keys(o.settings).length > 0 || Object.keys(o.volumes).length > 0 || o.instances > 1,
          );
          if (special.length > 0) {
            lines.push("## Objects");
            for (const o of special) {
              const parts = [
                o.instances > 1 ? `${o.instances} instances` : null,
                ...Object.entries(o.settings).map(([k, v]) => `${k} = ${v}`),
                ...Object.entries(o.volumes).map(([type, n]) => `${n}× ${type}`),
              ].filter(Boolean);
              lines.push(`- **${o.name}**: ${parts.join(", ")}`);
            }
            lines.push("");
          }

          if (include_thumbnail && project?.thumbnail) {
            content.push({ type: "image", data: project.thumbnail.toString("base64"), mimeType: "image/png" });
          }
        }

        // 3. Mesh analysis (STL or 3MF)
        if (analyze && ANALYZABLE_EXTENSIONS.includes(ext)) {
          console.error(`[get_current_model] Analyzing: ${filePath}`);
          const model = await parseModel(filePath);
          const analysis = analyzeMesh(model);
          const bb = analysis.boundingBox;

          lines.push("## Mesh analysis");
          if (model.parts && model.parts.length > 0) {
            lines.push(`**Objects**: ${model.parts.length} (${model.name})`);
          }
          lines.push(`**Dimensions**: ${bb.size.x.toFixed(2)} × ${bb.size.y.toFixed(2)} × ${bb.size.z.toFixed(2)} mm`);
          lines.push(`**Volume**: ${analysis.volume.toFixed(2)} mm³ (${(analysis.volume / 1000).toFixed(2)} cm³)`);
          lines.push(`**Surface**: ${analysis.surfaceArea.toFixed(2)} mm²`);
          lines.push(`**Triangles**: ${analysis.triangleCount.toLocaleString()}`);
          lines.push("");
          lines.push(`**Overhangs**: ${analysis.overhangPercent.toFixed(1)}%${analysis.overhangPercent > 5 ? ", supports recommended" : ", no supports needed"}`);
          lines.push(`**Manifold**: ${analysis.isManifold ? "yes (closed mesh)" : `no, ${analysis.nonManifoldEdges} problem edges; repair recommended`}`);
          lines.push(`**Fine details**: ${analysis.hasSmallDetails ? `yes (${analysis.smallDetailPercent.toFixed(1)}% small triangles)` : "no"}`);
          lines.push("");
        } else if (analyze && ext === ".obj") {
          lines.push("_OBJ file: mesh analysis supports STL and 3MF only._");
        }

        // 4. Other recent files in the same folder
        const currentName = basename(filePath);
        const others = (await findRecentModels(dirname(filePath))).filter((m) => basename(m.path) !== currentName);
        if (others.length > 0) {
          lines.push("## Other models in this folder");
          for (const m of others) {
            lines.push(`- ${basename(m.path)} (${m.mtime.toLocaleString()})`);
          }
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }, ...content] };
      } catch (err) {
        return error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}

function text(lines: string[]) {
  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

function error(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
