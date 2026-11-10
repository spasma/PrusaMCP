import type {
  PrintGoal,
  MaterialProfile,
  RecommendedProfile,
  SettingWithReason,
  MeshAnalysis,
} from "./types.js";

// ─── Material Database (Official Prusa values from the FDM Bible) ─────

const MATERIALS: Record<string, MaterialProfile> = {
  PLA: {
    name: "PLA",
    nozzleTemp: 210,
    firstLayerNozzleTemp: 215,
    bedTemp: 60,
    fanSpeed: 100,
    minFanSpeed: 100,
    bridgeFanSpeed: 100,
    retractionLength: 0.8,
    retractionSpeed: 35,
    maxVolumetricSpeed: 15,     // Bible: PLA ~15 mm³/s
    notes: "Easy to print. For stringing, tune EM/MVS before raising retraction.",
    requiresEnclosure: false,
    recommendedSurface: "Satin or Smooth PEI",
  },
  PETG: {
    name: "PETG",
    nozzleTemp: 240,
    firstLayerNozzleTemp: 230,
    bedTemp: 85,
    firstLayerBedTemp: 90,
    fanSpeed: 50,
    minFanSpeed: 30,
    bridgeFanSpeed: 80,
    retractionLength: 0.8,       // Bible: reduced retraction, 0.8-1mm max for PETG
    retractionSpeed: 30,
    maxVolumetricSpeed: 8,       // Bible: PETG MVS ~8 mm³/s
    notes: "Stringing/oozing if too hot. Official MVS ≈8 mm³/s. Retraction max 0.8-1mm.",
    requiresEnclosure: false,
    recommendedSurface: "Textured/Satin PEI",
  },
  ABS: {
    name: "ABS",
    nozzleTemp: 255,
    firstLayerNozzleTemp: 255,
    bedTemp: 100,
    fanSpeed: 0,
    minFanSpeed: 0,
    bridgeFanSpeed: 30,
    retractionLength: 0.8,
    retractionSpeed: 35,
    maxVolumetricSpeed: 11,      // Bible: ABS/ASA ~11 mm³/s
    notes: "Closed enclosure required. Warping: enclosure first, then brim, then bed temp.",
    requiresEnclosure: true,
    recommendedSurface: "Smooth PEI or Textured (with glue if needed)",
  },
  ASA: {
    name: "ASA",
    nozzleTemp: 260,
    firstLayerNozzleTemp: 260,
    bedTemp: 105,
    firstLayerBedTemp: 110,
    fanSpeed: 0,
    minFanSpeed: 0,
    bridgeFanSpeed: 30,
    retractionLength: 0.8,
    retractionSpeed: 35,
    maxVolumetricSpeed: 11,      // Bible: ABS/ASA ~11 mm³/s
    notes: "UV resistant. Enclosure required, no drafts. Adjust supports/overhang speed rather than fan.",
    requiresEnclosure: true,
    recommendedSurface: "Smooth or Textured PEI",
  },
  TPU: {
    name: "TPU",
    nozzleTemp: 230,
    firstLayerNozzleTemp: 230,
    bedTemp: 60,
    firstLayerBedTemp: 65,
    fanSpeed: 50,
    minFanSpeed: 30,
    bridgeFanSpeed: 60,
    retractionLength: 0.5,       // Bible: retraction is tricky for TPU
    retractionSpeed: 20,
    maxVolumetricSpeed: 2,       // Bible: TPU ~1-2.5 mm³/s
    notes: "Speed capped via MVS (1-2.5 mm³/s). Avoid Smooth PEI without a release layer (glue). Direct drive recommended.",
    requiresEnclosure: false,
    recommendedSurface: "PA Nylon / Satin / Textured PEI (not Smooth without glue)",
  },
  NYLON: {
    name: "NYLON",
    nozzleTemp: 285,
    firstLayerNozzleTemp: 285,
    bedTemp: 110,
    fanSpeed: 20,
    minFanSpeed: 10,
    bridgeFanSpeed: 50,
    retractionLength: 1.2,
    retractionSpeed: 30,
    maxVolumetricSpeed: 8,
    notes: "Hygroscopic: drying 12h@80°C required. Enclosure is critical. Priorities: bed, surface, enclosure.",
    requiresEnclosure: true,
    recommendedSurface: "Special PA Nylon sheet",
  },
  PC: {
    name: "PC (Polycarbonate)",
    nozzleTemp: 275,
    firstLayerNozzleTemp: 275,
    bedTemp: 110,
    firstLayerBedTemp: 115,
    fanSpeed: 10,
    minFanSpeed: 0,
    bridgeFanSpeed: 40,
    retractionLength: 0.8,
    retractionSpeed: 35,
    maxVolumetricSpeed: 8,
    notes: "High temperature. Enclosure at 50°C+ required. Can tear the sheet surface; use a release layer when needed.",
    requiresEnclosure: true,
    recommendedSurface: "Textured/Satin PEI (glue as release layer on Smooth)",
  },
};

