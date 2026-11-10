import type { Triangle, Vec3, MeshAnalysis } from "./types.js";
import { computeNormal, isOnBed, minZ, triangleArea } from "./geometry.js";

export interface PrintIssue {
  severity: "error" | "warning" | "info";
  category: string;
  message: string;
  detail?: string;
  bibleFdmRef?: string;  // Reference to FDM Bible diagnostic
}

export interface DefectDiagnosis {
  defect: string;
  symptoms: string[];
  causes: string[];
  fixes: string[];
}

export interface PrintabilityReport {
  score: number; // 0-100, higher = more printable
  issues: PrintIssue[];
  summary: string;
  diagnosticHints?: DefectDiagnosis[];  // FDM Bible based hints
}

/**
 * Analyze a mesh for common 3D printing issues.
 */
export function detectPrintIssues(
  triangles: Triangle[],
  analysis: MeshAnalysis,
  nozzleDiameter: number = 0.4,
): PrintabilityReport {
  const issues: PrintIssue[] = [];

  // 1. Manifold check
  if (!analysis.isManifold) {
    issues.push({
      severity: "error",
      category: "Mesh",
      message: `Non-manifold mesh: ${analysis.nonManifoldEdges} open edges`,
      detail: "The slicer may misread inside/outside. Repair in PrusaSlicer or Meshmixer.",
    });
  }

  // 2. Zero-volume / degenerate triangles
  const degenerateCount = countDegenerateTriangles(triangles);
  if (degenerateCount > 0) {
    const pct = ((degenerateCount / triangles.length) * 100).toFixed(1);
    issues.push({
      severity: degenerateCount > triangles.length * 0.01 ? "warning" : "info",
      category: "Mesh",
      message: `${degenerateCount} degenerate triangles (${pct}%)`,
      detail: "Zero-area triangles; can cause slicing artifacts.",
    });
  }

  // 3. Thin walls detection
  const thinWalls = detectThinWalls(triangles, analysis, nozzleDiameter);
  if (thinWalls.hasThinWalls) {
    issues.push({
      severity: "warning",
      category: "Thin walls",
      message: `Sections possibly too thin for a ${nozzleDiameter}mm nozzle`,
      detail: `Smallest detected dimension is ~${thinWalls.minThickness.toFixed(2)}mm. ` +
        `Recommended minimum: ${(nozzleDiameter * 1.2).toFixed(2)}mm (1.2× nozzle). ` +
        `${thinWalls.thinRegions} affected regions.`,
    });
  }

  // 4. Overhang analysis (FDM Bible: overhang>30% → supports needed)
  if (analysis.overhangPercent > 30) {
    issues.push({
      severity: "warning",
      category: "Overhangs",
      message: `${analysis.overhangPercent.toFixed(1)}% of faces are steep overhangs`,
      detail: "Many overhangs; supports needed, or reorient the part.",
      bibleFdmRef: "Support Z contact distance = 50-75% of layer height. Styles: Grid/Snug/Organic.",
    });
  } else if (analysis.overhangPercent > 5) {
    issues.push({
      severity: "info",
      category: "Overhangs",
      message: `${analysis.overhangPercent.toFixed(1)}% moderate overhangs`,
      detail: "Supports recommended for the affected areas.",
      bibleFdmRef: "PrusaSlicer offers Grid, Snug and Organic. Top contact Z distance = 50-75% of layer height.",
    });
  }

  // 5. Bridging detection
  const bridges = detectBridges(triangles, nozzleDiameter);
  if (bridges.maxBridgeLength > 0) {
    const severity = bridges.maxBridgeLength > 20 ? "warning" : "info";
    issues.push({
      severity,
      category: "Bridges",
      message: `Longest detected bridge: ~${bridges.maxBridgeLength.toFixed(1)}mm`,
      detail: bridges.maxBridgeLength > 20
        ? "Bridges >20mm may sag. Lower the bridge speed or add supports."
        : "Short bridges; should be fine with good cooling.",
    });
  }

  // 6. Small features
  if (analysis.hasSmallDetails) {
    const minFeatureSize = nozzleDiameter * 0.8;
    issues.push({
      severity: "info",
      category: "Fine details",
      message: `Fine details detected (${analysis.smallDetailPercent.toFixed(1)}% small triangles)`,
      detail: `Features smaller than ~${minFeatureSize.toFixed(1)}mm may not print correctly. ` +
        `Consider a lower layer height.`,
    });
  }

  // 7. Size check — too small or too large
  const bb = analysis.boundingBox.size;
  if (bb.x < 1 || bb.y < 1 || bb.z < 0.5) {
    issues.push({
      severity: "warning",
      category: "Size",
      message: `Very small part: ${bb.x.toFixed(1)} × ${bb.y.toFixed(1)} × ${bb.z.toFixed(1)}mm`,
      detail: "Very small parts are hard to print; bed adhesion and detail suffer.",
    });
  }

  // 8. Tall and narrow — tip-over risk
  const maxXY = Math.max(bb.x, bb.y);
  if (bb.z > 3 * maxXY && bb.z > 30) {
    issues.push({
      severity: "warning",
      category: "Stability",
      message: `Tall, narrow part (ratio ${(bb.z / maxXY).toFixed(1)}:1)`,
      detail: "Risk of detaching or tipping over. Use a wide brim or a raft.",
    });
  }

  // 9. Very large overhangs at bottom (elephant foot)
  const bottomFaces = countBottomFaces(triangles);
  if (bottomFaces.flatBottomPercent < 5 && triangles.length > 100) {
    issues.push({
      severity: "info",
      category: "Adhesion",
      message: "Very little contact area with the bed",
      detail: `Only ${bottomFaces.flatBottomPercent.toFixed(1)}% of faces touch the bed. Brim recommended.`,
    });
  }

  // Compute printability score
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "error") score -= 25;
    if (issue.severity === "warning") score -= 10;
    if (issue.severity === "info") score -= 3;
  }
  score = Math.max(0, Math.min(100, score));

  // Summary
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  let summary: string;
  if (errorCount > 0) {
    summary = `Critical problems detected (${errorCount} error(s)). Fix before printing.`;
  } else if (warnCount > 0) {
    summary = `Printable with care (${warnCount} warning(s)). Check the settings.`;
  } else {
    summary = "Good printability. No major problems detected.";
  }

  // Generate FDM Bible diagnostic hints based on detected issues
  const diagnosticHints = generateDiagnosticHints(issues);

  return { score, issues, summary, diagnosticHints };
}

