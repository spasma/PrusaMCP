// Smoke test of PrusaSlicer detection and window access on this machine.
// Run with PrusaSlicer open: node test/test-platform.js
import { detectPrusaSlicerPath, getProfilesDir } from "../build/config.js";
import { getPrusaSlicerWindow, capturePrusaSlicerWindow } from "../build/platform/index.js";
import { statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function main() {
  console.log(`Platform: ${process.platform}`);

  console.log("\n=== 1. Detection ===");
  console.log(`Executable: ${detectPrusaSlicerPath() ?? "NOT FOUND"}`);
  console.log(`Profiles:   ${getProfilesDir() ?? "NOT FOUND"}`);

  console.log("\n=== 2. Window ===");
  const window = await getPrusaSlicerWindow();
  if (!window) {
    console.log("PrusaSlicer is not running; open it and run again for steps 2 and 3.");
    return;
  }
  console.log(`Title: ${window.title ?? "(unreadable)"}`);
  if (window.note) console.log(`Note:  ${window.note}`);

  console.log("\n=== 3. Capture ===");
  const out = join(tmpdir(), `prusa-platform-test-${Date.now()}.png`);
  const result = await capturePrusaSlicerWindow(out);
  if (!result.ok) {
    console.log(`FAILED: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${statSync(out).size} bytes`);
  unlinkSync(out);

  console.log("\n✅ Platform test passed!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
