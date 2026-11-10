import * as darwin from "./darwin.js";
import * as win32 from "./win32.js";

export type CaptureResult = { ok: true } | { ok: false; reason: string };

export interface WindowInfo {
  /** Main window title, or null when it cannot be read. */
  title: string | null;
  /** Why the title is missing, when known. */
  note?: string;
}

const UNSUPPORTED = `Window access is not supported on ${process.platform} (Windows and macOS only).`;

/** Null when PrusaSlicer is not running. */
export async function getPrusaSlicerWindow(): Promise<WindowInfo | null> {
  switch (process.platform) {
    case "win32":
      return win32.getWindowInfo();
    case "darwin":
      return darwin.getWindowInfo();
    default:
      return { title: null, note: UNSUPPORTED };
  }
}

export function capturePrusaSlicerWindow(outputPath: string): Promise<CaptureResult> {
  switch (process.platform) {
    case "win32":
      return win32.captureWindow(outputPath);
    case "darwin":
      return darwin.captureWindow(outputPath);
    default:
      return Promise.resolve({ ok: false, reason: UNSUPPORTED });
  }
}