// ─── Goal Presets ────────────────────────────────────────────

interface GoalPreset {
  layerRatio: number;       // Multiplier on nozzle diameter for layer height
  speedMultiplier: number;  // Multiplier on base speed
  infill: number;           // %
  fillPattern: string;
  perimeters: number;
  description: string;
}

const GOALS: Record<PrintGoal, GoalPreset> = {
  draft: {
    layerRatio: 0.625,   // e.g., 0.25mm for 0.4mm nozzle
    speedMultiplier: 1.5,
    infill: 10,
    fillPattern: "grid",
    perimeters: 2,
    description: "Rapid prototype — max speed, minimal quality",
  },
  standard: {
    layerRatio: 0.5,     // e.g., 0.20mm for 0.4mm nozzle
    speedMultiplier: 1.0,
    infill: 20,
    fillPattern: "grid",
    perimeters: 3,
    description: "Good balance of quality and time",
  },
  quality: {
    layerRatio: 0.3,     // e.g., 0.12mm for 0.4mm nozzle
    speedMultiplier: 0.6,
    infill: 20,
    fillPattern: "gyroid",
    perimeters: 4,
    description: "Nice finish — smooth surface, visible detail",
  },
  strong: {
    layerRatio: 0.5,
    speedMultiplier: 0.8,
    infill: 50,
    fillPattern: "cubic",
    perimeters: 5,
    description: "Strong production part — maximum mechanical strength",
  },
  vase: {
    layerRatio: 0.5,
    speedMultiplier: 0.6,
    infill: 0,
    fillPattern: "rectilinear",
    perimeters: 1,
    description: "Spiral vase mode — 1 perimeter, no infill",
  },
  speed: {
    layerRatio: 0.75,    // max layer height
    speedMultiplier: 2.0,
    infill: 10,
    fillPattern: "grid",
    perimeters: 2,
    description: "Speedrun — big nozzle, everything flat out",
  },
};

// ─── Goal Aliases ────────────────────────────────────────────

// English and French (with and without accents) map to the same goal.
const GOAL_ALIASES: Record<string, PrintGoal> = {
  "draft": "draft",
  "prototype": "draft",
  "rapid prototype": "draft",
  "fast prototype": "draft",
  "quick prototype": "draft",
  "prototyping": "draft",
  "fast": "draft",
  "quick": "draft",
  "rough": "draft",
  "prototype rapide": "draft",
  "rapide": "draft",
  "brouillon": "draft",

  "standard": "standard",
  "normal": "standard",
  "default": "standard",
  "balanced": "standard",
  "medium": "standard",
  "general purpose": "standard",
  "everyday": "standard",
  "équilibré": "standard",
  "equilibre": "standard",

  "quality": "quality",
  "high quality": "quality",
  "best quality": "quality",
  "nice finish": "quality",
  "nice": "quality",
  "beautiful": "quality",
  "smooth": "quality",
  "fine": "quality",
  "fine detail": "quality",
  "detail": "quality",
  "detailed": "quality",
  "high detail": "quality",
  "qualité": "quality",
  "qualite": "quality",
  "beau rendu": "quality",
  "beau": "quality",
  "détail": "quality",

  "strong": "strong",
  "strength": "strong",
  "structural": "strong",
  "functional": "strong",
  "functional part": "strong",
  "production": "strong",
  "robust": "strong",
  "mechanical": "strong",
  "durable": "strong",
  "tough": "strong",
  "sturdy": "strong",
  "solide": "strong",
  "production solide": "strong",
  "résistant": "strong",
  "resistant": "strong",
  "robuste": "strong",

  "vase": "vase",
  "vase mode": "vase",
  "spiral": "vase",
  "spiral vase": "vase",
  "spiral vase mode": "vase",
  "spiralize": "vase",
  "spirale": "vase",
  "mode vase": "vase",
  "vase spirale": "vase",

  "speed": "speed",
  "speedrun": "speed",
  "speed run": "speed",
  "max speed": "speed",
  "maximum speed": "speed",
  "fastest": "speed",
  "very fast": "speed",
  "extrusion maxi": "speed",
  "vitesse max": "speed",
};

