import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchFilaments } from "../filament-db.js";

export function registerSearchFilament(server: McpServer) {
  server.registerTool(
    "search_filament",
    {
      title: "Search the filament database",
      description:
        "Searches filaments by brand, material or keyword. " +
        "Returns recommended temperatures, density, price and notes.",
      inputSchema: {
        query: z.string().optional().describe("Free-text search (brand, material, keyword)"),
        material: z.string().optional().describe("Filter by material (PLA, PETG, ABS, TPU...)"),
        brand: z.string().optional().describe("Filter by brand (Prusament, eSUN, Polymaker...)"),
      },
      annotations: {
        title: "Search the filament database",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, material, brand }) => {
      const results = searchFilaments(query, material, brand);

      if (results.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "No filaments found. Try other criteria.",
          }],
        };
      }

      const lines = [`## Filaments found (${results.length})`, ""];

      for (const f of results) {
        lines.push(`### ${f.brand} ${f.name} (${f.material})`);
        lines.push(`- **Nozzle**: ${f.nozzleTemp[0]}-${f.nozzleTemp[1]}°C`);
        lines.push(`- **Bed**: ${f.bedTemp[0]}-${f.bedTemp[1]}°C`);
        lines.push(`- **Fan**: ${f.fanSpeed[0]}-${f.fanSpeed[1]}%`);
        lines.push(`- **MVS**: ${f.maxVolumetricSpeed} mm³/s`);
        lines.push(`- **Density**: ${f.density} g/cm³`);
        if (f.pricePerKg) lines.push(`- **Price**: ~${f.pricePerKg}€/kg`);
        if (f.requiresEnclosure) lines.push(`- **Enclosure**: required`);
        if (f.recommendedSurface) lines.push(`- **Surface**: ${f.recommendedSurface}`);
        lines.push(`- _${f.notes}_`);
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
