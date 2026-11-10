import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { dirname, basename, join, extname } from "node:path";
import { tmpdir } from "node:os";
import { open, rename, unlink } from "node:fs/promises";
import type { PrusaConfig, MeshAnalysis, PrusaSlicerSettings } from "../types.js";
import { runPrusaSlicer, parseGCodeStats } from "../prusa-cli.js";
import { recommendProfile } from "../profile-engine.js";
import { writeRawIniFile, profileToIniSettings } from "../ini-writer.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import { readPrusaSlicerState } from "../prusaslicer-state.js";
import { readPrusaProject } from "../project-3mf.js";
import { isBgcode } from "../bgcode.js";
import {
  buildSliceArgs,
  choosePresets,
  filterSettings,
  gcodeFormatSettings,
  materialFromPresetName,
  nozzleFromPresetName,
  type PresetChoice,
} from "../slice-args.js";
import { parseModel } from "./analyze-mesh.js";

const SOURCE_LABEL: Record<PresetChoice["source"], string> = {
  arguments: "presets given to this tool",
  prusaslicer: "the presets selected in PrusaSlicer",
  project: "the config saved in the 3MF project",
  none: "PrusaSlicer defaults (generic printer)",
};

export function registerSlice(server: McpServer, config: PrusaConfig) {
  server.registerTool(
    "slice_prusaslicer",
    {
      title: "Slice a model with PrusaSlicer",
      description:
        "Slices an STL/3MF/OBJ with the PrusaSlicer CLI and returns the G-code path and statistics. " +
        "Uses real PrusaSlicer presets: the ones given here, else the project's own config (3MF saved by PrusaSlicer), " +
        "else the printer/print/filament currently selected in PrusaSlicer. " +
        "With `goal`, the recommendation is applied on top; by default only intent settings " +
        "(layer height, perimeters, infill, supports, brim) so the vendor profile keeps its tuned speeds and temperatures. " +
        "Prusa printers with binary G-code produce .bgcode.",
      inputSchema: {
        stl_path: z.string().describe("Absolute path to the STL, 3MF or OBJ file"),
        printer_profile: z.string().optional().describe("Printer preset name, e.g. \"Prusa CORE One HF0.4 nozzle\""),
        print_profile: z.string().optional().describe("Print preset name, e.g. \"0.20mm SPEED @COREONE HF0.4\""),
        material_profile: z.string().optional().describe("Filament preset name, e.g. \"Prusament PETG @COREONE HF0.4\""),
        config_path: z.string().optional().describe("A PrusaSlicer .ini to load on top of the presets"),
        goal: z.string().optional().describe("Print intent to apply on top: draft, standard, quality, strong, vase, speed"),
        override_scope: z
          .enum(["intent", "full"])
          .default("intent")
          .describe("With goal: 'intent' overrides only layer height, perimeters, infill, supports and brim; 'full' overrides every recommended setting"),
        nozzle: z.number().optional().describe("Nozzle diameter for the recommendation (default: from the printer preset name, else 0.4)"),
        material: z.string().optional().describe("Material for the recommendation (default: from the filament preset name, else PLA)"),
        printer: z.string().optional().describe("Printer name for the recommendation when no printer preset is known"),
        gcode_format: z
          .enum(["auto", "ascii", "binary"])
          .default("auto")
          .describe("'auto' follows the printer profile; 'ascii' is needed for postprocess_gcode"),
        output_gcode: z.string().optional().describe("Output path (default: next to the model, .gcode or .bgcode)"),
      },
      annotations: {
        title: "Slice a model with PrusaSlicer",
        readOnlyHint: false,
        destructiveHint: true, // overwrites an existing G-code file at the output path
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const tempFiles: string[] = [];
      try {
        if (!config.executablePath) {
          return error("PrusaSlicer was not found. Install it or set PRUSASLICER_PATH.");
        }
        const input = params.stl_path;
        if (!existsSync(input)) {
          return error(`File not found: ${input}`);
        }

        // 1. Which presets
        const isProject = extname(input).toLowerCase() === ".3mf";
        const projectHasConfig = isProject && (await readPrusaProject(input).catch(() => null))?.config != null;
        const state = await readPrusaSlicerState(config.profilesDir);
        const presets = choosePresets(
          { printer: params.printer_profile, print: params.print_profile, material: params.material_profile },
          state.presets,
          projectHasConfig,
        );

        // 2. Overlay: recommendation and/or G-code format
        let overlay: PrusaSlicerSettings = gcodeFormatSettings(params.gcode_format);
        let applied: string[] = [];
        if (params.goal) {
          let mesh: MeshAnalysis | undefined;
          if ([".stl", ".3mf"].includes(extname(input).toLowerCase())) {
            mesh = analyzeMesh(await parseModel(input));
          }
          const profile = recommendProfile(
            presets.printer ?? params.printer ?? "Generic",
            params.nozzle ?? nozzleFromPresetName(presets.printer) ?? 0.4,
            params.goal,
            params.material ?? materialFromPresetName(presets.material) ?? "PLA",
            mesh,
          );
          // Without a real printer preset there is nothing tuned to protect: apply everything.
          const scope = presets.source === "none" ? "full" : params.override_scope;
          const recommended = filterSettings(profileToIniSettings(profile), scope);
          applied = Object.keys(recommended).sort();
          overlay = { ...recommended, ...overlay };
        }

        let overlayIni: string | undefined;
        if (Object.keys(overlay).length > 0) {
          overlayIni = join(tmpdir(), `prusamcp-overlay-${Date.now()}.ini`);
          await writeRawIniFile(overlay, overlayIni);
          tempFiles.push(overlayIni);
        }

        // 3. Slice. Without an explicit output path, write to a temp name next to the model and
        //    pick the extension afterwards, since only the result tells binary from ASCII.
        const base = basename(input).replace(/\.[^.]+$/, "");
        const sliceTarget = params.output_gcode ?? join(dirname(input), `.${base}.prusamcp-${Date.now()}.gcode`);
        if (!params.output_gcode) tempFiles.push(sliceTarget);

        const args = buildSliceArgs({
          input,
          output: sliceTarget,
          presets,
          configIni: params.config_path,
          overlayIni,
        });
        console.error(`[slice] Running: ${config.executablePath} ${args.join(" ")}`);
        const result = await runPrusaSlicer(config, args);

        if (!existsSync(sliceTarget)) {
          return error(
            `Slicing failed (exit code ${result.exitCode}):\n${(result.stderr || result.stdout).trim()}`,
          );
        }

        const binary = await startsWithBgcodeMagic(sliceTarget);
        let gcodePath = sliceTarget;
        if (!params.output_gcode) {
          gcodePath = join(dirname(input), `${base}.${binary ? "bgcode" : "gcode"}`);
          await rename(sliceTarget, gcodePath);
          tempFiles.splice(tempFiles.indexOf(sliceTarget), 1);
        }

        // 4. Report
        const stats = await parseGCodeStats(gcodePath).catch(() => null);
        const lines = [
          "## Slicing done",
          `**G-code**: ${gcodePath} (${binary ? "binary .bgcode" : "ASCII"})`,
          `**Config from**: ${SOURCE_LABEL[presets.source]}`,
        ];
        if (presets.printer) lines.push(`- Printer: ${presets.printer}`);
        if (presets.print) lines.push(`- Print: ${presets.print}`);
        if (presets.material) lines.push(`- Filament: ${presets.material}`);
        if (params.config_path) lines.push(`- Loaded on top: ${params.config_path}`);
        if (applied.length > 0) {
          lines.push(`**Recommendation applied** (goal "${params.goal}"): ${applied.map((k) => `${k} = ${overlay[k]}`).join(", ")}`);
        }

        lines.push("");
        if (stats) {
          const statLines = [
            stats.printerModel ? `**Printer model in G-code**: ${stats.printerModel}` : null,
            stats.estimatedTime ? `**Estimated time**: ${stats.estimatedTime}` : null,
            stats.filamentUsedG ? `**Filament**: ${stats.filamentUsedG} g` : null,
            stats.filamentUsedMm ? `**Filament length**: ${stats.filamentUsedMm} mm` : null,
            stats.filamentCost ? `**Filament cost**: ${stats.filamentCost}` : null,
            stats.layerCount ? `**Layers**: ${stats.layerCount}` : null,
          ].filter(Boolean);
          lines.push(...(statLines.length > 0 ? (statLines as string[]) : ["(no statistics in the G-code)"]));
        }

        if (presets.source === "none") {
          lines.push(
            "",
            "**Warning**: no printer preset was found, so PrusaSlicer's defaults were used " +
            "(generic printer and start G-code). Do not send this G-code to a printer. " +
            "Pass printer_profile, or select a printer in PrusaSlicer.",
          );
        }
        if (binary) {
          lines.push("", "_Binary G-code: postprocess_gcode needs gcode_format \"ascii\"._");
          if (extname(gcodePath).toLowerCase() !== ".bgcode") {
            lines.push("_The file holds binary G-code but is not named .bgcode; printers pick the format by extension, so rename it or use gcode_format \"ascii\"._");
          }
        }
        if (result.exitCode !== 0 && result.stderr.trim()) {
          lines.push("", "### PrusaSlicer messages", "```", result.stderr.trim(), "```");
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        return error(`Slicing error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        for (const file of tempFiles) {
          try { await unlink(file); } catch { /* already gone */ }
        }
      }
    },
  );
}

async function startsWithBgcodeMagic(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(4);
    await handle.read(head, 0, 4, 0);
    return isBgcode(head);
  } finally {
    await handle.close();
  }
}

function error(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}