// ─── Nozzle Size Reference Table (FDM Bible) ────────────────
// Prusa official: max layer height ≈ 80% nozzle, usable range 25%-75%
// Auto extrusion width = 1.125 × nozzle diameter

interface NozzleSpec {
  minLayerHeight: number;
  maxLayerHeight: number;
  autoExtrusionWidth: number;
  notes: string;
}

function getNozzleSpec(nozzle: number): NozzleSpec {
  return {
    minLayerHeight: round2(nozzle * 0.25),  // Bible: 25% of nozzle
    maxLayerHeight: round2(nozzle * 0.80),   // Bible: 80% of nozzle (Prusa official)
    autoExtrusionWidth: round2(nozzle * 1.125), // Bible: PrusaSlicer default = 1.125×D
    notes: nozzle >= 0.6
      ? `${nozzle}mm nozzle: +10-20°C and a higher MVS are possible if more flow is needed. When capped by MVS, a lower layer height gives "free detail".`
      : nozzle <= 0.25
        ? `${nozzle}mm nozzle: better XY detail. Realistic speeds are lower. Supports are finer and easier to remove.`
        : `${nozzle}mm nozzle: standard. Prusa advises against layers <0.10mm (small gain, much longer print).`,
  };
}

// ─── Main Recommendation Engine ──────────────────────────────

