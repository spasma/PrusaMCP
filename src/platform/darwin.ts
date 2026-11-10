import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { CaptureResult, WindowInfo } from "./index.js";

const OWNER_NAME = "PrusaSlicer";

/** Retina captures are 2x the window's point size; this keeps the image near logical size and well under client limits. */
const MAX_CAPTURE_EDGE = 2000;

/** The editor's title always carries the version ("... - PrusaSlicer-2.9.7 based on Slic3r"), in every language. */
const MAIN_TITLE = /PrusaSlicer-\d/;

const PERMISSION_HINT =
  "macOS hides window titles and contents without Screen Recording permission. " +
  "Grant it to the app that runs this MCP server (Claude Desktop, Terminal, VS Code, Cursor...) in " +
  "System Settings > Privacy & Security > Screen & System Audio Recording, then restart that app.";

/**
 * Lists PrusaSlicer's normal-layer windows through CGWindowListCopyWindowInfo.
 * JXA ships with macOS, so nothing has to be compiled or installed.
 * kCGWindowListOptionAll includes windows behind others and on other Spaces.
 */
const LIST_WINDOWS_JXA = `
ObjC.import("CoreGraphics");
const raw = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
const list = ObjC.deepUnwrap(ObjC.castRefToObject(raw)) || [];
JSON.stringify(list
  .filter(w => w.kCGWindowOwnerName === ${JSON.stringify(OWNER_NAME)} && w.kCGWindowLayer === 0)
  .map(w => ({
    id: w.kCGWindowNumber,
    title: w.kCGWindowName || "",
    onscreen: !!w.kCGWindowIsOnscreen,
    area: w.kCGWindowBounds ? w.kCGWindowBounds.Width * w.kCGWindowBounds.Height : 0,
  })));
`;

interface MacWindow {
  id: number;
  title: string;
  onscreen: boolean;
  area: number;
}

function listWindows(): Promise<MacWindow[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", LIST_WINDOWS_JXA],
      { timeout: 5000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`osascript failed: ${stderr?.trim() || error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()) as MacWindow[]);
        } catch {
          reject(new Error(`Unexpected osascript output: ${stdout.trim().slice(0, 200)}`));
        }
      },
    );
  });
}

interface MainWindow {
  window: MacWindow;
  /** False when no PrusaSlicer window has a title: Screen Recording permission is missing. */
  titlesVisible: boolean;
}

async function findMainWindow(): Promise<MainWindow | null> {
  const windows = (await listWindows()).filter((w) => w.area > 0);
  if (windows.length === 0) return null;

  const titlesVisible = windows.some((w) => w.title !== "");
  const titled = windows.filter((w) => MAIN_TITLE.test(w.title));
  const pool = titled.length > 0 ? titled : windows;

  // Prefer a visible window, then the biggest one (the plater, not a dialog).
  pool.sort((a, b) => Number(b.onscreen) - Number(a.onscreen) || b.area - a.area);
  return { window: pool[0], titlesVisible };
}

export async function getWindowInfo(): Promise<WindowInfo | null> {
  const main = await findMainWindow();
  if (!main) return null;
  if (!main.titlesVisible) return { title: null, note: PERMISSION_HINT };
  return { title: MAIN_TITLE.test(main.window.title) ? main.window.title : null };
}

export async function captureWindow(outputPath: string): Promise<CaptureResult> {
  let main: MainWindow | null;
  try {
    main = await findMainWindow();
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!main) return { ok: false, reason: "PrusaSlicer is not running." };

  return new Promise((resolve) => {
    // -l captures that one window, also when it sits behind others. -o drops the shadow, -x the sound.
    execFile(
      "screencapture",
      ["-x", "-o", "-t", "png", "-l", String(main.window.id), outputPath],
      { timeout: 15000 },
      (error, _stdout, stderr) => {
        const written = existsSync(outputPath) && statSync(outputPath).size > 0;
        if (error || !written) {
          const detail = stderr?.trim() || error?.message || "no image written";
          const hint = main.titlesVisible
            ? "Is the PrusaSlicer window minimized?"
            : PERMISSION_HINT;
          resolve({ ok: false, reason: `screencapture failed (${detail}). ${hint}` });
          return;
        }
        // Downscaling is best effort: the full-size capture is still a valid result.
        execFile(
          "sips",
          ["-Z", String(MAX_CAPTURE_EDGE), outputPath, "--out", outputPath],
          { timeout: 15000 },
          () => resolve({ ok: true }),
        );
      },
    );
  });
}