// ─── Helpers ─────────────────────────────────────────────────

function countDegenerateTriangles(triangles: Triangle[]): number {
  let count = 0;
  for (const t of triangles) {
    const area = triangleArea(t.v1, t.v2, t.v3);
    if (area < 1e-10) count++;
  }
  return count;
}

/**
 * Detect thin walls by finding opposing faces that are too close.
 * Simplified approach: compute the "thickness" by looking at the min bounding box
 * dimension relative to the nozzle, and checking for narrow cross-sections.
 */
function detectThinWalls(
  triangles: Triangle[],
  analysis: MeshAnalysis,
  nozzleDiameter: number,
): { hasThinWalls: boolean; minThickness: number; thinRegions: number } {
  const bb = analysis.boundingBox.size;
  const minDim = Math.min(bb.x, bb.y, bb.z);
  const minPrintable = nozzleDiameter * 1.2;

  // Quick check: if the smallest bounding box dimension is thin
  if (minDim < minPrintable) {
    return { hasThinWalls: true, minThickness: minDim, thinRegions: 1 };
  }

  // Slice-based thin wall detection: sample Z heights and check cross-section width
  const zMin = analysis.boundingBox.min.z;
  const zMax = analysis.boundingBox.max.z;
  const zRange = zMax - zMin;
  if (zRange <= 0) return { hasThinWalls: false, minThickness: minDim, thinRegions: 0 };

  const sampleCount = Math.min(20, Math.max(5, Math.floor(zRange / 2)));
  let thinRegions = 0;
  let globalMinThickness = minDim;

  for (let i = 0; i < sampleCount; i++) {
    const z = zMin + (zRange * (i + 0.5)) / sampleCount;
    const intersections = sliceAtZ(triangles, z);

    if (intersections.length >= 4) {
      // Sort X coordinates of intersection points
      const xs = intersections.map((p) => p.x).sort((a, b) => a - b);
      // Check gaps between consecutive intersections (wall thickness)
      for (let j = 0; j < xs.length - 1; j += 2) {
        const wallWidth = xs[j + 1] - xs[j];
        if (wallWidth > 0 && wallWidth < minPrintable) {
          thinRegions++;
          globalMinThickness = Math.min(globalMinThickness, wallWidth);
        }
      }
    }
  }

  return {
    hasThinWalls: thinRegions > 0,
    minThickness: globalMinThickness,
    thinRegions,
  };
}

