import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStl } from "../build/stl-parser.js";
import { parse3mf } from "../build/threemf-parser.js";
import { renderViews } from "../build/renderer.js";
import { rotateOntoBed } from "../build/geometry.js";
import { writeZip, boxObject, model } from "./helpers/zip.js";

const here = dirname(fileURLToPath(import.meta.url));

function count(image, predicate) {
  let n = 0;
  for (let i = 0; i < image.rgba.length; i += 4) {
    if (predicate(image.rgba[i], image.rgba[i + 1], image.rgba[i + 2])) n++;
  }
  return n;
}
const isRed = (r, g, b) => r > 150 && r > g * 2.5 && r > b * 2.5;
const isModel = (r, g, b) => !(r === 246 && g === 246 && b === 244) && !(r === 210 && g === 210 && b === 206);

test("grid size follows the number of views", async () => {
  const cube = rotateOntoBed((await parseStl(join(here, "cube.stl"))).triangles, {});
  const one = renderViews(cube, { size: 300, views: ["iso"], highlightOverhangs: true });
  assert.deepEqual([one.width, one.height, one.columns], [300, 300, 1]);
  const three = renderViews(cube, { size: 600, views: ["iso", "front", "top"], highlightOverhangs: true });
  assert.deepEqual([three.width, three.height], [600, 600]);
  assert.equal(three.rgba.length, 600 * 600 * 4);
});

test("a cube fills part of each cell and shows no overhang", async () => {
  const cube = rotateOntoBed((await parseStl(join(here, "cube.stl"))).triangles, {});
  const image = renderViews(cube, { size: 400, views: ["iso", "iso_below"], highlightOverhangs: true });
  const covered = count(image, isModel) / (image.width * image.height);
  assert.ok(covered > 0.2 && covered < 0.9, `coverage ${covered}`);
  assert.equal(count(image, isRed), 0);
  assert.equal(image.overhangTriangles, 0);
});

test("overhangs show red from below, not from above", async () => {
  const mesh = await parse3mf(writeZip("t.3mf", {
    "3D/3dmodel.model": model(
      `<resources>${boxObject(1, { sx: 10, sy: 10, sz: 20 })}${boxObject(2, { sx: 30, sy: 30, sz: 5 })}</resources>` +
      `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 10 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 20"/></build>`,
    ),
  }));
  const below = renderViews(mesh.triangles, { size: 256, views: ["iso_below"], highlightOverhangs: true });
  const above = renderViews(mesh.triangles, { size: 256, views: ["top"], highlightOverhangs: true });
  const plain = renderViews(mesh.triangles, { size: 256, views: ["iso_below"], highlightOverhangs: false });
  assert.equal(below.overhangTriangles, 2);
  assert.ok(count(below, isRed) > 1000);
  assert.equal(count(above, isRed), 0);
  assert.equal(count(plain, isRed), 0);
});
