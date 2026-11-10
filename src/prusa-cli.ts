import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isBgcode, readBgcodeMetadata } from "./bgcode.js";
import type { PrusaConfig, CliResult, GCodeStats } from "./types.js";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

export function runPrusaSlicer(
  config: PrusaConfig,
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<CliResult> {
  if (!config.executablePath) {
    return Promise.resolve({
      exitCode: 1,
      stdout: "",
      stderr: "PrusaSlicer not found. Install PrusaSlicer or set PRUSASLICER_PATH.",
    });
  }

  return new Promise((resolve) => {
    execFile(
      config.executablePath,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        let exitCode = 0;
        if (error && "code" in error && typeof error.code === "number") {
          exitCode = error.code;
        } else if (error) {
          exitCode = 1;
        }
        resolve({
          exitCode,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
  });
}

/**
 * Slicing statistics from a G-code file: comment lines in ASCII G-code,
 * metadata blocks in binary G-code (.bgcode, which Prusa printer profiles like the CORE One produce).
 */
export async function parseGCodeStats(gcodePath: string): Promise<GCodeStats> {
  const buf = await readFile(gcodePath);
  return isBgcode(buf) ? statsFromBgcode(buf) : statsFromAscii(buf.toString("utf-8"));
}

function statsFromBgcode(buf: Buffer): GCodeStats {
  const meta = readBgcodeMetadata(buf);
  const get = (key: string) => meta.print.get(key) ?? meta.printer.get(key);
  const num = (key: string) => {
    const value = get(key);
    return value !== undefined && value !== "" ? parseFloat(value) : undefined;
  };

  const stats: GCodeStats = { format: "binary" };
  stats.printerModel = meta.printer.get("printer_model") || undefined;
  const time = get("estimated printing time (normal mode)");
  if (time) {
    stats.estimatedTime = time;
    stats.estimatedTimeSeconds = parseTimeToSeconds(time);
  }
  stats.filamentUsedMm = num("filament used [mm]");
  stats.filamentUsedG = num("total filament used [g]") ?? num("filament used [g]");
  stats.filamentCost = num("total filament cost") ?? num("filament cost");
  return stats;
}

function statsFromAscii(content: string): GCodeStats {
  const stats: GCodeStats = { format: "ascii" };
  const match = (regex: RegExp) => content.match(regex)?.[1]?.trim();

  // [ \t] rather than \s: an empty value must not run into the next line.
  stats.printerModel = match(/^;[ \t]*printer_model[ \t]*=[ \t]*(.*)$/m) || undefined;

  const time = match(/;\s*estimated printing time \(normal mode\)\s*=\s*(.+)/i);
  if (time) {
    stats.estimatedTime = time;
    stats.estimatedTimeSeconds = parseTimeToSeconds(time);
  }

  const mm = match(/;\s*filament used \[mm\]\s*=\s*([\d.]+)/i);
  if (mm) stats.filamentUsedMm = parseFloat(mm);

  const grams = match(/;\s*total filament used \[g\]\s*=\s*([\d.]+)/i) ?? match(/;\s*filament used \[g\]\s*=\s*([\d.]+)/i);
  if (grams) stats.filamentUsedG = parseFloat(grams);

  const cost = match(/;\s*total filament cost\s*=\s*([\d.]+)/i);
  if (cost) stats.filamentCost = parseFloat(cost);

  const layers = match(/;\s*total layers count\s*=\s*(\d+)/i);
  if (layers) stats.layerCount = parseInt(layers, 10);

  return stats;
}

function parseTimeToSeconds(timeStr: string): number {
  let total = 0;
  const h = timeStr.match(/(\d+)\s*h/);
  const m = timeStr.match(/(\d+)\s*m/);
  const s = timeStr.match(/(\d+)\s*s/);
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (s) total += parseInt(s[1], 10);
  return total;
}
