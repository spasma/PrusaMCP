import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { PrusaConfig } from "../types.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import { getPrusaSlicerWindow } from "../platform/index.js";
import { parseModel } from "./analyze-mesh.js";

const MODEL_EXTENSIONS = [".3mf", ".stl", ".obj"];
const ANALYZABLE_EXTENSIONS = [".3mf", ".stl"];

/** PrusaSlicer translates "Untitled"; these are the languages it ships most often. */
const UNTITLED_NAMES = /^(untitled|sans titre|naamloos|unbenannt|senza titolo|sin título|bez názvu)$/i;

// ─── PrusaSlicer Window Title ────────────────────────────────

/**
 * Extract the project name from PrusaSlicer's window title.
 * Formats (the suffix is translated, the " - PrusaSlicer" part is not):
 *   "name - PrusaSlicer-2.9.7 based on Slic3r"
 *   "*name - PrusaSlicer-2.9.7 gebaseerd op Slic3r"  (modified)
 *   "*Sans titre - PrusaSlicer-2.9.4 basé sur Slic3r" (untitled)
 * PrusaSlicer shows the project name without extension for 3MF projects,
 * and may show the file name with extension after importing a model.
 */
function extractNameFromTitle(title: string): string | null {
  const dashIndex = title.indexOf(" - PrusaSlicer");
  if (dashIndex === -1) return null;

  let name = title.substring(0, dashIndex).trim();

  // Remove leading * (unsaved changes marker)
  if (name.startsWith("*")) name = name.substring(1);

  if (!name || UNTITLED_NAMES.test(name)) return null;

  return name;
}

// ─── File Search ─────────────────────────────────────────────

function hasModelExtension(name: string): boolean {
  return MODEL_EXTENSIONS.includes(extname(name).toLowerCase());
}

/** "part.v2" stays "part.v2": only a known model extension is dropped. */
function stripModelExtension(name: string): string {
  return hasModelExtension(name) ? name.slice(0, -extname(name).length) : name;
}

/** The name as shown, or with each model extension when the title has none. */
function candidateFileNames(name: string): string[] {
  return hasModelExtension(name) ? [name] : MODEL_EXTENSIONS.map((ext) => name + ext);
}

/** Recent projects are full paths, so a match needs no directory guessing. Most recent first. */
function matchRecentProjects(name: string, recentProjects: string[]): string[] {
  const wanted = name.toLowerCase();
  return recentProjects.filter((path) => {
    const file = basename(path).toLowerCase();
    return file === wanted || stripModelExtension(file) === wanted;
  });
}

/**
 * Search for a file by name across common directories.
 */
