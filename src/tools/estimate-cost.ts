import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { parseModel } from "./analyze-mesh.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import { estimateCostFromMesh } from "../cost-estimator.js";
import { recommendProfile } from "../profile-engine.js";

export function registerEstimateCost(server: McpServer) {
  server.registerTool(
    "estimate_cost",
    {
      title: "Estimate print cost",
      description:
        "Estimates the print cost of a 3D model: filament, electricity and time. " +
        "Can also compare several profiles (draft/standard/quality) side by side.",
      inputSchema: {
        file_path: z.string().describe("Absolute path to the STL or 3MF file"),
        material: z.string().default("PLA").describe("Material (PLA, PETG, ABS...)"),
        nozzle: z.number().default(0.4).describe("Nozzle diameter in mm"),
        filament_price_per_kg: z.number().default(22).describe("Filament price in EUR/kg"),
        electricity_price: z.number().default(0.25).describe("Electricity price in EUR/kWh"),
        compare_profiles: z
          .boolean()
          .default(true)
          .describe("Compare draft/standard/quality side by side"),
      },
      annotations: {
        title: "Estimate print cost",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ file_path, material, nozzle, filament_price_per_kg, electricity_price, compare_profiles }) => {
      try {
        if (!existsSync(file_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `File not found: ${file_path}` }],
          };
        }

        const mesh = await parseModel(file_path);
        const analysis = analyzeMesh(mesh);

        const params = {
          filamentPricePerKg: filament_price_per_kg,
          electricityPricePerKwh: electricity_price,
          printerWattage: 200,
        };

        const lines: string[] = [];

        if (compare_profiles) {
          // Compare draft / standard / quality
          const goals = ["draft", "standard", "quality", "strong"] as const;
          const comparisons: Array<{
            name: string;
            time: string;
            cost: string;
            filament: string;
            layerH: number;
          }> = [];

          lines.push("## Profile comparison");
          lines.push(`**Model**: ${mesh.name} | **Material**: ${material} | **Nozzle**: ${nozzle}mm`);
          lines.push(`**Filament price**: ${filament_price_per_kg}€/kg | **Electricity**: ${electricity_price}€/kWh`);
          lines.push("");

          for (const goal of goals) {
            const profile = recommendProfile("Generic", nozzle, goal, material);
            const lh = profile.settings.layer_height.value as number;
            const infill = profile.settings.infill_density.value as number;
            const perimeters = profile.settings.perimeters.value as number;
            const speed = profile.settings.print_speed.value as number;

            const estimate = estimateCostFromMesh(
              analysis, lh, infill, perimeters, speed, material, params,
            );

            comparisons.push({
              name: goal,
              time: estimate.printTimeFormatted,
              cost: `${estimate.totalCostEur}€`,
              filament: `${estimate.filamentWeightG}g`,
              layerH: lh,
            });
          }

          // Table
          lines.push("| Profile | Layer | Time | Filament | Total cost |");
          lines.push("|---------|-------|------|----------|------------|");
          for (const c of comparisons) {
            lines.push(`| **${c.name}** | ${c.layerH}mm | ${c.time} | ${c.filament} | ${c.cost} |`);
          }

          // Savings
          if (comparisons.length >= 2) {
            const fastest = comparisons[0];
            const slowest = comparisons[comparisons.length - 1];
            lines.push("");
            lines.push(`**Savings, draft vs strong**: ${slowest.cost} → ${fastest.cost}, ${slowest.time} down to ${fastest.time}`);
          }
        } else {
          // Single profile estimate
          const profile = recommendProfile("Generic", nozzle, "standard", material);
          const lh = profile.settings.layer_height.value as number;
          const infill = profile.settings.infill_density.value as number;
          const perimeters = profile.settings.perimeters.value as number;
          const speed = profile.settings.print_speed.value as number;

          const estimate = estimateCostFromMesh(
            analysis, lh, infill, perimeters, speed, material, params,
          );

          lines.push("## Cost estimate");
          lines.push(`**Time**: ${estimate.printTimeFormatted}`);
          lines.push(`**Filament**: ${estimate.filamentWeightG}g (${estimate.filamentLengthMm.toFixed(0)}mm)`);
          lines.push(`**Filament cost**: ${estimate.filamentCostEur}€`);
          lines.push(`**Electricity cost**: ${estimate.electricityCostEur}€`);
          lines.push(`**Total cost**: ${estimate.totalCostEur}€`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
