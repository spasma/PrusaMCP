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
      title: "Capturer l'écran de PrusaSlicer",
      description:
        "Prend un screenshot de la fenêtre PrusaSlicer (même en arrière-plan) " +
        "et retourne l'image. Le fichier temporaire est automatiquement supprimé après lecture. " +
        "Windows et macOS (macOS : autorisation Enregistrement de l'écran requise pour l'app hôte).",
      inputSchema: {},
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
              text: `Impossible de capturer PrusaSlicer : ${reason}`,
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
              text: "Screenshot de PrusaSlicer capturé. Je peux voir le modèle sur le plateau, les paramètres d'impression, et l'état général du slicer.",
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur de capture : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
