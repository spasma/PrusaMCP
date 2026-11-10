import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStl } from "../build/stl-parser.js";
import { parse3mf } from "../build/threemf-parser.js";
import { analyzeMesh } from "../build/mesh-analyzer.js";
import { suggestOrientation } from "../build/orientation.js";
import { detectPrintIssues } from "../build/print-issues.js";
import { rotateOntoBed, minZ, isOverhang } from "../build/geometry.js";
import { writeZip, boxObject, model } from "./helpers/zip.js";

const here = dirname(fileURLToPath(import.meta.url));
const cubePath = join(here, "cube.stl");

test("cube.stl: 20 mm, closed, and no overhangs (its bottom rests on the bed)", async () => {
  const cube = await parseStl(cubePath);
  const a = analyzeMesh(cube);
  assert.equal(a.triangleCount, 12);
  assert.deepEqual([a.boundingBox.size.x, a.boundingBox.size.y, a.boundingBox.size.z], [20, 20, 20]);
  assert.ok(Math.abs(a.volume - 8000) < 1e-6);
  assert.equal(a.isManifold, true);
  assert.equal(a.overhangPercent, 0);
});

test("cube.stl: printability has no bridge or overhang findings", async () => {
  const cube = await parseStl(cubePath);
  const report = detectPrintIssues(cube.triangles, analyzeMesh(cube), 0.4);
  assert.equal(report.score, 100);
});

test("cube.stl: every orientation is equally good", async () => {
  const results = suggestOrientation(await parseStl(cubePath));
  assert.equal(results.length, 6);
  for (const r of results) {
    assert.equal(r.overhangPercent, 0);
    assert.ok(Math.abs(r.printHeight - 20) < 1e-6);
  }
});

test("a plate on a pillar overhangs; the pillar's foot does not", async () => {
  const path = writeZip("t.3mf", {
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1, { sx: 10, sy: 10, sz: 20 })}${boxObject(2, { sx: 30, sy: 30, sz: 5 })}</resources>` +
      `<build><item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 -10 -10 20"/></build>`,
    ),
  });
  const mesh = await parse3mf(path);
  const a = analyzeMesh(mesh);
  // Of 24 faces, only the plate's two bottom triangles hang in the air.
  assert.equal(a.overhangTriangles, 2);
  const bedZ = minZ(mesh.triangles);
  const pillarBottom = mesh.triangles.slice(0, 2);
  assert.ok(pillarBottom.every((t) => !isOverhang(t, bedZ)));
});

test("rotateOntoBed keeps size and drops the mesh on Z = 0", async () => {
  const cube = await parseStl(cubePath);
  for (const r of [{ x: 90 }, { y: -90 }, { x: 180 }, { z: 45 }]) {
    const rotated = rotateOntoBed(cube.triangles, r);
    assert.equal(minZ(rotated), 0);
    assert.equal(analyzeMesh({ triangles: rotated, name: "r" }).overhangPercent, 0);
  }
});