/**
 * Find intersection points of triangles with a horizontal plane at given Z.
 */
function sliceAtZ(triangles: Triangle[], z: number): Vec3[] {
  const points: Vec3[] = [];

  for (const t of triangles) {
    const verts = [t.v1, t.v2, t.v3];
    const edges: [Vec3, Vec3][] = [
      [verts[0], verts[1]],
      [verts[1], verts[2]],
      [verts[2], verts[0]],
    ];

    for (const [a, b] of edges) {
      if ((a.z <= z && b.z >= z) || (b.z <= z && a.z >= z)) {
        const dz = b.z - a.z;
        if (Math.abs(dz) < 1e-10) continue;
        const t_param = (z - a.z) / dz;
        if (t_param < 0 || t_param > 1) continue;
        points.push({
          x: a.x + t_param * (b.x - a.x),
          y: a.y + t_param * (b.y - a.y),
          z,
        });
      }
    }
  }

  return points;
}

/**
 * Detect potential bridge distances by finding horizontal overhangs
 * with no support below.
 */
function detectBridges(
  triangles: Triangle[],
  _nozzleDiameter: number,
): { maxBridgeLength: number; bridgeCount: number } {
  let maxBridgeLength = 0;
  let bridgeCount = 0;

  // Find nearly horizontal faces that are overhangs (normal pointing down)
  // These are potential bridge surfaces; faces on the bed are not.
  const bedZ = minZ(triangles);
  for (const t of triangles) {
    const normal = computeNormal(t.v1, t.v2, t.v3);

    // Nearly horizontal face pointing down = potential bridge
    if (normal.z < -0.9 && !isOnBed(t, bedZ)) {
      // Compute the span of this face in XY
      const xSpan = Math.max(t.v1.x, t.v2.x, t.v3.x) - Math.min(t.v1.x, t.v2.x, t.v3.x);
      const ySpan = Math.max(t.v1.y, t.v2.y, t.v3.y) - Math.min(t.v1.y, t.v2.y, t.v3.y);
      const span = Math.max(xSpan, ySpan);

      if (span > maxBridgeLength) {
        maxBridgeLength = span;
      }
      bridgeCount++;
    }
  }

  return { maxBridgeLength, bridgeCount };
}

/**
 * Count faces at the very bottom of the model (touching the build plate).
 */
function countBottomFaces(
  triangles: Triangle[],
): { flatBottomCount: number; flatBottomPercent: number } {
  if (triangles.length === 0) return { flatBottomCount: 0, flatBottomPercent: 0 };

  // Find the lowest Z
  let minZ = Infinity;
  for (const t of triangles) {
    minZ = Math.min(minZ, t.v1.z, t.v2.z, t.v3.z);
  }

  const threshold = minZ + 0.5; // within 0.5mm of the bottom
  let bottomCount = 0;

  for (const t of triangles) {
    if (t.v1.z < threshold && t.v2.z < threshold && t.v3.z < threshold) {
      const normal = computeNormal(t.v1, t.v2, t.v3);
      if (normal.z < -0.7) { // face pointing down = on build plate
        bottomCount++;
      }
    }
  }

  return {
    flatBottomCount: bottomCount,
    flatBottomPercent: (bottomCount / triangles.length) * 100,
  };
}

