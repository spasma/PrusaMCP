import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  octoPrintTargetFromEnv,
  prusaLinkTargetFromEnv,
  uploadToOctoPrint,
  uploadToPrusaLink,
} from "../print-hosts.js";

export function registerUploadPrint(server: McpServer) {
  server.registerTool(
    "upload_print",
    {
      title: "Send G-code to a printer",
      description:
        "Uploads a .gcode/.bgcode to a printer on the local network through PrusaLink (MK4/MK4S, CORE One, XL, MINI, " +
        "or Prusa Link on a Raspberry Pi) or OctoPrint, and can start the print. " +
        "The printer's address and credentials come from the MCP server's environment " +
        "(PRUSALINK_URL + PRUSALINK_PASSWORD or PRUSALINK_API_KEY; OCTOPRINT_URL + OCTOPRINT_API_KEY), never from arguments. " +
        "For Prusa Connect (cloud), use Prusa's official MCP server instead.",
      inputSchema: {
        gcode_path: z.string().describe("Path to the .gcode or .bgcode file"),
        server_type: z
          .enum(["prusalink", "octoprint", "prusaconnect"])
          .default("prusalink")
          .describe("'prusalink' or 'octoprint'. 'prusaconnect' is an old name for 'prusalink' (this tool talks to the printer's local API)."),
        server_url: z.string().optional().describe("Overrides PRUSALINK_URL / OCTOPRINT_URL, e.g. http://192.168.1.50"),
        storage: z.string().optional().describe("PrusaLink storage, e.g. 'usb' (Buddy printers) or 'local' (Raspberry Pi). Default: detected from the printer, else 'usb'"),
        start_print: z.boolean().default(false).describe("Start printing right after the upload"),
        overwrite: z.boolean().default(false).describe("PrusaLink: replace a file with the same name"),
      },
      annotations: {
        title: "Send G-code to a printer",
        readOnlyHint: false,
        destructiveHint: true, // can start a print and replace files on the printer
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ gcode_path, server_type, server_url, storage, start_print, overwrite }) => {
      try {
        if (!existsSync(gcode_path)) {
          return error(`File not found: ${gcode_path}`);
        }
        const request = {
          fileName: basename(gcode_path),
          data: await readFile(gcode_path),
          startPrint: start_print,
          overwrite,
        };

        const notes: string[] = [];
        if (server_type === "prusaconnect") {
          notes.push("_'prusaconnect' now means PrusaLink, the printer's local API. For the Prusa Connect cloud, use Prusa's official MCP server._");
        }

        if (server_type === "octoprint") {
          const target = octoPrintTargetFromEnv(process.env, server_url);
          if (typeof target === "string") return error(target);
          const result = await uploadToOctoPrint(target, request);
          if (!result.ok) return error(`OctoPrint upload failed: ${result.message}`);
          return text([
            "## Uploaded to OctoPrint",
            `**File**: ${request.fileName}`,
            `**Server**: ${target.baseUrl}`,
            start_print ? "**Print started.**" : "Start the print from OctoPrint.",
            ...notes,
          ]);
        }

        const target = prusaLinkTargetFromEnv(process.env, server_url);
        if (typeof target === "string") return error(target);
        const result = await uploadToPrusaLink({ ...target, storage }, request);
        if (!result.ok) return error(`PrusaLink upload failed: ${result.message}`);
        return text([
          "## Uploaded via PrusaLink",
          `**File**: ${request.fileName}`,
          `**Printer**: ${target.baseUrl} (storage: ${result.storage})`,
          start_print ? "**Print started.**" : "Start the print on the printer or in PrusaLink.",
          ...notes,
        ]);
      } catch (err) {
        return error(`Upload error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}

function text(lines: string[]) {
  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

function error(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