export function recommendProfile(
  printer: string,
  nozzle: number,
  goal: string,
  material: string,
  meshAnalysis?: MeshAnalysis,
  options?: { inputShaper?: boolean },
): RecommendedProfile {
  // Validate nozzle diameter
  if (!nozzle || nozzle <= 0 || nozzle > 3) {
    nozzle = 0.4; // safe fallback
  }

  // Resolve goal
  const resolvedGoal = resolveGoal(goal);
  const preset = GOALS[resolvedGoal];

  // Resolve material
  const materialKey = MATERIALS[material.toUpperCase()] ? material.toUpperCase() : "PLA";
  const mat = MATERIALS[materialKey];

  // Nozzle specs (FDM Bible rules)
  const nozzleSpec = getNozzleSpec(nozzle);

  // Input Shaper mode (FDM Bible: higher accel/speed if firmware supports it)
  const inputShaper = options?.inputShaper ?? false;

  // Base speeds (mm/s) — higher base if Input Shaper enabled
  const baseSpeed = inputShaper ? 80 : 60;
  const baseTravelSpeed = inputShaper ? 200 : 150;

  // Compute settings
  const warnings: string[] = [];

  // Input Shaper warning
  if (inputShaper) {
    warnings.push("Input Shaper mode on — higher speeds and accelerations (FDM Bible: check that the profile matches the firmware)");
  }

  // Layer height: nozzle × ratio, clamped to [25%, 80%] of nozzle (FDM Bible rule)
  const rawLayerHeight = round2(nozzle * preset.layerRatio);
  const layerHeight = clamp(rawLayerHeight, nozzleSpec.minLayerHeight, nozzleSpec.maxLayerHeight);

  // Line width: PrusaSlicer default = 1.125×nozzle, or wider for speed
  const lineWidth = resolvedGoal === "speed"
    ? round2(nozzle * 1.2)
    : nozzleSpec.autoExtrusionWidth;

  // Print speed — compute but then check against MVS
  let printSpeed = Math.round(baseSpeed * preset.speedMultiplier);

  // MVS check: volumetric_flow = layer_height × line_width × speed
  // Bible: MVS is THE central parameter — caps speed automatically
  const maxVolumetricFlow = mat.maxVolumetricSpeed;
  const theoreticalFlow = layerHeight * lineWidth * printSpeed;
  let mvsLimited = false;

  if (theoreticalFlow > maxVolumetricFlow) {
    const cappedSpeed = Math.floor(maxVolumetricFlow / (layerHeight * lineWidth));
    warnings.push(
      `Volumetric flow capped by MVS (${maxVolumetricFlow} mm³/s for ${mat.name}): ` +
      `${printSpeed}mm/s → ${cappedSpeed}mm/s. ` +
      `FDM Bible tip: a lower layer height can give "free detail" without adding print time.`
    );
    printSpeed = cappedSpeed;
    mvsLimited = true;
  }

  // TPU needs slow speed (Bible: speed capped via MVS)
  if (mat.name === "TPU") {
    printSpeed = Math.min(printSpeed, 25);
    if (!mvsLimited) {
      warnings.push("TPU: speed limited to 25mm/s max. Direct drive recommended.");
    }
  }

  const travelSpeed = Math.round(baseTravelSpeed * Math.min(preset.speedMultiplier, 1.5));
  const firstLayerSpeed = Math.round(printSpeed * 0.5);

  // Infill
  let infill = preset.infill;
  let fillPattern = preset.fillPattern;
  if (resolvedGoal === "strong" && meshAnalysis) {
    if (meshAnalysis.volume < 5000) {
      infill = 80;
      warnings.push("Very small part (<5cm³) — infill raised to 80% for strength");
    }
  }

  // Perimeters
  const perimeters = preset.perimeters;

  // Supports — based on mesh analysis
  let supportMaterial = false;
  let supportStyle = "grid";
  // Bible: Top contact Z distance = 50-75% of layer height
  const supportContactDistance = round2(layerHeight * 0.6);
  if (meshAnalysis && meshAnalysis.overhangPercent > 5) {
    supportMaterial = true;
    supportStyle = meshAnalysis.overhangPercent > 20 ? "snug" : "grid";
    warnings.push(
      `${meshAnalysis.overhangPercent.toFixed(1)}% of faces detected as overhangs — supports enabled`
    );
  }

  // Brim — if small footprint or ABS/ASA/Nylon/PC or tall piece
  let brimWidth = 0;
  const needsBrim =
    mat.requiresEnclosure ||
    (meshAnalysis && meshAnalysis.boundingBox.size.z > 3 * Math.max(
      meshAnalysis.boundingBox.size.x,
      meshAnalysis.boundingBox.size.y
    ));

  if (needsBrim) {
    brimWidth = 5;
    warnings.push("Brim enabled (5mm) — warp-prone material or tall/narrow part");
  }

  // Acceleration
  let acceleration = 1000;
  if (resolvedGoal === "speed") acceleration = 2500;
  if (resolvedGoal === "quality") acceleration = 500;
  if (mat.name === "TPU") acceleration = 500;

  // Cooling (Bible: detailed per material)
  const fanSpeed = mat.fanSpeed;
  const minFanSpeed = mat.minFanSpeed;
  const bridgeFanSpeed = mat.bridgeFanSpeed ?? 100;
  let minLayerTime = 10;
  if (resolvedGoal === "quality") {
    minLayerTime = 15;
  }

  // Nozzle temp adjustment for large nozzles (Bible: +10-20°C for 0.6mm+ nozzle to increase flow)
  let nozzleTemp = mat.nozzleTemp;
  let firstLayerNozzleTemp = mat.firstLayerNozzleTemp;
  if (nozzle >= 0.6 && resolvedGoal === "speed") {
    nozzleTemp += 15;
    firstLayerNozzleTemp += 10;
    warnings.push(
      `Nozzle ≥0.6mm in speed mode: nozzle temp +15°C (${nozzleTemp}°C) to keep up with volumetric flow (FDM Bible: PLA prints 10-20°C hotter with a 0.6mm nozzle)`
    );
  } else if (resolvedGoal === "speed") {
    nozzleTemp += 10;
    firstLayerNozzleTemp += 5;
    warnings.push("Speed mode: nozzle temp +10°C to keep up with flow");
  }

  // Bed temp
  const bedTemp = mat.bedTemp;
  const firstLayerBedTemp = mat.firstLayerBedTemp ?? bedTemp;

  // Drying warnings for hygroscopic materials (FDM Bible)
  const DRYING_INFO: Record<string, string> = {
    NYLON: "Nylon: drying required, 12h@80°C. Hygroscopic: store sealed with desiccant.",
    PC: "PC: drying recommended, 8h@80°C. Sensitive to moisture.",
    TPU: "TPU: drying recommended, 4h@50°C. Absorbs moisture quickly.",
    PETG: "PETG: drying recommended, 4-6h@65°C if stringing/bubbles persist. Moderately hygroscopic.",
    PVA: "PVA: drying required, 8h@45°C. Extremely hygroscopic: use right after drying.",
    BVOH: "BVOH: drying required, 6h@50°C. Very hygroscopic.",
  };
  // Keyed by material, not display name: "PC (Polycarbonate)" would never match "PC".
  const dryInfo = DRYING_INFO[materialKey];
  if (dryInfo) {
    warnings.push(`FDM Bible — ${dryInfo}`);
  }

  // Enclosure warnings (FDM Bible)
  if (mat.requiresEnclosure) {
    warnings.push(`${mat.name}: closed enclosure required — ${mat.notes}`);
  }

  // Recommended surface (FDM Bible)
  if (mat.recommendedSurface) {
    warnings.push(`Recommended bed surface: ${mat.recommendedSurface}`);
  }

  // Extrusion multiplier (Bible: fine calibration of the actual flow, default 1.0)
  const extrusionMultiplier = 1.0;

  // Build the recommendation
  const settings: RecommendedProfile["settings"] = {
    layer_height: {
      value: layerHeight,
      reason: `${nozzle}mm nozzle — usable range ${nozzleSpec.minLayerHeight}-${nozzleSpec.maxLayerHeight}mm (FDM Bible: 25%-80% of nozzle diameter). ` +
        `Ratio ${preset.layerRatio} → ${rawLayerHeight}mm (${preset.description})`,
    },
    line_width: {
      value: lineWidth,
      reason: `PrusaSlicer auto = ${nozzleSpec.autoExtrusionWidth}mm (1.125×nozzle). ` +
        `${resolvedGoal === "speed" ? "Speed mode: 1.2×nozzle for max flow." : "Standard PrusaSlicer value."}`,
    },
    perimeters: {
      value: perimeters,
      reason: resolvedGoal === "strong"
        ? "5 perimeters for maximum mechanical strength"
        : resolvedGoal === "vase"
          ? "1 perimeter — spiral vase mode"
          : `${perimeters} perimeters (${preset.description.toLowerCase()})`,
    },
    infill_density: {
      value: infill,
      reason: resolvedGoal === "strong"
        ? `${infill}% — high density for strength`
        : resolvedGoal === "vase"
          ? "0% — vase mode, no infill"
          : `${infill}% — enough for this goal (${preset.description.toLowerCase()})`,
    },
    fill_pattern: {
      value: fillPattern,
      reason: fillPattern === "gyroid"
        ? "Gyroid — isotropic, good strength in every direction, nice finish"
        : fillPattern === "cubic"
          ? "Cubic — best 3D strength for structural parts"
          : "Grid — simple and fast",
    },
    nozzle_temperature: {
      value: nozzleTemp,
      reason: `${mat.name} Prusa official: ${mat.nozzleTemp}°C${nozzleTemp !== mat.nozzleTemp ? ` (raised +${nozzleTemp - mat.nozzleTemp}°C for flow)` : ""}`,
    },
    first_layer_nozzle_temperature: {
      value: firstLayerNozzleTemp,
      reason: firstLayerNozzleTemp > nozzleTemp
        ? `First layer ${firstLayerNozzleTemp}°C, slightly hotter for better adhesion (FDM Bible)`
        : firstLayerNozzleTemp < nozzleTemp
          ? `First layer ${firstLayerNozzleTemp}°C, cooler than the rest (${mat.name}: Prusa official value)`
          : `First layer ${firstLayerNozzleTemp}°C, same as the other layers`,
    },
    bed_temperature: {
      value: bedTemp,
      reason: `${mat.name} — ${bedTemp}°C (Prusa official value)`,
    },
    first_layer_bed_temperature: {
      value: firstLayerBedTemp,
      reason: firstLayerBedTemp !== bedTemp
        ? `First layer: ${firstLayerBedTemp}°C (+5°C or more for initial adhesion, FDM Bible)`
        : `${firstLayerBedTemp}°C — same as the other layers`,
    },
    print_speed: {
      value: printSpeed,
      reason: mvsLimited
        ? `Limited by MVS ${maxVolumetricFlow} mm³/s (${mat.name}). Formula: MVS = layer_height × extrusion_width × speed`
        : `Base ${baseSpeed}mm/s × ${preset.speedMultiplier} (${resolvedGoal})${mat.name === "TPU" ? " — limited for TPU" : ""}`,
    },
    travel_speed: {
      value: travelSpeed,
      reason: `Fast travel — ${travelSpeed}mm/s`,
    },
    first_layer_speed: {
      value: firstLayerSpeed,
      reason: `50% of print speed — first layer adhesion (FDM Bible: the first layer depends on Z calibration and temperature)`,
    },
    support_material: {
      value: supportMaterial,
      reason: meshAnalysis
        ? supportMaterial
          ? `Overhangs detected (${meshAnalysis.overhangPercent.toFixed(1)}%) — supports needed`
          : `No significant overhangs (${meshAnalysis.overhangPercent.toFixed(1)}%)`
        : "No mesh analysis available — check visually",
    },
    support_material_style: {
      value: supportStyle,
      reason: supportStyle === "snug"
        ? "Many overhangs — snug supports for better contact"
        : "Grid supports — standard, easy to remove",
    },
    support_material_contact_distance: {
      value: supportContactDistance,
      reason: `${supportContactDistance}mm — ~60% of layer height (FDM Bible: 50-75% recommended for clean removal)`,
    },
    brim_width: {
      value: brimWidth,
      reason: brimWidth > 0
        ? "Brim to improve adhesion and reduce warping"
        : "No brim needed — good contact area",
    },
    fan_speed: {
      value: fanSpeed,
      reason: fanSpeed === 0
        ? `${mat.name} — fan off (otherwise delamination/warping, FDM Bible)`
        : `${mat.name} — fan at ${fanSpeed}% for optimal cooling`,
    },
    min_fan_speed: {
      value: minFanSpeed,
      reason: `Minimum ${minFanSpeed}%`,
    },
    bridge_fan_speed: {
      value: bridgeFanSpeed,
      reason: `${bridgeFanSpeed}% for bridges — extra cooling needed to set the bridge (FDM Bible)`,
    },
    min_layer_time: {
      value: minLayerTime,
      reason: `${minLayerTime}s minimum per layer — gives the plastic time to cool`,
    },
    retraction_length: {
      value: mat.retractionLength,
      reason: mat.name === "TPU"
        ? `${mat.retractionLength}mm — minimal for flexibles (FDM Bible: TPU retraction is tricky)`
        : mat.name === "PETG"
          ? `${mat.retractionLength}mm — FDM Bible: PETG retraction max 0.8-1mm`
          : `${mat.retractionLength}mm — standard for ${mat.name}. FDM Bible: max 2mm MK3, 3.2mm MINI (bowden).`,
    },
    retraction_speed: {
      value: mat.retractionSpeed,
      reason: `${mat.retractionSpeed}mm/s — retraction speed for ${mat.name}`,
    },
    max_volumetric_speed: {
      value: maxVolumetricFlow,
      reason: `${maxVolumetricFlow} mm³/s — FDM Bible: official value for ${mat.name}. ` +
        `MVS is the central PrusaSlicer control: it caps speeds automatically when needed, ` +
        `with no manual recalculation (Filament Settings override Print Settings).`,
    },
    extrusion_multiplier: {
      value: extrusionMultiplier,
      reason: `${extrusionMultiplier} — fine calibration of the actual flow. FDM Bible: calibrate EM before tuning retraction (a wrong EM looks like stringing/blobs).`,
    },
    acceleration: {
      value: acceleration,
      reason: resolvedGoal === "speed"
        ? "2500mm/s² — high acceleration. FDM Bible: too high = ringing/layer shift."
        : resolvedGoal === "quality"
          ? "500mm/s² — low acceleration to reduce ringing (vibration)"
          : `1000mm/s² — standard compromise. FDM Bible: adjust if you see layer shift or ringing.`,
    },
  };

  return {
    goal: resolvedGoal,
    printer,
    nozzle,
    material: mat.name,
    settings,
    warnings,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function resolveGoal(input: string): PrintGoal {
  const normalized = input.toLowerCase().trim();
  return GOAL_ALIASES[normalized] ?? "standard";
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}