// ─── FDM Bible Diagnostic Hints ─────────────────────────────

/**
 * FDM Bible defect diagnostic database.
 * Maps mesh-detected issues to likely print defects and their fixes.
 */
const BIBLE_FDM_DIAGNOSTICS: DefectDiagnosis[] = [
  {
    defect: "Potential warping",
    symptoms: ["Tall, narrow part", "ABS/ASA/PC/Nylon material", "Large contact area"],
    causes: ["Insufficient temperature/adhesion", "Drafts", "Engineering materials without an enclosure"],
    fixes: [
      "Closed enclosure for ABS/ASA/PC/Nylon",
      "Brim 5mm+ minimum",
      "Adequate bed temp (ABS:100°C, PETG:85°C)",
      "Clean surface (IPA/water depending on sheet and material)",
    ],
  },
  {
    defect: "Overhang problems",
    symptoms: ["Overhanging faces >45°", "Poorly formed undersides"],
    causes: ["Overhang too steep without support", "Insufficient cooling"],
    fixes: [
      "Add supports (Grid/Snug/Organic in PrusaSlicer)",
      "Support Z contact = 50-75% of layer height",
      "Reorient the part to minimize overhangs",
      "Increase cooling (except ABS/ASA)",
    ],
  },
  {
    defect: "Weak bridges",
    symptoms: ["Sagging on long bridges", "Strings/threads on bridges"],
    causes: ["Bridge too long without support", "Bridge speed too high", "Insufficient cooling"],
    fixes: [
      "Lower bridge speed (40% of print speed)",
      "Raise bridge fan speed to 100% (except ABS)",
      "Bridge flow ratio: lower slightly if strings appear",
      "Add supports if the bridge is >20mm",
    ],
  },
  {
    defect: "Bed adhesion",
    symptoms: ["Small contact area", "Unstable part"],
    causes: ["Contact area too small", "First layer poorly calibrated", "Dirty surface"],
    fixes: [
      "Brim or raft if the contact area is small",
      "Tune Live Adjust Z during the print",
      "Raise bed +5-10°C if adhesion is marginal",
      "Clean the surface (IPA for PEI, hot water for Textured)",
    ],
  },
  {
    defect: "Lost fine details",
    symptoms: ["Very small features", "High local triangle density"],
    causes: ["Nozzle too large for the details", "Layer height too high"],
    fixes: [
      "Use a smaller nozzle (0.25mm for XY detail)",
      "Lower layer height (25-30% of nozzle diameter)",
      "Prusa advises against <0.10mm (small gain, much longer print)",
    ],
  },
];

/**
 * Generate FDM Bible diagnostic hints based on detected printability issues.
 */
function generateDiagnosticHints(issues: PrintIssue[]): DefectDiagnosis[] {
  const hints: DefectDiagnosis[] = [];
  const categories = new Set(issues.map((i) => i.category));

  if (categories.has("Stability") || categories.has("Adhesion")) {
    const warpHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Potential warping");
    if (warpHint) hints.push(warpHint);
  }

  if (categories.has("Overhangs")) {
    const ohHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Overhang problems");
    if (ohHint) hints.push(ohHint);
  }

  if (categories.has("Bridges")) {
    const brHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Weak bridges");
    if (brHint) hints.push(brHint);
  }

  if (categories.has("Adhesion")) {
    const adhHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Bed adhesion");
    if (adhHint) hints.push(adhHint);
  }

  if (categories.has("Fine details")) {
    const detHint = BIBLE_FDM_DIAGNOSTICS.find((d) => d.defect === "Lost fine details");
    if (detHint) hints.push(detHint);
  }

  return hints;
}
