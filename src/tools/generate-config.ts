import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { recommendProfile } from "../profile-engine.js";
import { writeIniFile, writeRawIniFile, profileToIniSettings, serializeIni } from "../ini-writer.js";
import { parseStl } from "../stl-parser.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import type { PrusaSlicerSettings, MeshAnalysis, PrusaConfig } from "../types.js";

export function registerGenerateConfig(server: McpServer, config: PrusaConfig) {
  const cli = config.executablePath ? `"${config.executablePath}"` : "prusa-slicer";

  server.registerTool(
    "generate_prusaslicer_config",
    {
      title: "Generate a PrusaSlicer config file",
      description:
        "Generates a PrusaSlicer-compatible .ini file from a print goal or custom settings. " +
        "The file can be loaded directly with --load in PrusaSlicer.",
      inputSchema: {
        printer: z.string().default("Generic").describe("Printer name"),
        nozzle: z.number().default(0.4).describe("Nozzle diameter in mm"),
        goal: z.string().describe("Print goal (draft, standard, quality, strong, vase, speed; same aliases as recommend_profile)"),
        material: z.string().default("PLA").describe("Material"),
        stl_path: z.string().optional().describe("STL path for automatic analysis"),
        output_path: z.string().optional().describe("Output path for the .ini (default: a temporary file); an existing file is overwritten"),
        custom_settings: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .optional()
          .describe("Custom PrusaSlicer settings to override (e.g. {\"layer_height\": 0.15})"),
      },
      annotations: {
        title: "Generate a PrusaSlicer config file",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ printer, nozzle, goal, material, stl_path, output_path, custom_settings }) => {
      try {
        // Mesh analysis if STL provided
        let meshAnalysis: MeshAnalysis | undefined;
        if (stl_path && existsSync(stl_path)) {
          const stl = await parseStl(stl_path);
          meshAnalysis = analyzeMesh(stl);
        }

        // Generate recommendation
        const profile = recommendProfile(printer, nozzle, goal, material, meshAnalysis);
        const settings = profileToIniSettings(profile);

        // Apply custom overrides (preserve MVS if not explicitly set)
        if (custom_settings) {
          const hasMvs = "max_volumetric_speed" in custom_settings ||
                         "filament_max_volumetric_speed" in custom_settings;
          for (const [key, value] of Object.entries(custom_settings)) {
            settings[key] = value;
          }
          // Ensure MVS is always present — critical for PrusaSlicer speed limiting
          if (!hasMvs && !settings["filament_max_volumetric_speed"]) {
            settings["filament_max_volumetric_speed"] = settings["max_volumetric_speed"] ?? 15;
          }
        }

        // Determine output path
        const finalPath =
          output_path ??
          join(tmpdir(), `prusaslicer-${profile.goal}-${Date.now()}.ini`);

        await writeRawIniFile(settings, finalPath);

        // Also return the ini content as text for immediate use
        const iniContent = serializeIni(settings);

        const lines = [
          `## PrusaSlicer config generated`,
          `**File**: ${finalPath}`,
          `**Goal**: ${profile.goal} | **Material**: ${profile.material} | **Nozzle**: ${profile.nozzle}mm`,
          "",
          "```ini",
          iniContent.trim(),
          "```",
          "",
          `PrusaSlicer CLI usage:`,
          "```",
          `${cli} --load "${finalPath}" --export-gcode model.stl`,
          "```",
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Generation error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
