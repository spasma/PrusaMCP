// Recommendation, ini, cost and filament database (formerly test-tools.js and test-v2.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStl } from "../build/stl-parser.js";
import { analyzeMesh } from "../build/mesh-analyzer.js";
import { recommendProfile } from "../build/profile-engine.js";
import { profileToIniSettings, serializeIni } from "../build/ini-writer.js";
import { estimateCostFromMesh } from "../build/cost-estimator.js";
import { searchFilaments } from "../build/filament-db.js";

const here = dirname(fileURLToPath(import.meta.url));
const cube = analyzeMesh(await parseStl(join(here, "cube.stl")));

test("a cube in PLA needs no supports", () => {
  const p = recommendProfile("MK4S", 0.4, "prototype rapide", "PLA", cube);
  assert.equal(p.goal, "draft");
  assert.equal(p.settings.support_material.value, false);
});

test("layer height stays within 25-80% of the nozzle", () => {
  for (const [nozzle, goal] of [[0.4, "draft"], [0.4, "quality"], [0.6, "standard"], [1.0, "beau rendu"]]) {
    const p = recommendProfile("Generic", nozzle, goal, "PLA", cube);
    const lh = p.settings.layer_height.value;
    assert.ok(lh >= nozzle * 0.25 - 1e-9 && lh <= nozzle * 0.8 + 1e-9, `${nozzle}/${goal}: ${lh}`);
  }
});

test("English and French goal aliases map to the same goal", () => {
  assert.equal(recommendProfile("Generic", 0.4, "quality", "PLA").goal, "quality");
  assert.equal(recommendProfile("Generic", 0.4, "beau rendu", "PLA").goal, "quality");
  assert.equal(recommendProfile("Generic", 0.4, "draft", "PLA").goal, "draft");
});

test("ABS gets a brim and its own temperatures", () => {
  const p = recommendProfile("CR30", 1.0, "beau rendu", "ABS", cube);
  assert.ok(p.settings.brim_width.value > 0);
  assert.ok(p.settings.nozzle_temperature.value >= 240);
  assert.ok(p.warnings.length > 0);
});

test("ini output uses PrusaSlicer keys", () => {
  const settings = profileToIniSettings(recommendProfile("MK4S", 0.4, "standard", "PLA", cube));
  assert.match(String(settings.fill_density), /%$/);
  assert.equal(typeof settings.layer_height, "number");
  const ini = serializeIni(settings);
  assert.match(ini, /^layer_height = /m);
  assert.match(ini, /^perimeter_speed = /m);
});

test("cost estimate is positive and scales with infill", () => {
  const low = estimateCostFromMesh(cube, 0.25, 15, 2, 70, "PLA");
  const high = estimateCostFromMesh(cube, 0.25, 80, 2, 70, "PLA");
  assert.ok(low.filamentWeightG > 0 && low.totalCostEur > 0 && low.printTimeSeconds > 0);
  assert.ok(high.filamentWeightG > low.filamentWeightG);
});

test("filament database search", () => {
  assert.ok(searchFilaments(undefined, "PLA").length > 3);
  const petg = searchFilaments("prusament", "PETG");
  assert.equal(petg.length, 1);
  assert.deepEqual(petg[0].nozzleTemp, [230, 250]);
});
