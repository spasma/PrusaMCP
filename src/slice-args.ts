import type { PrusaSlicerSettings } from "./types.js";
import type { SelectedPresets } from "./prusaslicer-state.js";

/**
 * How a slice is configured, decided before PrusaSlicer runs. Pure, so it can be tested.
 *
 * PrusaSlicer CLI (verified on 2.9.7): --printer-profile/--print-profile/--material-profile
 * are applied first and every --load after them, whatever the argument order. A 3MF saved by
 * the GUI brings its own config, which the CLI uses when no profiles are given.
 */

/** Keys that express what you want from the print; the vendor profile keeps everything else. */
export const INTENT_KEYS = new Set([
  "layer_height",
  "perimeters",
  "top_solid_layers",
  "bottom_solid_layers",
  "fill_density",
  "fill_pattern",
  "support_material",
  "support_material_auto",
  "support_material_style",
  "support_material_buildplate_only",
  "brim_width",
  "spiral_vase",
]);

export type OverrideScope = "intent" | "full";
export type GcodeFormat = "auto" | "ascii" | "binary";

export type PresetSource =
  | "arguments"   // given to the tool
  | "prusaslicer" // the selection in PrusaSlicer (PrusaSlicer.ini)
  | "project"     // the config embedded in the 3MF
  | "none";       // PrusaSlicer defaults: a generic printer

export interface PresetChoice {
  source: PresetSource;
  printer: string | null;
  print: string | null;
  material: string | null;
}

/**
 * Explicit arguments win and are completed from the PrusaSlicer selection.
 * Without arguments, a project's own config wins over the selection.
 */
export function choosePresets(
  args: { printer?: string; print?: string; material?: string },
  selected: SelectedPresets,
  projectHasConfig: boolean,
): PresetChoice {
  if (args.printer || args.print || args.material) {
    return {
      source: "arguments",
      printer: args.printer ?? selected.printer,
      print: args.print ?? selected.print,
      material: args.material ?? selected.filament,
    };
  }
  if (projectHasConfig) {
    return { source: "project", printer: null, print: null, material: null };
  }
  if (selected.printer) {
    return {
      source: "prusaslicer",
      printer: selected.printer,
      print: selected.print,
      material: selected.filament,
    };
  }
  return { source: "none", printer: null, print: null, material: null };
}

export function filterSettings(settings: PrusaSlicerSettings, scope: OverrideScope): PrusaSlicerSettings {
  if (scope === "full") return { ...settings };
  return Object.fromEntries(Object.entries(settings).filter(([key]) => INTENT_KEYS.has(key)));
}

/** "Prusa CORE One HF0.4 nozzle" → 0.4, "Original Prusa MK4S 0.6 nozzle" → 0.6, "Original Prusa MK4S" → null. */
export function nozzleFromPresetName(name: string | null | undefined): number | null {
  if (!name) return null;
  const match = name.match(/HF\s*(\d+(?:\.\d+)?)/i) ?? name.match(/(\d+\.\d+)\s*(?:mm\s*)?nozzle/i);
  if (!match) return null;
  const nozzle = parseFloat(match[1]);
  return nozzle > 0 && nozzle <= 3 ? nozzle : null;
}

/** Name prefix in a filament preset → material known to the profile engine. Order matters (PCTG before PC). */
const MATERIAL_PREFIXES: Array<[string, string]> = [
  ["PETG", "PETG"],
  ["PCTG", "PETG"],
  ["ASA", "ASA"],
  ["ABS", "ABS"],
  ["TPU", "TPU"],
  ["FLEX", "TPU"],
  ["PLA", "PLA"],
  ["PC", "PC"],
  ["PA", "NYLON"],
  ["NYLON", "NYLON"],
];

/** "Generic PETG @COREONE HF0.4" → "PETG"; null when the engine does not know the material. */
export function materialFromPresetName(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = name.toUpperCase().split(/[^A-Z0-9+]+/);
  for (const [prefix, material] of MATERIAL_PREFIXES) {
    if (words.some((w) => w.startsWith(prefix))) return material;
  }
  return null;
}

export function gcodeFormatSettings(format: GcodeFormat): PrusaSlicerSettings {
  if (format === "ascii") return { binary_gcode: 0 };
  if (format === "binary") return { binary_gcode: 1 };
  return {};
}

export function buildSliceArgs(opts: {
  input: string;
  output: string;
  presets: PresetChoice;
  /** The user's own .ini (config_path). */
  configIni?: string;
  /** The generated overlay; loaded last so it wins. */
  overlayIni?: string;
}): string[] {
  const args: string[] = [];
  const { presets } = opts;

  if (presets.source === "arguments" || presets.source === "prusaslicer") {
    if (presets.printer) args.push("--printer-profile", presets.printer);
    if (presets.print) args.push("--print-profile", presets.print);
    if (presets.material) args.push("--material-profile", presets.material);
  }
  if (opts.configIni) args.push("--load", opts.configIni);
  if (opts.overlayIni) args.push("--load", opts.overlayIni);

  args.push("--export-gcode", "--output", opts.output, opts.input);
  return args;
}
