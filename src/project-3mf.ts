import { readZipEntries } from "./zip.js";

/**
 * What a PrusaSlicer project (.3mf saved by the GUI) carries besides the mesh:
 * - Metadata/Slic3r_PE.config: the full print/filament/printer config as "; key = value" lines
 * - Metadata/Slic3r_PE_model.config: per-object settings and modifier volumes
 * - Metadata/thumbnail.png: the plater render made when the project was saved
 * A 3MF from another tool (CAD export, Bambu/Orca) has none of these.
 */

const CONFIG_ENTRY = "metadata/slic3r_pe.config";
const MODEL_CONFIG_ENTRY = "metadata/slic3r_pe_model.config";
const THUMBNAIL_ENTRY = "metadata/thumbnail.png";

export interface ProjectObject {
  name: string;
  instances: number;
  /** Object-level overrides of the project config, e.g. layer_height for one object. */
  settings: Record<string, string>;
  /** Count per non-part volume type: ParameterModifier, SupportEnforcer, SupportBlocker, NegativeVolume. */
  volumes: Record<string, number>;
}

export interface PrusaProject {
  config: Map<string, string> | null;
  thumbnail: Buffer | null;
  objects: ProjectObject[];
}

export async function readPrusaProject(filePath: string): Promise<PrusaProject> {
  const entries = await readZipEntries(filePath, (name) => {
    const lower = name.toLowerCase();
    return lower === CONFIG_ENTRY || lower === MODEL_CONFIG_ENTRY || lower === THUMBNAIL_ENTRY;
  });
  const get = (wanted: string) =>
    [...entries.entries()].find(([name]) => name.toLowerCase() === wanted)?.[1] ?? null;

  const config = get(CONFIG_ENTRY);
  const modelConfig = get(MODEL_CONFIG_ENTRY);

  return {
    config: config ? parseProjectConfig(config.toString("utf-8")) : null,
    thumbnail: get(THUMBNAIL_ENTRY),
    objects: modelConfig ? parseModelConfig(modelConfig.toString("utf-8")) : [],
  };
}

/** "; key = value" lines; other lines (comments, blank) are ignored. */
export function parseProjectConfig(text: string): Map<string, string> {
  const config = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^;\s*([^=]+?)\s*=\s?(.*)$/);
    if (match) config.set(match[1], match[2]);
  }
  return config;
}

export function parseModelConfig(xml: string): ProjectObject[] {
  const objects: ProjectObject[] = [];
  const objectRegex = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let match: RegExpExecArray | null;

  while ((match = objectRegex.exec(xml)) !== null) {
    const instances = Number(match[1].match(/instances_count="(\d+)"/)?.[1] ?? 1);
    const body = match[2];

    // Object-level metadata sits outside <volume> blocks.
    const objectPart = body.replace(/<volume\b[\s\S]*?<\/volume>/g, "");
    const settings: Record<string, string> = {};
    let name = "";
    for (const m of objectPart.matchAll(/<metadata\b[^>]*type="object"[^>]*key="([^"]*)"[^>]*value="([^"]*)"/g)) {
      if (m[1] === "name") name = decodeXml(m[2]);
      else settings[m[1]] = decodeXml(m[2]);
    }

    const volumes: Record<string, number> = {};
    for (const v of body.matchAll(/<volume\b[\s\S]*?<\/volume>/g)) {
      const type = v[0].match(/key="volume_type"\s+value="([^"]*)"/)?.[1] ?? "ModelPart";
      if (type !== "ModelPart") volumes[type] = (volumes[type] ?? 0) + 1;
    }

    objects.push({ name: name || `object ${objects.length + 1}`, instances, settings, volumes });
  }

  return objects;
}

function decodeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The settings that answer "how will this print" at a glance. */
export const PROJECT_SUMMARY_KEYS = [
  "printer_settings_id",
  "print_settings_id",
  "filament_settings_id",
  "printer_model",
  "nozzle_diameter",
  "layer_height",
  "first_layer_height",
  "perimeters",
  "top_solid_layers",
  "bottom_solid_layers",
  "fill_density",
  "fill_pattern",
  "support_material",
  "support_material_auto",
  "support_material_buildplate_only",
  "support_material_style",
  "brim_width",
  "temperature",
  "first_layer_temperature",
  "bed_temperature",
  "filament_type",
  "spiral_vase",
  "binary_gcode",
];