async function findFileByName(
  fileNames: string[],
  searchDirs: string[],
): Promise<string | null> {
  const wanted = new Set(fileNames.map((n) => n.toLowerCase()));
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;

    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (wanted.has(entry.toLowerCase())) {
          return join(dir, entry);
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return null;
}

function defaultSearchDirs(skeinDirectory: string | null): string[] {
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

/**
 * Find the most recently modified STL/3MF files in a directory.
 */
async function findRecentModels(
  dir: string,
  limit: number = 5,
): Promise<Array<{ path: string; mtime: Date }>> {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir);
  const models: Array<{ path: string; mtime: Date }> = [];

  for (const entry of entries) {
    if (!hasModelExtension(entry)) continue;

    const fullPath = join(dir, entry);
    try {
      const stats = await stat(fullPath);
      models.push({ path: fullPath, mtime: stats.mtime });
    } catch {
      // skip
    }
  }

  models.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return models.slice(0, limit);
}

// ─── PrusaSlicer.ini State ───────────────────────────────────

interface PrusaSlicerState {
  skeinDirectory: string | null;
  currentPrinter: string | null;
  currentFilament: string | null;
  currentPrintProfile: string | null;
  /** Full paths, most recent first. */
  recentProjects: string[];
}

const EMPTY_STATE: PrusaSlicerState = {
  skeinDirectory: null,
  currentPrinter: null,
  currentFilament: null,
  currentPrintProfile: null,
  recentProjects: [],
};

/** "[recent_projects]" holds "1 = /path/a.3mf", "2 = ...", most recent first. */
function parseRecentProjects(content: string): string[] {
  const entries: Array<[number, string]> = [];
  let inSection = false;

  for (const line of content.split(/\r?\n/)) {
    const header = line.match(/^\s*\[(.+)\]\s*$/);
    if (header) {
      inSection = header[1] === "recent_projects";
      continue;
    }
    if (!inSection) continue;

    const entry = line.match(/^\s*(\d+)\s*=\s*(.+?)\s*$/);
    if (entry) entries.push([Number(entry[1]), entry[2]]);
  }

  return entries.sort((a, b) => a[0] - b[0]).map(([, path]) => path);
}

async function readPrusaSlicerState(profilesDir: string): Promise<PrusaSlicerState> {
  const iniPath = join(profilesDir, "PrusaSlicer.ini");
  if (!existsSync(iniPath)) {
    return { ...EMPTY_STATE };
  }

  const content = await readFile(iniPath, "utf-8");
  const state: PrusaSlicerState = { ...EMPTY_STATE };

  const skeinMatch = content.match(/skein_directory\s*=\s*(.+)/);
  if (skeinMatch) state.skeinDirectory = skeinMatch[1].trim();

  const printerMatch = content.match(/^printer\s*=\s*(.+)$/m);
  if (printerMatch) state.currentPrinter = printerMatch[1].trim();

  const filamentMatch = content.match(/^filament\s*=\s*(.+)$/m);
  if (filamentMatch) state.currentFilament = filamentMatch[1].trim();

  const printMatch = content.match(/^print\s*=\s*(.+)$/m);
  if (printMatch) state.currentPrintProfile = printMatch[1].trim();

  state.recentProjects = parseRecentProjects(content);

  return state;
}

// ─── Tool Registration ───────────────────────────────────────

export function registerGetCurrentModel(server: McpServer, config: PrusaConfig) {
  server.registerTool(
    "get_current_model",
    {
      title: "Voir le modèle ouvert dans PrusaSlicer",
      description:
        "Détecte le fichier actuellement ouvert dans PrusaSlicer en lisant le titre de la fenêtre. " +
        "Retourne le chemin du fichier, les presets actifs (imprimante, filament, profil), " +
        "et une analyse complète du mesh si c'est un STL ou un 3MF.",
      inputSchema: {
        analyze: z
          .boolean()
          .default(true)
          .describe("Lancer l'analyse mesh automatiquement"),
      },
    },
    async ({ analyze }) => {
      try {
        const lines: string[] = [];

        // 1. Read PrusaSlicer state from ini
        let state: PrusaSlicerState = { ...EMPTY_STATE };
        if (config.profilesDir) {
          state = await readPrusaSlicerState(config.profilesDir);
        }

        // 2. Get window title to find current file
        const window = await getPrusaSlicerWindow();

        if (!window) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: "PrusaSlicer ne semble pas être ouvert. Lance PrusaSlicer et charge un modèle.",
            }],
          };
        }

        lines.push("## État PrusaSlicer");
        lines.push(`**Imprimante** : ${state.currentPrinter || "non définie"}`);
        lines.push(`**Filament** : ${state.currentFilament || "non défini"}`);
        lines.push(`**Profil** : ${state.currentPrintProfile || "non défini"}`);
        lines.push("");

        // 3. Find the file: from the window title, or the most recent project when the title is unreadable
        let filePath: string | null = null;

        if (window.title === null) {
          lines.push(window.note
            ? `_Titre de la fenêtre illisible : ${window.note}_`
            : "_Titre de la fenêtre illisible._");
          filePath = state.recentProjects.find((p) => existsSync(p)) ?? null;
          if (!filePath) {
            lines.push("");
            lines.push("_Aucun projet récent trouvé. Donne-moi le chemin complet pour que je puisse l'analyser._");
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }
          lines.push(`_Hypothèse : le projet le plus récent de PrusaSlicer._`);
          lines.push("");
          lines.push(`## Fichier détecté : ${basename(filePath)}`);
        } else {
          const name = extractNameFromTitle(window.title);

          if (!name) {
            lines.push("**Modèle** : Aucun fichier ouvert (projet sans titre)");
            lines.push("");
            lines.push("_Charge un fichier STL/3MF dans PrusaSlicer pour que je puisse l'analyser._");
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          lines.push(`## Fichier détecté : ${name}`);

          // 4. Resolve on disk: recent projects first (full paths), then the usual directories
          const searchDirs = defaultSearchDirs(state.skeinDirectory);
          const recentMatches = matchRecentProjects(name, state.recentProjects);
          filePath =
            recentMatches.find((p) => existsSync(p)) ??
            (await findFileByName(candidateFileNames(name), searchDirs));

          if (!filePath) {
            lines.push(`**Chemin** : Fichier "${name}" introuvable dans les projets récents ni dans les dossiers habituels.`);
            if (recentMatches.length > 0) {
              lines.push(`Dernier emplacement connu : ${recentMatches[0]} (déplacé ou supprimé depuis ?)`);
            }
            lines.push(`Dossiers cherchés : ${searchDirs.join(", ")}`);
            lines.push("");
            lines.push("_Donne-moi le chemin complet pour que je puisse l'analyser._");
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }
        }

        lines.push(`**Chemin** : ${filePath}`);

        // 5. Get file stats
        try {
          const fileStats = await stat(filePath);
          const sizeMB = (fileStats.size / 1024 / 1024).toFixed(2);
          lines.push(`**Taille** : ${sizeMB} MB`);
          lines.push(`**Modifié** : ${fileStats.mtime.toLocaleString()}`);
        } catch { /* skip */ }

        lines.push("");

        // 6. Analyze mesh (STL or 3MF)
        const ext = extname(filePath).toLowerCase();
        if (analyze && ANALYZABLE_EXTENSIONS.includes(ext)) {
          console.error(`[get_current_model] Analyzing: ${filePath}`);
          const model = await parseModel(filePath);
          const analysis = analyzeMesh(model);
          const bb = analysis.boundingBox;

          lines.push("## Analyse Mesh");
          lines.push(`**Dimensions** : ${bb.size.x.toFixed(2)} × ${bb.size.y.toFixed(2)} × ${bb.size.z.toFixed(2)} mm`);
          lines.push(`**Volume** : ${analysis.volume.toFixed(2)} mm³ (${(analysis.volume / 1000).toFixed(2)} cm³)`);
          lines.push(`**Surface** : ${analysis.surfaceArea.toFixed(2)} mm²`);
          lines.push(`**Triangles** : ${analysis.triangleCount.toLocaleString()}`);
          lines.push("");
          lines.push(`**Overhangs** : ${analysis.overhangPercent.toFixed(1)}%${analysis.overhangPercent > 5 ? " — supports recommandés" : " — OK, pas de support nécessaire"}`);
          lines.push(`**Manifold** : ${analysis.isManifold ? "OK (mesh fermé)" : "NON — " + analysis.nonManifoldEdges + " arêtes problématiques, repair recommandé"}`);
          lines.push(`**Détails fins** : ${analysis.hasSmallDetails ? "Oui (" + analysis.smallDetailPercent.toFixed(1) + "% de petits triangles)" : "Non"}`);
          lines.push("");
        } else if (analyze && ext === ".obj") {
          lines.push("_Fichier OBJ détecté — l'analyse mesh n'est disponible que pour les STL et 3MF._");
        }

        // 7. Other recent files in same directory
        const currentName = basename(filePath);
        const recentModels = await findRecentModels(dirname(filePath));
        const others = recentModels.filter((m) => basename(m.path) !== currentName);
        if (others.length > 0) {
          lines.push("## Autres fichiers dans le dossier");
          for (const m of others) {
            lines.push(`- ${basename(m.path)} (${m.mtime.toLocaleString()})`);
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
            text: `Erreur : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
