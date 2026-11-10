import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

/**
 * What PrusaSlicer remembers between sessions (PrusaSlicer.ini in the profiles directory),
 * and how to get from its window title to a file on disk.
 */

export const MODEL_EXTENSIONS = [".3mf", ".stl", ".obj"];

/** PrusaSlicer translates "Untitled"; these are the languages it ships most often. */
const UNTITLED_NAMES = /^(untitled|sans titre|naamloos|unbenannt|senza titolo|sin título|bez názvu)$/i;

export interface SelectedPresets {
  printer: string | null;
  print: string | null;
  filament: string | null;
  physicalPrinter: string | null;
}

export interface PrusaSlicerState {
  skeinDirectory: string | null;
  presets: SelectedPresets;
  /** Full paths, most recent first. */
  recentProjects: string[];
}

export const EMPTY_STATE: PrusaSlicerState = {
  skeinDirectory: null,
  presets: { printer: null, print: null, filament: null, physicalPrinter: null },
  recentProjects: [],
};

// ─── PrusaSlicer.ini ─────────────────────────────────────────

/** Section name ("" before the first header) to key/value. */
export function parseIniSections(content: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>([["", new Map()]]);
  let current = sections.get("")!;

  for (const line of content.split(/\r?\n/)) {
    const header = line.match(/^\s*\[(.+)\]\s*$/);
    if (header) {
      current = sections.get(header[1]) ?? new Map();
      sections.set(header[1], current);
      continue;
    }
    const entry = line.match(/^\s*([^=#;]+?)\s*=\s*(.*?)\s*$/);
    if (entry) current.set(entry[1], entry[2]);
  }

  return sections;
}

export function parsePrusaSlicerIni(content: string): PrusaSlicerState {
  const sections = parseIniSections(content);
  const presets = sections.get("presets") ?? new Map();
  const recent = sections.get("recent") ?? new Map();

  const recentProjects = [...(sections.get("recent_projects") ?? new Map()).entries()]
    .filter(([key]) => /^\d+$/.test(key))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, path]) => path)
    .filter(Boolean);

  return {
    skeinDirectory: recent.get("skein_directory") || null,
    presets: {
      printer: presets.get("printer") || null,
      print: presets.get("print") || null,
      filament: presets.get("filament") || null,
      physicalPrinter: presets.get("physical_printer") || null,
    },
    recentProjects,
  };
}

export async function readPrusaSlicerState(profilesDir: string | null | undefined): Promise<PrusaSlicerState> {
  if (!profilesDir) return structuredClone(EMPTY_STATE);
  const iniPath = join(profilesDir, "PrusaSlicer.ini");
  if (!existsSync(iniPath)) return structuredClone(EMPTY_STATE);
  return parsePrusaSlicerIni(await readFile(iniPath, "utf-8"));
}

// ─── Window title ────────────────────────────────────────────

export interface TitleInfo {
  /** Project or file name as shown, or null for an untitled project. */
  name: string | null;
  /** The title starts with "*": the project has unsaved changes. */
  modified: boolean;
}

/**
 * Formats (the suffix is translated, the " - PrusaSlicer" part is not):
 *   "name - PrusaSlicer-2.9.7 based on Slic3r"
 *   "*name - PrusaSlicer-2.9.7 gebaseerd op Slic3r"  (modified)
 *   "*Sans titre - PrusaSlicer-2.9.4 basé sur Slic3r" (untitled)
 *   "PrusaSlicer-2.9.7 based on Slic3r"               (empty plater)
 * PrusaSlicer shows the project name without extension for 3MF projects,
 * and may show the file name with extension after importing a model.
 */
export function parseWindowTitle(title: string): TitleInfo {
  const dashIndex = title.indexOf(" - PrusaSlicer");
  if (dashIndex === -1) return { name: null, modified: false };

  let name = title.substring(0, dashIndex).trim();
  const modified = name.startsWith("*");
  if (modified) name = name.substring(1);

  if (!name || UNTITLED_NAMES.test(name)) return { name: null, modified };
  return { name, modified };
}

// ─── Finding the file ────────────────────────────────────────

export function hasModelExtension(name: string): boolean {
  return MODEL_EXTENSIONS.includes(extname(name).toLowerCase());
}

/** "part.v2" stays "part.v2": only a known model extension is dropped. */
export function stripModelExtension(name: string): string {
  return hasModelExtension(name) ? name.slice(0, -extname(name).length) : name;
}

/** The name as shown, or with each model extension when the title has none. */
export function candidateFileNames(name: string): string[] {
  return hasModelExtension(name) ? [name] : MODEL_EXTENSIONS.map((ext) => name + ext);
}

/** Recent projects are full paths, so a match needs no directory guessing. Most recent first. */
export function matchRecentProjects(name: string, recentProjects: string[]): string[] {
  const wanted = name.toLowerCase();
  return recentProjects.filter((path) => {
    const file = basename(path).toLowerCase();
    return file === wanted || stripModelExtension(file) === wanted;
  });
}

/** Search for a file by name across directories (case-insensitive). */
export async function findFileByName(fileNames: string[], searchDirs: string[]): Promise<string | null> {
  const wanted = new Set(fileNames.map((n) => n.toLowerCase()));
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of await readdir(dir)) {
        if (wanted.has(entry.toLowerCase())) return join(dir, entry);
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return null;
}

export function defaultSearchDirs(skeinDirectory: string | null): string[] {
  const home = homedir();
  const dirs = [
    skeinDirectory,
    join(home, "Downloads"),
    join(home, "Desktop"),
    join(home, "Documents"),
  ];

  if (process.platform === "win32") {
    dirs.push(
      join(home, "Bureau"),
      join(home, "OneDrive", "Bureau"),
      join(home, "OneDrive", "Documents"),
      join(home, "OneDrive", "Downloads"),
    );
  } else if (process.platform === "darwin") {
    dirs.push(join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"));
  }

  return dirs.filter(Boolean) as string[];
}

/** The most recently modified model files in a directory. */
export async function findRecentModels(
  dir: string,
  limit = 5,
): Promise<Array<{ path: string; mtime: Date }>> {
  if (!existsSync(dir)) return [];

  const models: Array<{ path: string; mtime: Date }> = [];
  for (const entry of await readdir(dir)) {
    if (!hasModelExtension(entry)) continue;
    const fullPath = join(dir, entry);
    try {
      models.push({ path: fullPath, mtime: (await stat(fullPath)).mtime });
    } catch {
      // skip
    }
  }

  models.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return models.slice(0, limit);
}
