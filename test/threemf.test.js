import { test } from "node:test";
import assert from "node:assert/strict";
import { parse3mf } from "../build/threemf-parser.js";
import { analyzeMesh } from "../build/mesh-analyzer.js";
import { writeZip, boxObject, model } from "./helpers/zip.js";

async function load(entries) {
  const mesh = await parse3mf(writeZip("fixture.3mf", entries));
  return { mesh, a: analyzeMesh(mesh) };
}

function size(a) {
  const s = a.boundingBox.size;
  return [s.x, s.y, s.z].map((n) => Math.round(n * 1000) / 1000);
}

test("two objects each index their own vertices", async () => {
  const { mesh, a } = await load({
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1)}${boxObject(2)}</resources>` +
      `<build><item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 50 0 0"/></build>`,
    ),
  });
  assert.equal(mesh.triangles.length, 24);
  assert.deepEqual(size(a), [60, 10, 10]);
  assert.ok(Math.abs(a.volume - 2000) < 1e-6);
  assert.equal(a.isManifold, true);
  assert.deepEqual(mesh.parts.map((p) => p.triangles), [12, 12]);
});

test("build item transform rotates (90° about Z)", async () => {
  const { a } = await load({
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1, { sx: 20, sy: 10, sz: 5 })}</resources>` +
      `<build><item objectid="1" transform="0 1 0 -1 0 0 0 0 1 0 0 0"/></build>`,
    ),
  });
  assert.deepEqual(size(a), [10, 20, 5]);
});

test("components are resolved with their own transforms", async () => {
  const { mesh, a } = await load({
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1)}<object id="2" name="assembly" type="model"><components>` +
      `<component objectid="1"/><component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 10"/>` +
      `</components></object></resources>` +
      `<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 5 5 0"/></build>`,
    ),
  });
  assert.equal(mesh.triangles.length, 24);
  assert.deepEqual(size(a), [10, 10, 20]);
  assert.equal(a.boundingBox.min.x, 5);
  assert.equal(mesh.name, "assembly");
});

test("p:path components load meshes from another model file (Bambu/Orca layout)", async () => {
  const { mesh, a } = await load({
    "3D/3dmodel.model": model(
      `<resources><object id="9" type="model"><components>` +
      `<component p:path="/3D/Objects/part.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>` +
      `</components></object></resources><build><item objectid="9"/></build>`,
    ),
    "3D/Objects/part.model": model(`<resources>${boxObject(1, { sx: 4, sy: 5, sz: 6 })}</resources>`),
  });
  assert.equal(mesh.triangles.length, 12);
  assert.deepEqual(size(a), [4, 5, 6]);
});

test("unit is converted to millimetres", async () => {
  const { a } = await load({
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1, { sx: 1, sy: 1, sz: 1 })}</resources>` +
      `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 1 0 0"/></build>`,
      { unit: "inch" },
    ),
  });
  assert.deepEqual(size(a), [25.4, 25.4, 25.4]);
  assert.equal(a.boundingBox.min.x, 25.4);
});

test("a mirroring transform keeps normals pointing outward", async () => {
  const { a } = await load({
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1)}</resources>` +
      `<build><item objectid="1" transform="-1 0 0 0 1 0 0 0 1 10 0 0"/></build>`,
    ),
  });
  assert.ok(Math.abs(a.volume - 1000) < 1e-6);
  assert.equal(a.overhangPercent, 0);
});

test("items marked printable=\"0\" are skipped", async () => {
  const { mesh } = await load({
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1)}${boxObject(2)}</resources>` +
      `<build><item objectid="1"/><item objectid="2" printable="0"/></build>`,
    ),
  });
  assert.equal(mesh.triangles.length, 12);
});

test("without a build section, objects used as components are not counted twice", async () => {
  const { mesh } = await load({
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1)}<object id="2" type="model"><components><component objectid="1"/></components></object></resources>`,
    ),
  });
  assert.equal(mesh.triangles.length, 12);
});

test("vertex attributes are read in any order", async () => {
  const { a } = await load({
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1, { sx: 3, sy: 4, sz: 5 }).replace(
        /<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g,
        '<vertex z="$3" x="$1" y="$2"/>',
      )}</resources><build><item objectid="1"/></build>`,
    ),
  });
  assert.deepEqual(size(a), [3, 4, 5]);
});
