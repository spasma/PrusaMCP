import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import type { PrusaConfig } from "./types.js";

/** On macOS the CLI is the app binary itself; the GUI only starts without an action like --export-gcode. */
const MAC_APP_BINARY = join("Contents", "MacOS", "PrusaSlicer");

function installCandidates(): string[] {
  switch (process.platform) {
    case "win32":
      return [
        "C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe",
        "C:\\Program Files (x86)\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe",
      ];
    case "darwin":
      return [
        "/Applications/PrusaSlicer.app",
        "/Applications/Original Prusa Drivers/PrusaSlicer.app",
        join(homedir(), "Applications", "PrusaSlicer.app"),
      ].map((app) => join(app, MAC_APP_BINARY));
    default:
      return [];
  }
}

/** Accepts a path to PrusaSlicer.app as well as to the binary inside it. */
function resolveExecutable(path: string): string | null {
  if (!existsSync(path)) return null;
  if (path.replace(/\/+$/, "").endsWith(".app") && statSync(path).isDirectory()) {
    const binary = join(path, MAC_APP_BINARY);
    return existsSync(binary) ? binary : null;
  }
  return path;
}

function findOnPath(): string | null {
  const [command, name] =
    process.platform === "win32"
      ? ["where", "prusa-slicer-console.exe"]
      : ["which", "prusa-slicer"];
  try {
    const result = execFileSync(command, [name], { encoding: "utf-8", timeout: 5000 });
    const firstLine = result.trim().split(/\r?\n/)[0]?.trim();
    if (firstLine && existsSync(firstLine)) return firstLine;
  } catch {
    // not found on PATH
  }
  return null;
}

export function detectPrusaSlicerPath(): string | null {
  // 1. Environment variable
  const envPath = process.env.PRUSASLICER_PATH;
  if (envPath) {
    const resolved = resolveExecutable(envPath);
    if (resolved) return resolved;
    console.error(`[config] PRUSASLICER_PATH does not exist or is not a PrusaSlicer app: ${envPath}`);
  }

  // 2. Default install locations
  for (const p of installCandidates()) {
    if (existsSync(p)) return p;
  }

  // 3. PATH
  return findOnPath();
}

function profilesCandidate(): string | null {
  switch (process.platform) {
    case "win32":
      return process.env.APPDATA ? join(process.env.APPDATA, "PrusaSlicer") : null;
    case "darwin":
      return join(homedir(), "Library", "Application Support", "PrusaSlicer");
    default:
      return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "PrusaSlicer");
  }
}

export function getProfilesDir(): string | null {
  const dir = process.env.PRUSASLICER_PROFILES_DIR || profilesCandidate();
  return dir && existsSync(dir) ? dir : null;
}

export function loadConfig(): PrusaConfig {
  const executablePath = detectPrusaSlicerPath() ?? "";
  const profilesDir = getProfilesDir() ?? "";

  if (!executablePath) {
    console.error(
      "[config] PrusaSlicer not found. Install PrusaSlicer or set PRUSASLICER_PATH env var. " +
      "Slicing tools will not work, but analysis and recommendation tools are still available."
    );
  }

  if (!profilesDir) {
    console.error(
      "[config] PrusaSlicer profiles directory not found. " +
      "Profile listing will not work."
    );
  }

  return { executablePath, profilesDir };
}
