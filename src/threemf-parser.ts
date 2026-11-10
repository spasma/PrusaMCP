import type { Triangle, Vec3, StlData } from "./types.js";
import { computeNormal } from "./geometry.js";
import { readZipEntries } from "./zip.js";

/**
 * 3MF parser (core spec plus the production extension's p:path).
 *
 * - Every <object> has its own vertex list; triangle indices refer to that list only.
 * - <components> reference other objects, possibly in another model file (p:path), each with a transform.
 * - <build><item> places objects on the plate with a transform; only built items are printed.
 * - Transforms are 3×4 affine matrices "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32",
 *   applied to row vectors: x' = x·m00 + y·m10 + z·m20 + m30 (and so on).
 *
 * Regex-based on purpose: the 3MF mesh schema is flat and fixed, and this avoids an XML dependency.
 */

/** Row-major 3×4 affine matrix: [m00, m01, m02, m10, m11, m12, m20, m21, m22, m30, m31, m32]. */
type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

const MAX_COMPONENT_DEPTH = 16;

interface MeshObject {
  name: string;
  type: string;
  vertices: Vec3[];
  /** Flat vertex index triples. */
  indices: number[];
  components: Array<{ ref: string; transform: Matrix }>;
}

export interface ThreeMfPart {
  name: string;
  triangles: number;
}

export async function parse3mf(filePath: string): Promise<StlData> {
  const entries = await readZipEntries(filePath, (name) => name.toLowerCase().endsWith(".model"));
  if (entries.size === 0) {
    throw new Error("No .model file found in 3MF archive");
  }
  const models = new Map<string, string>();
  for (const [name, data] of entries) models.set(name, data.toString("utf-8"));
  return parseModels(models);
}

/** Exposed for tests: model file name (as in the archive) to XML. */
export function parseModels(models: Map<string, string>): StlData {
  const rootPath = findRootModel(models);
  const objects = new Map<string, MeshObject>();

  for (const [path, xml] of models) {
    const unitScale = UNIT_TO_MM[attr(xml.match(/<model\b[^>]*>/)?.[0] ?? "", "unit") ?? "millimeter"] ?? 1;
    parseObjects(xml, path, unitScale, objects);
  }

  const rootXml = models.get(rootPath) ?? "";
  const rootScale = UNIT_TO_MM[attr(rootXml.match(/<model\b[^>]*>/)?.[0] ?? "", "unit") ?? "millimeter"] ?? 1;
  const items = parseBuildItems(rootXml, rootPath, rootScale);

  const triangles: Triangle[] = [];
  const parts: ThreeMfPart[] = [];

  // Without a build section every top-level printable object is used as it is.
  const usedAsComponent = new Set([...objects.values()].flatMap((o) => o.components.map((c) => c.ref)));
  const placements = items.length > 0
    ? items
    : [...objects.entries()]
        .filter(([ref, o]) => isPrintable(o) && !usedAsComponent.has(ref))
        .map(([ref]) => ({ ref, transform: IDENTITY }));

  for (const { ref, transform } of placements) {
    const object = objects.get(ref);
    if (!object || !isPrintable(object)) continue;
    const before = triangles.length;
    emit(object, transform, objects, triangles, 0);
    parts.push({ name: object.name, triangles: triangles.length - before });
  }

  return {
    triangles,
    name: summarizeNames(parts),
    parts,
  };
}

// ─── Parsing ─────────────────────────────────────────────────

function findRootModel(models: Map<string, string>): string {
  for (const name of models.keys()) {
    if (name.toLowerCase() === "3d/3dmodel.model") return name;
  }
  for (const [name, xml] of models) {
    if (/<build\b/.test(xml)) return name;
  }
  return models.keys().next().value as string;
}

