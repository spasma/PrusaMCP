import type { Triangle, Vec3 } from "./types.js";
import { computeNormal, isOverhang, minZ } from "./geometry.js";

/**
 * Software rasterizer: orthographic views of a mesh with a z-buffer, flat shading
 * and outlines (silhouette and crease edges). No GPU, no dependencies.
 */

export type ViewName = "iso" | "iso_below" | "front" | "back" | "left" | "right" | "top" | "bottom";

export const VIEW_DESCRIPTIONS: Record<ViewName, string> = {
  iso: "isometric, from front-right and above",
  iso_below: "isometric, from front-right and below (shows the faces that point down)",
  front: "front (looking along +Y)",
  back: "back (looking along -Y)",
  left: "left side (looking along +X)",
  right: "right side (looking along -X)",
  top: "top (looking down)",
  bottom: "bottom (looking up, front edge at the top)",
};

export interface RenderOptions {
  /** Total image width in pixels; cells are square. */
  size: number;
  views: ViewName[];
  highlightOverhangs: boolean;
}

export interface RenderResult {
  width: number;
  height: number;
  rgba: Uint8Array;
  columns: number;
  overhangTriangles: number;
}

type RGB = [number, number, number];

const BACKGROUND: RGB = [246, 246, 244];
const GRID_LINE: RGB = [210, 210, 206];
const MODEL: RGB = [196, 198, 202];
const OVERHANG: RGB = [222, 45, 38];
const OUTLINE_STRENGTH = 0.45;

interface Camera {
  right: Vec3;
  up: Vec3;
  /** Points from the model toward the viewer. */
  toViewer: Vec3;
}

function camera(view: ViewName): Camera {
  const z = { x: 0, y: 0, z: 1 };
  switch (view) {
    case "front": return { right: { x: 1, y: 0, z: 0 }, up: z, toViewer: { x: 0, y: -1, z: 0 } };
    case "back": return { right: { x: -1, y: 0, z: 0 }, up: z, toViewer: { x: 0, y: 1, z: 0 } };
    case "right": return { right: { x: 0, y: 1, z: 0 }, up: z, toViewer: { x: 1, y: 0, z: 0 } };
    case "left": return { right: { x: 0, y: -1, z: 0 }, up: z, toViewer: { x: -1, y: 0, z: 0 } };
    case "top": return { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, toViewer: z };
    case "bottom": return { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: -1, z: 0 }, toViewer: { x: 0, y: 0, z: -1 } };
    case "iso":
    case "iso_below": {
      const toViewer = normalize({ x: 1, y: -1, z: view === "iso" ? 1 : -1 });
      // Keep +Z pointing up on screen, so the model stays upright when seen from below.
      const up = normalize(sub(z, scale(toViewer, dot(z, toViewer))));
      return { right: cross(up, toViewer), up, toViewer };
    }
  }
}

export function renderViews(triangles: Triangle[], options: RenderOptions): RenderResult {
  const views = options.views.length > 0 ? options.views : (["iso"] as ViewName[]);
  const columns = views.length === 1 ? 1 : 2;
  const rows = Math.ceil(views.length / columns);
  const cell = Math.max(64, Math.floor(options.size / columns));
  const width = cell * columns;
  const height = cell * rows;

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) setPixel(rgba, i, BACKGROUND);

  // Overhangs are classified once, against the bed (lowest point of the mesh).
  const bedZ = minZ(triangles);
  const normals = triangles.map((t) => computeNormal(t.v1, t.v2, t.v3));
  const overhang = triangles.map((t, i) => options.highlightOverhangs && isOverhang(t, bedZ, normals[i].z));
  const overhangTriangles = triangles.reduce((n, t, i) => n + (isOverhang(t, bedZ, normals[i].z) ? 1 : 0), 0);

  views.forEach((view, index) => {
    const ox = (index % columns) * cell;
    const oy = Math.floor(index / columns) * cell;
    renderCell(triangles, normals, overhang, camera(view), rgba, width, ox, oy, cell);
  });

  // Separators between cells
  for (let c = 1; c < columns; c++) {
    for (let y = 0; y < height; y++) setPixel(rgba, y * width + c * cell, GRID_LINE);
  }
  for (let r = 1; r < rows; r++) {
    for (let x = 0; x < width; x++) setPixel(rgba, r * cell * width + x, GRID_LINE);
  }

  return { width, height, rgba, columns, overhangTriangles };
}

