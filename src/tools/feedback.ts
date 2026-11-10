import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  addFeedback,
  loadFeedback,
  computeStats,
  learnFromFeedback,
  type PrintFeedback,
} from "../feedback-store.js";
import {
  exportForCommunity,
  loadCommunityData,
  getCommunityInsight,
} from "../community-store.js";

// ─── Submit Feedback ─────────────────────────────────────────

export function registerSubmitFeedback(server: McpServer) {
  server.registerTool(
    "submit_feedback",
    {
      title: "Rate a print",
      description:
        "Records feedback after a print: surface quality, bed adhesion, strength " +
        "and the issues encountered. This data improves future recommendations " +
        "and can be exported anonymously to share with the community.",
      inputSchema: {
        model_name: z.string().describe("Name of the printed model"),
        material: z.string().describe("Material used (PLA, PETG, ABS...)"),
        printer: z.string().describe("Printer name"),
        nozzle: z.number().describe("Nozzle diameter in mm"),
        goal: z.string().describe("Goal used (draft, standard, quality, strong)"),
        layer_height: z.number().describe("Layer height used, in mm"),
        infill_percent: z.number().describe("Infill percentage"),
        perimeters: z.number().int().describe("Number of perimeters"),
        print_speed: z.number().describe("Print speed in mm/s"),
        nozzle_temp: z.number().describe("Nozzle temperature in °C"),
        bed_temp: z.number().describe("Bed temperature in °C"),
        support_used: z.boolean().describe("Were supports used?"),
        brim_used: z.boolean().describe("Was a brim used?"),
        quality_score: z.number().min(1).max(5).describe("Surface quality (1=terrible, 5=perfect)"),
        adhesion_score: z.number().min(1).max(5).describe("Bed adhesion (1=came loose, 5=perfect)"),
        strength_score: z.number().min(1).max(5).describe("Perceived strength (1=fragile, 5=unbreakable)"),
        overall_score: z.number().min(1).max(5).describe("Overall satisfaction (1=failed, 5=perfect)"),
        issues: z
          .array(z.string())
          .default([])
          .describe(
            "Issues encountered: warping, stringing, under-extrusion, over-extrusion, " +
            "layer-shift, ringing, blobs, elephants-foot, cracking, poor-bridging, clogging"
          ),
        notes: z.string().default("").describe("Free-form notes about the print"),
      },
      annotations: {
        title: "Rate a print",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const feedback: PrintFeedback = {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          modelName: params.model_name,
          material: params.material,
          printer: params.printer,
          nozzle: params.nozzle,
          goal: params.goal,
          layerHeight: params.layer_height,
          infillPercent: params.infill_percent,
          perimeters: params.perimeters,
          printSpeed: params.print_speed,
          nozzleTemp: params.nozzle_temp,
          bedTemp: params.bed_temp,
          supportUsed: params.support_used,
          brimUsed: params.brim_used,
          qualityScore: params.quality_score,
          adhesionScore: params.adhesion_score,
          strengthScore: params.strength_score,
          overallScore: params.overall_score,
          issues: params.issues,
          notes: params.notes,
          success: params.overall_score >= 3,
        };

        await addFeedback(feedback);

        // Get community insight for context
        const community = await loadCommunityData();
        const insight = getCommunityInsight(
          community,
          params.material,
          params.goal,
          params.nozzle,
        );

        const lines = [
          "## Feedback saved",
          `**Model**: ${params.model_name} | **Score**: ${params.overall_score}/5`,
          `**ID**: ${feedback.id}`,
          "",
        ];

        if (params.issues.length > 0) {
          lines.push(`**Reported issues**: ${params.issues.join(", ")}`);
        }

        // Learn and suggest
        const allFeedback = await loadFeedback();
        const adjustments = learnFromFeedback(allFeedback, params.material, params.printer);
        if (adjustments.warnings.length > 0) {
          lines.push("");
          lines.push("### Automatic learning");
          lines.push("_Based on your print history:_");
          for (const w of adjustments.warnings) {
            lines.push(`- ${w}`);
          }
        }

        if (insight.hasData && insight.sampleCount > 0) {
          lines.push("");
          lines.push(`### Community data (${insight.sampleCount} similar prints)`);
          if (insight.communityScore) {
            lines.push(`- Community average score: ${insight.communityScore.toFixed(1)}/5`);
          }
          if (insight.commonIssues.length > 0) {
            lines.push(`- Common issues: ${insight.commonIssues.join(", ")}`);
          }
        }

        lines.push("");
        lines.push("_This feedback will be used to improve future recommendations._");
        lines.push("_Use `export_feedback` to share it anonymously with the community._");

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

// ─── Feedback Stats ──────────────────────────────────────────

export function registerFeedbackStats(server: McpServer) {
  server.registerTool(
    "feedback_stats",
    {
      title: "Print statistics",
      description:
        "Shows statistics for your prints: success rate, " +
        "average scores, common issues and the best settings per material. " +
        "Combines your local data with the community data.",
      inputSchema: {
        material: z.string().optional().describe("Filter by material"),
      },
      annotations: {
        title: "Print statistics",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ material }) => {
      try {
        let feedbacks = await loadFeedback();
        if (material) {
          feedbacks = feedbacks.filter(
            (f) => f.material.toUpperCase() === material.toUpperCase(),
          );
        }

        const stats = computeStats(feedbacks);
        const community = await loadCommunityData();

        const lines = [
          "## Print statistics",
          "",
        ];

        if (stats.totalPrints === 0) {
          lines.push("No prints recorded yet. Use `submit_feedback` after a print.");
          lines.push("");
          lines.push(`### Community data (${community.totalPrints} prints)`);
          if (community.insights.bestPractices.length > 0) {
            lines.push("**Best practices:**");
            for (const bp of community.insights.bestPractices) {
              lines.push(`- ${bp.recommendation} _(confidence: ${Math.round(bp.confidence * 100)}%)_`);
            }
          }
        } else {
          lines.push(`**Total prints**: ${stats.totalPrints}`);
          lines.push(`**Success rate**: ${stats.successRate.toFixed(0)}%`);
          lines.push(`**Average quality score**: ${stats.avgQuality.toFixed(1)}/5`);
          lines.push(`**Average adhesion score**: ${stats.avgAdhesion.toFixed(1)}/5`);
          lines.push(`**Average strength score**: ${stats.avgStrength.toFixed(1)}/5`);
          lines.push("");

          if (stats.commonIssues.length > 0) {
            lines.push("### Common issues");
            for (const issue of stats.commonIssues.slice(0, 5)) {
              lines.push(`- **${issue.issue}**: ${issue.count}× (${issue.percent.toFixed(0)}% of prints)`);
            }
            lines.push("");
          }

          if (stats.bestSettings.length > 0) {
            lines.push("### Best settings per material");
            for (const s of stats.bestSettings) {
              lines.push(`- **${s.material}**: layer ${s.layerHeight}mm → score ${s.avgScore}/5 (${s.count} prints)`);
            }
          }
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

// ─── Export for Community ────────────────────────────────────

export function registerExportFeedback(server: McpServer) {
  server.registerTool(
    "export_feedback",
    {
      title: "Export feedback for the community",
      description:
        "Exports your print feedback in anonymized form to contribute " +
        "to the community knowledge base. Strips file paths " +
        "and generalizes the printer name. The resulting JSON is returned as text " +
        "and can be shared via a GitHub PR or another channel; nothing is written or sent.",
      inputSchema: {},
      annotations: {
        title: "Export feedback for the community",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const feedbacks = await loadFeedback();

        if (feedbacks.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "No feedback to export. Print something and rate it with `submit_feedback` first.",
            }],
          };
        }

        const anonymized = exportForCommunity(feedbacks);
        const exportData = {
          exportDate: new Date().toISOString().split("T")[0],
          printCount: anonymized.length,
          data: anonymized,
        };

        const json = JSON.stringify(exportData, null, 2);

        const lines = [
          "## Community export ready",
          `**Exported prints**: ${anonymized.length}`,
          "",
          "Anonymized data (no file paths, no exact names):",
          "",
          "```json",
          json,
          "```",
          "",
          "To contribute:",
          "1. Copy the JSON above",
          "2. Open a PR on the PrusaMCP repo",
          "3. Add your data under `community-contributions/`",
          "",
          "_Thanks for helping improve the recommendations for everyone._",
        ];

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
