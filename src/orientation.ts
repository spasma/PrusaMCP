import type { StlData } from "./types.js";
import { isOnBed, isOverhang, rotateOntoBed, triangleArea } from "./geometry.js";

export interface OrientationResult {
  name: string;
  rotation: { axisX: number; axisY: number; axisZ: number }; // degrees
  overhangPercent: number;
  supportVolume: number;   // rough estimate in mm³
  printHeight: number;     // mm — lower = faster
  bedContact: number;      // mm² — higher = better adhesion
  score: number;           // 0-100
  reasoning: string;
}

/**
 * Test 6 principal orientations (original + 5 rotations) and rank them.
 */
export function suggestOrientation(stl: StlData): OrientationResult[] {
  const orientations: Array<{
    name: string;
    rotation: { axisX: number; axisY: number; axisZ: number };
  }> = [
    {
      name: "Original",
      rotation: { axisX: 0, axisY: 0, axisZ: 0 },
    },
    {
      name: "Front face down (rotate X +90°)",
      rotation: { axisX: 90, axisY: 0, axisZ: 0 },
    },
    {
      name: "Back face down (rotate X -90°)",
      rotation: { axisX: -90, axisY: 0, axisZ: 0 },
    },
    {
      name: "Right face down (rotate Y +90°)",
      rotation: { axisX: 0, axisY: 90, axisZ: 0 },
    },
    {
      name: "Left face down (rotate Y -90°)",
      rotation: { axisX: 0, axisY: -90, axisZ: 0 },
    },
    {
      name: "Upside down (rotate X 180°)",
      rotation: { axisX: 180, axisY: 0, axisZ: 0 },
    },
  ];

  // Pre-compute original height for scoring
  const originalHeight = Math.max(
    stl.triangles.reduce((m, t) => Math.max(m, t.v1.z, t.v2.z, t.v3.z), -Infinity) -
    stl.triangles.reduce((m, t) => Math.min(m, t.v1.z, t.v2.z, t.v3.z), Infinity),
    1,
  );

  const results: OrientationResult[] = [];

  for (const orient of orientations) {
    const transformed = rotateOntoBed(stl.triangles, {
      x: orient.rotation.axisX,
      y: orient.rotation.axisY,
      z: orient.rotation.axisZ,
    });

    let bedContact = 0;
    let overhangCount = 0;
    let surfaceArea = 0;
    let maxZ = -Infinity;

    for (const t of transformed) {
      maxZ = Math.max(maxZ, t.v1.z, t.v2.z, t.v3.z);

      const area = triangleArea(t.v1, t.v2, t.v3);
      surfaceArea += area;

      // Overhang: face pointing down > 45° that does not rest on the bed
      if (isOverhang(t, 0, t.normal.z)) {
        overhangCount++;
      }

      // Bed contact: downward faces lying on the bed
      if (t.normal.z < -0.5 && isOnBed(t, 0)) {
        bedContact += area;
      }
    }

    const overhangPercent = transformed.length > 0 ? (overhangCount / transformed.length) * 100 : 0;
    const printHeight = maxZ > 0 ? maxZ : 0;

    // Rough support volume estimate
    const avgOverhangHeight = printHeight * 0.3;
    const supportVolume = (surfaceArea * overhangPercent / 100) * avgOverhangHeight * 0.1;

    // Score
    let score = 100;
    score -= overhangPercent * 1.5;
    score -= (printHeight / originalHeight - 1) * 10;
    score += Math.min(bedContact / 10, 20);
    score -= supportVolume * 0.01;
    score = Math.max(0, Math.min(100, score));

    // Reasoning
    const parts: string[] = [];
    if (overhangPercent < 5) parts.push("very few overhangs");
    else if (overhangPercent < 15) parts.push("moderate overhangs");
    else parts.push(`${overhangPercent.toFixed(0)}% overhangs`);

    parts.push(`height ${printHeight.toFixed(1)}mm`);

    if (bedContact > 50) parts.push("good bed adhesion");
    else if (bedContact < 5) parts.push("little bed contact");

    results.push({
      name: orient.name,
      rotation: orient.rotation,
      overhangPercent,
      supportVolume,
      printHeight,
      bedContact,
      score: Math.round(score),
      reasoning: parts.join(", "),
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}
