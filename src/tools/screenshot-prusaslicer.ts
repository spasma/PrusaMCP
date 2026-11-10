import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { capturePrusaSlicerWindow } from "../platform/index.js";

export function registerScreenshotPrusaSlicer(server: McpServer) {
  server.registerTool(
    "screenshot_prusaslicer",
    {
      title: "Capture the PrusaSlicer window",
      description:
        "Takes a screenshot of the PrusaSlicer window (even when it is in the background) " +
        "and returns the image. The temporary file is deleted after reading. " +
        "Windows and macOS (on macOS the host app needs the Screen Recording permission).",
      inputSchema: {},
      annotations: {
        title: "Capture the PrusaSlicer window",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const screenshotPath = join(tmpdir(), `prusa-screenshot-${Date.now()}.png`);

        console.error("[screenshot] Capturing PrusaSlicer window...");
        const result = await capturePrusaSlicerWindow(screenshotPath);

        if (!result.ok || !existsSync(screenshotPath)) {
          const reason = result.ok ? "no image was written" : result.reason;
          console.error(`[screenshot] Capture failed: ${reason}`);
          try { await unlink(screenshotPath); } catch { /* not written */ }
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: `Could not capture PrusaSlicer: ${reason}`,
            }],
          };
        }

        // Read the image as base64
        const imageBuffer = await readFile(screenshotPath);
        const base64 = imageBuffer.toString("base64");

        // Cleanup — delete the screenshot file immediately
        try {
          await unlink(screenshotPath);
          console.error("[screenshot] Temp file cleaned up.");
        } catch {
          console.error(`[screenshot] Warning: could not delete ${screenshotPath}`);
        }

        return {
          content: [
            {
              type: "image" as const,
              data: base64,
              mimeType: "image/png" as const,
            },
            {
              type: "text" as const,
              text: "PrusaSlicer screenshot captured. It shows the model on the bed, the print settings and the overall state of the slicer.",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Capture error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