function renderCell(
  triangles: Triangle[],
  normals: Vec3[],
  overhang: boolean[],
  cam: Camera,
  rgba: Uint8Array,
  imageWidth: number,
  ox: number,
  oy: number,
  cell: number,
): void {
  if (triangles.length === 0) return;

  // Project every vertex once per view
  const project = (v: Vec3) => [dot(v, cam.right), dot(v, cam.up), dot(v, cam.toViewer)];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const projected = triangles.map((t) => {
    const p = [project(t.v1), project(t.v2), project(t.v3)];
    for (const [x, y] of p) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return p;
  });

  const margin = cell * 0.08;
  const extent = Math.max(maxX - minX, maxY - minY, 1e-9);
  const s = (cell - 2 * margin) / extent;
  const offsetX = (cell - (maxX - minX) * s) / 2;
  const offsetY = (cell - (maxY - minY) * s) / 2;
  const toScreen = (x: number, y: number): [number, number] => [
    (x - minX) * s + offsetX,
    cell - ((y - minY) * s + offsetY), // screen Y grows downward
  ];

  const depth = new Float32Array(cell * cell).fill(-Infinity);
  const face = new Int32Array(cell * cell).fill(-1);

  // A headlight, nudged up and to the right: faces toward the viewer are bright in every view
  // (also downward faces seen from below), oblique faces get darker so shapes stay readable.
  const light = normalize(add(add(cam.toViewer, scale(cam.up, 0.3)), scale(cam.right, 0.2)));

  for (let i = 0; i < triangles.length; i++) {
    const [p1, p2, p3] = projected[i];
    const [x1, y1] = toScreen(p1[0], p1[1]);
    const [x2, y2] = toScreen(p2[0], p2[1]);
    const [x3, y3] = toScreen(p3[0], p3[1]);

    const area = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    if (area === 0) continue;

    const minPx = Math.max(0, Math.floor(Math.min(x1, x2, x3)));
    const maxPx = Math.min(cell - 1, Math.ceil(Math.max(x1, x2, x3)));
    const minPy = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
    const maxPy = Math.min(cell - 1, Math.ceil(Math.max(y1, y2, y3)));

    for (let py = minPy; py <= maxPy; py++) {
      for (let px = minPx; px <= maxPx; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        const w1 = ((x2 - cx) * (y3 - cy) - (x3 - cx) * (y2 - cy)) / area;
        const w2 = ((x3 - cx) * (y1 - cy) - (x1 - cx) * (y3 - cy)) / area;
        const w3 = 1 - w1 - w2;
        if (w1 < 0 || w2 < 0 || w3 < 0) continue;

        const z = w1 * p1[2] + w2 * p2[2] + w3 * p3[2];
        const k = py * cell + px;
        if (z > depth[k]) {
          depth[k] = z;
          face[k] = i;
        }
      }
    }
  }

  // Shade, then outline where the surface changes: silhouettes and creases.
  const zTolerance = 2 / s; // about two pixels of depth, in model units
  for (let py = 0; py < cell; py++) {
    for (let px = 0; px < cell; px++) {
      const k = py * cell + px;
      const f = face[k];
      if (f < 0) continue;

      const n = normals[f];
      const facing = dot(n, cam.toViewer);
      const diffuse = Math.max(0, dot(n, light));
      // Red is a signal, not a material: overhangs keep most of their brightness so they stand out.
      let intensity = overhang[f]
        ? 0.8 + 0.2 * diffuse
        : facing >= 0 ? 0.35 + 0.65 * diffuse : 0.3; // back faces of open meshes stay dark
      const base = overhang[f] ? OVERHANG : MODEL;

      if (isEdge(face, depth, normals, cell, px, py, zTolerance)) intensity *= 1 - OUTLINE_STRENGTH;

      const color: RGB = [base[0] * intensity, base[1] * intensity, base[2] * intensity];
      setPixel(rgba, (oy + py) * imageWidth + ox + px, color);
    }
  }
}

function isEdge(
  face: Int32Array,
  depth: Float32Array,
  normals: Vec3[],
  cell: number,
  px: number,
  py: number,
  zTolerance: number,
): boolean {
  const k = py * cell + px;
  const f = face[k];
  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    const nx = px + dx, ny = py + dy;
    if (nx >= cell || ny >= cell) continue;
    const j = ny * cell + nx;
    const g = face[j];
    if (g < 0) return true; // silhouette against the background
    if (g === f) continue;
    if (Math.abs(depth[j] - depth[k]) > zTolerance) return true; // depth step
    if (dot(normals[f], normals[g]) < 0.94) return true; // crease sharper than ~20°
  }
  // Pixels whose left or upper neighbour is background also mark the silhouette.
  if (px > 0 && face[k - 1] < 0) return true;
  if (py > 0 && face[k - cell] < 0) return true;
  return false;
}

function setPixel(rgba: Uint8Array, index: number, [r, g, b]: RGB): void {
  const o = index * 4;
  rgba[o] = Math.max(0, Math.min(255, Math.round(r)));
  rgba[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
  rgba[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
  rgba[o + 3] = 255;
}

// ─── Vector helpers ──────────────────────────────────────────

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}
function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return scale(a, 1 / len);
}
