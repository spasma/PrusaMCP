#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { VERSION } from "./version.js";

// Tools
import { registerAnalyzeMesh } from "./tools/analyze-mesh.js";
import { registerRecommendProfile } from "./tools/recommend-profile.js";
import { registerGenerateConfig } from "./tools/generate-config.js";
import { registerSlice } from "./tools/slice.js";
import { registerGetCurrentModel } from "./tools/get-current-model.js";
import { registerScreenshotPrusaSlicer } from "./tools/screenshot-prusaslicer.js";
import { registerRenderModel } from "./tools/render-model.js";
import { registerCheckPrintability } from "./tools/check-printability.js";
import { registerSuggestOrientation } from "./tools/suggest-orientation.js";
import { registerEstimateCost } from "./tools/estimate-cost.js";
import { registerPostprocessGcode } from "./tools/postprocess-gcode.js";
import { registerUploadPrint } from "./tools/upload-print.js";
import { registerSearchFilament } from "./tools/search-filament.js";
import { registerPrintWizard } from "./tools/print-wizard.js";
import { registerSubmitFeedback, registerFeedbackStats, registerExportFeedback } from "./tools/feedback.js";
import { registerDiagnosePrint } from "./tools/diagnose-print.js";

async function main() {
  console.error(`PrusaMCP v${VERSION}: MCP server for PrusaSlicer`);

  const config = loadConfig();

  if (config.executablePath) {
    console.error(`PrusaSlicer: ${config.executablePath}`);
  }
  if (config.profilesDir) {
    console.error(`Profiles: ${config.profilesDir}`);
  }

  const server = new McpServer({
    name: "prusa-mcp",
    version: VERSION,
  });

  // Analysis & recommendation (no PrusaSlicer needed)
  registerAnalyzeMesh(server);
  registerCheckPrintability(server);
  registerSuggestOrientation(server);
  registerRecommendProfile(server);
  registerGenerateConfig(server, config);
  registerEstimateCost(server);
  registerSearchFilament(server);
  registerPrintWizard(server);
  registerDiagnosePrint(server);

  // Feedback & community
  registerSubmitFeedback(server);
  registerFeedbackStats(server);
  registerExportFeedback(server);

  // PrusaSlicer integration
  registerSlice(server, config);
  registerGetCurrentModel(server, config);
  registerScreenshotPrusaSlicer(server);
  registerRenderModel(server);
  registerPostprocessGcode(server);
  registerUploadPrint(server);

  console.error(`18 tools registered. PrusaMCP v${VERSION} ready.`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("PrusaMCP running on STDIO.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
