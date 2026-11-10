import type { Triangle, Vec3 } from "./types.js";

/** A face pointing down more than 45° from vertical needs support: cos(135°). */
export const OVERHANG_NORMAL_Z = -0.707;

/** Faces whose three vertices are this close to the lowest point rest on the bed. */
export const BED_EPSILON_MM = 0.01;

export function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  const ax = v2.x - v1.x, ay = v2.y - v1.y, az = v2.z - v1.z;
  const bx = v3.x - v1.x, by = v3.y - v1.y, bz = v3.z - v1.z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: nx / len, y: ny / len, z: nz / len };
}

export function triangleArea(v1: Vec3, v2: Vec3, v3: Vec3): number {
  const ax = v2.x - v1.x, ay = v2.y - v1.y, az = v2.z - v1.z;
  const bx = v3.x - v1.x, by = v3.y - v1.y, bz = v3.z - v1.z;
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
}

export function minZ(triangles: Triangle[]): number {
  let min = Infinity;
  for (const t of triangles) {
    if (t.v1.z < min) min = t.v1.z;
    if (t.v2.z < min) min = t.v2.z;
    if (t.v3.z < min) min = t.v3.z;
  }
  return min;
}

/** True when the face lies on the build plate, which supports it. */
export function isOnBed(t: Triangle, bedZ: number): boolean {
  const limit = bedZ + BED_EPSILON_MM;
  return t.v1.z <= limit && t.v2.z <= limit && t.v3.z <= limit;
}

/**
 * True when the face points down steeply enough to need support,
 * excluding faces that rest on the bed (bedZ = lowest Z of the mesh).
 */
export function isOverhang(t: Triangle, bedZ: number, normalZ = computeNormal(t.v1, t.v2, t.v3).z): boolean {
  return normalZ < OVERHANG_NORMAL_Z && !isOnBed(t, bedZ);
}

export interface Rotation {
  /** Degrees, applied in the order X, then Y, then Z (right-handed). */
  x?: number;
  y?: number;
  z?: number;
}

/** Returns a function that rotates a point; used for orientation scoring and rendering. */
export function rotation(r: Rotation): (v: Vec3) => Vec3 {
  const rad = Math.PI / 180;
  const [cx, sx] = [Math.cos((r.x ?? 0) * rad), Math.sin((r.x ?? 0) * rad)];
  const [cy, sy] = [Math.cos((r.y ?? 0) * rad), Math.sin((r.y ?? 0) * rad)];
  const [cz, sz] = [Math.cos((r.z ?? 0) * rad), Math.sin((r.z ?? 0) * rad)];

  return (v) => {
    // X
    let { x, y, z } = v;
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    // Y
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    // Z
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    return { x: snap(x), y: snap(y), z: snap(z) };
  };
}

/** Removes float noise like 6.1e-17 from 90° rotations, so bed detection stays exact. */
function snap(n: number): number {
  const rounded = Math.round(n * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Rotates the mesh and drops it on the bed (lowest point at Z = 0). */
export function rotateOntoBed(triangles: Triangle[], r: Rotation): Triangle[] {
  const rotate = rotation(r);
  const rotated = triangles.map((t) => {
    const v1 = rotate(t.v1), v2 = rotate(t.v2), v3 = rotate(t.v3);
    return { normal: computeNormal(v1, v2, v3), v1, v2, v3 };
  });
  const bed = minZ(rotated);
  if (bed !== 0 && Number.isFinite(bed)) {
    for (const t of rotated) {
      t.v1.z -= bed;
      t.v2.z -= bed;
      t.v3.z -= bed;
    }
  }
  return rotated;
}