function parseObjects(xml: string, path: string, unitScale: number, out: Map<string, MeshObject>): void {
  const objectRegex = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let match: RegExpExecArray | null;

  while ((match = objectRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const id = attr(attrs, "id");
    if (!id) continue;

    const object: MeshObject = {
      name: attr(attrs, "name") ?? `object ${id}`,
      type: attr(attrs, "type") ?? "model",
      vertices: [],
      indices: [],
      components: [],
    };

    const vertexRegex = /<vertex\b([^>]*?)\/?>/g;
    let v: RegExpExecArray | null;
    while ((v = vertexRegex.exec(body)) !== null) {
      object.vertices.push({
        x: Number(attr(v[1], "x")) * unitScale,
        y: Number(attr(v[1], "y")) * unitScale,
        z: Number(attr(v[1], "z")) * unitScale,
      });
    }

    const triangleRegex = /<triangle\b([^>]*?)\/?>/g;
    let t: RegExpExecArray | null;
    while ((t = triangleRegex.exec(body)) !== null) {
      object.indices.push(
        Number(attr(t[1], "v1")),
        Number(attr(t[1], "v2")),
        Number(attr(t[1], "v3")),
      );
    }

    const componentRegex = /<component\b([^>]*?)\/?>/g;
    let c: RegExpExecArray | null;
    while ((c = componentRegex.exec(body)) !== null) {
      const objectId = attr(c[1], "objectid");
      if (!objectId) continue;
      const componentPath = normalizePath(attr(c[1], "p:path") ?? path);
      object.components.push({
        ref: `${componentPath}#${objectId}`,
        transform: parseTransform(attr(c[1], "transform"), unitScale),
      });
    }

    out.set(`${path}#${id}`, object);
  }
}

function parseBuildItems(xml: string, path: string, unitScale: number): Array<{ ref: string; transform: Matrix }> {
  const build = xml.match(/<build\b[^>]*>([\s\S]*?)<\/build>/);
  if (!build) return [];

  const items: Array<{ ref: string; transform: Matrix }> = [];
  const itemRegex = /<item\b([^>]*?)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(build[1])) !== null) {
    const objectId = attr(match[1], "objectid");
    if (!objectId) continue;
    if (attr(match[1], "printable") === "0") continue;
    const itemPath = normalizePath(attr(match[1], "p:path") ?? path);
    items.push({
      ref: `${itemPath}#${objectId}`,
      transform: parseTransform(attr(match[1], "transform"), unitScale),
    });
  }
  return items;
}

// ─── Geometry ────────────────────────────────────────────────

function emit(
  object: MeshObject,
  transform: Matrix,
  objects: Map<string, MeshObject>,
  out: Triangle[],
  depth: number,
): void {
  if (depth > MAX_COMPONENT_DEPTH) return;

  const { vertices, indices } = object;
  // A mirroring transform flips the winding; swap two vertices so normals keep pointing outward.
  const mirrored = determinant(transform) < 0;

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = vertices[indices[i]], b = vertices[indices[i + 1]], c = vertices[indices[i + 2]];
    if (!a || !b || !c) continue; // invalid index

    const v1 = apply(transform, a);
    const v2 = apply(transform, mirrored ? c : b);
    const v3 = apply(transform, mirrored ? b : c);
    out.push({ normal: computeNormal(v1, v2, v3), v1, v2, v3 });
  }

  for (const component of object.components) {
    const child = objects.get(component.ref);
    if (!child) continue;
    // The component transform applies first, then this object's placement.
    emit(child, multiply(component.transform, transform), objects, out, depth + 1);
  }
}

function apply(m: Matrix, v: Vec3): Vec3 {
  return {
    x: v.x * m[0] + v.y * m[3] + v.z * m[6] + m[9],
    y: v.x * m[1] + v.y * m[4] + v.z * m[7] + m[10],
    z: v.x * m[2] + v.y * m[5] + v.z * m[8] + m[11],
  };
}

/** Row-vector convention: applying `first` then `second` equals applying first × second. */
function multiply(first: Matrix, second: Matrix): Matrix {
  const r: Matrix = new Array(12).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = row === 3 ? second[9 + col] : 0;
      for (let k = 0; k < 3; k++) {
        sum += first[row * 3 + k] * second[k * 3 + col];
      }
      r[row * 3 + col] = sum;
    }
  }
  return r;
}

function determinant(m: Matrix): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

function parseTransform(value: string | undefined, unitScale: number): Matrix {
  if (!value) return IDENTITY;
  const numbers = value.trim().split(/\s+/).map(Number);
  if (numbers.length !== 12 || numbers.some((n) => !Number.isFinite(n))) return IDENTITY;
  // The translation is in the file's unit; the 3×3 part is unitless.
  numbers[9] *= unitScale;
  numbers[10] *= unitScale;
  numbers[11] *= unitScale;
  return numbers;
}

// ─── Helpers ─────────────────────────────────────────────────

const ATTR_REGEX = new Map<string, RegExp>();

/** Reads one attribute regardless of attribute order. */
function attr(attrs: string, name: string): string | undefined {
  let regex = ATTR_REGEX.get(name);
  if (!regex) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*"([^"]*)"`);
    ATTR_REGEX.set(name, regex);
  }
  return attrs.match(regex)?.[1];
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "");
}

function isPrintable(object: MeshObject): boolean {
  return object.type === "model";
}

function summarizeNames(parts: ThreeMfPart[]): string {
  if (parts.length === 0) return "3mf_model";
  const counts = new Map<string, number>();
  for (const p of parts) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");
}
