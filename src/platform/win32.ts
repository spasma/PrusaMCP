import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync, unlinkSync } from "node:fs";
import type { CaptureResult, WindowInfo } from "./index.js";

/** An empty title means PrusaSlicer is not running (or has no main window yet). */
export async function getWindowInfo(): Promise<WindowInfo | null> {
  const title = await getWindowTitle();
  return title ? { title } : null;
}

/**
 * Read the PrusaSlicer window title via PowerShell.
 * The title shows the current project: "name - PrusaSlicer-2.9.x based on Slic3r"
 */
function getWindowTitle(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-Process -Name 'prusa-slicer' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty MainWindowTitle",
      ],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout?.trim()) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

/**
 * PowerShell script that captures PrusaSlicer's window using PrintWindow API.
 * Works even when PrusaSlicer is in the background.
 */
const CAPTURE_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$proc = Get-Process -Name 'prusa-slicer' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    Write-Error "NOT_RUNNING"
    exit 1
}

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class WindowCapture {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }

    public static Bitmap CaptureWindow(IntPtr hwnd) {
        RECT rect;
        GetWindowRect(hwnd, out rect);
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) {
            width = 1920; height = 1080;
        }
        Bitmap bmp = new Bitmap(width, height);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr hdc = g.GetHdc();
            PrintWindow(hwnd, hdc, 2);
            g.ReleaseHdc(hdc);
        }
        return bmp;
    }
}
'@

$hwnd = $proc.MainWindowHandle
$bitmap = [WindowCapture]::CaptureWindow($hwnd)
$bitmap.Save($args[0])
$bitmap.Dispose()
Write-Host "OK"
`;

export function captureWindow(outputPath: string): Promise<CaptureResult> {
  return new Promise((resolve) => {
    // Write script to temp file and execute
    const scriptPath = join(tmpdir(), `prusa-capture-${Date.now()}.ps1`);
    writeFileSync(scriptPath, CAPTURE_SCRIPT, "utf-8");

    execFile(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, outputPath],
      { timeout: 15000, windowsHide: true },
      (error, stdout, stderr) => {
        // Cleanup script
        try { unlinkSync(scriptPath); } catch { /* ignore */ }

        if (stderr?.includes("NOT_RUNNING")) {
          resolve({ ok: false, reason: "PrusaSlicer is not running." });
          return;
        }
        if (error || !stdout.trim().includes("OK")) {
          resolve({ ok: false, reason: `Capture failed: ${stderr?.trim() || error?.message || "unknown error"}` });
          return;
        }
        resolve({ ok: true });
      },
    );
  });
}
