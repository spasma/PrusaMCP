export interface FilamentEntry {
  brand: string;
  name: string;
  material: string;
  nozzleTemp: [number, number];  // [min, max]
  bedTemp: [number, number];
  fanSpeed: [number, number];    // [min, max] %
  density: number;               // g/cm³
  maxVolumetricSpeed: number;    // mm³/s — FDM Bible central parameter
  pricePerKg?: number;           // EUR
  notes: string;
  requiresEnclosure?: boolean;
  recommendedSurface?: string;   // FDM Bible: PEI sheet recommendation
}

/**
 * Filament database with brand-specific settings.
 * Temperatures are ranges [recommended_min, recommended_max].
 * MVS values from the FDM Bible (Prusa official): PLA~15, PETG~8, ABS/ASA~11, TPU~1-2.5, PVA/BVOH~4
 */
export const FILAMENT_DB: FilamentEntry[] = [
  // === PLA (FDM Bible: 215/210°C nozzle, 60°C bed, MVS ~15) ===
  { brand: "Prusament", name: "PLA", material: "PLA", nozzleTemp: [210, 220], bedTemp: [40, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 30, notes: "Prusa's quality reference. Tolerance ±0.02mm. Very consistent.", recommendedSurface: "Satin or Smooth PEI" },
  { brand: "123-3D Jupiter", name: "PLA", material: "PLA", nozzleTemp: [200, 220], bedTemp: [50, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 18, notes: "Good value for money." },
  { brand: "eSUN", name: "PLA+", material: "PLA", nozzleTemp: [205, 225], bedTemp: [60, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 20, notes: "PLA+ is tougher than regular PLA. Good layer adhesion." },
  { brand: "Polymaker", name: "PolyTerra PLA", material: "PLA", nozzleTemp: [190, 220], bedTemp: [25, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 22, notes: "Matte, silky finish. Recyclable cardboard spool." },
  { brand: "Bambu Lab", name: "PLA Basic", material: "PLA", nozzleTemp: [190, 220], bedTemp: [25, 60], fanSpeed: [80, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 20, notes: "Solid basic PLA, well calibrated." },
  { brand: "Sunlu", name: "PLA", material: "PLA", nozzleTemp: [190, 220], bedTemp: [50, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 14, pricePerKg: 15, notes: "Budget PLA, quality varies between batches. MVS slightly lowered as a precaution." },
  { brand: "Devil Design", name: "PLA", material: "PLA", nozzleTemp: [200, 235], bedTemp: [50, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 22, notes: "Good quality, wide range of colors." },
  { brand: "Extrudr", name: "PLA NX2", material: "PLA", nozzleTemp: [195, 225], bedTemp: [0, 60], fanSpeed: [50, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 35, notes: "High-end PLA, very even extrusion." },
  { brand: "Generic", name: "PLA", material: "PLA", nozzleTemp: [190, 220], bedTemp: [50, 60], fanSpeed: [100, 100], density: 1.24, maxVolumetricSpeed: 15, pricePerKg: 20, notes: "FDM Bible: strings if too hot. Tune EM/MVS before retraction.", recommendedSurface: "Satin or Smooth PEI" },

  // === PETG (FDM Bible: 230/240°C nozzle, 85/90°C bed, MVS ~8) ===
  { brand: "Prusament", name: "PETG", material: "PETG", nozzleTemp: [230, 250], bedTemp: [80, 90], fanSpeed: [30, 50], density: 1.27, maxVolumetricSpeed: 8, pricePerKg: 30, notes: "Reference PETG. Tolerance ±0.02mm. Light stringing is normal.", recommendedSurface: "Textured/Satin PEI" },
  { brand: "eSUN", name: "PETG", material: "PETG", nozzleTemp: [230, 250], bedTemp: [75, 90], fanSpeed: [30, 60], density: 1.27, maxVolumetricSpeed: 8, pricePerKg: 22, notes: "Good budget PETG. Dry it if stored for a long time." },
  { brand: "Polymaker", name: "PolyLite PETG", material: "PETG", nozzleTemp: [230, 250], bedTemp: [70, 80], fanSpeed: [50, 80], density: 1.27, maxVolumetricSpeed: 8, pricePerKg: 25, notes: "Less stringing than most PETG." },
  { brand: "Generic", name: "PETG", material: "PETG", nozzleTemp: [225, 245], bedTemp: [80, 90], fanSpeed: [30, 50], density: 1.27, maxVolumetricSpeed: 8, pricePerKg: 22, notes: "FDM Bible: retraction max 0.8-1mm. MVS ~8 mm³/s. Oozing/stringing if too hot.", recommendedSurface: "Textured/Satin PEI" },

  // === ABS (FDM Bible: 255°C nozzle, 100°C bed, MVS ~11) ===
  { brand: "Prusament", name: "ABS", material: "ABS", nozzleTemp: [240, 255], bedTemp: [100, 110], fanSpeed: [0, 15], density: 1.04, maxVolumetricSpeed: 11, pricePerKg: 30, notes: "Closed enclosure required. Good heat resistance.", requiresEnclosure: true },
  { brand: "eSUN", name: "ABS+", material: "ABS", nozzleTemp: [235, 255], bedTemp: [95, 110], fanSpeed: [0, 10], density: 1.04, maxVolumetricSpeed: 11, pricePerKg: 18, notes: "ABS+ warps less than regular ABS.", requiresEnclosure: true },
  { brand: "Generic", name: "ABS", material: "ABS", nozzleTemp: [235, 255], bedTemp: [100, 110], fanSpeed: [0, 0], density: 1.04, maxVolumetricSpeed: 11, pricePerKg: 20, notes: "FDM Bible: enclosure required. Warping: enclosure first, then brim, then bed temp.", requiresEnclosure: true },

  // === ASA (FDM Bible: 260°C nozzle, 105/110°C bed, MVS ~11) ===
  { brand: "Prusament", name: "ASA", material: "ASA", nozzleTemp: [240, 260], bedTemp: [100, 110], fanSpeed: [0, 20], density: 1.07, maxVolumetricSpeed: 11, pricePerKg: 35, notes: "UV resistant, ideal outdoors. Closed enclosure.", requiresEnclosure: true, recommendedSurface: "Smooth or Textured PEI" },
  { brand: "Generic", name: "ASA", material: "ASA", nozzleTemp: [240, 260], bedTemp: [100, 110], fanSpeed: [0, 15], density: 1.07, maxVolumetricSpeed: 11, pricePerKg: 28, notes: "FDM Bible: enclosure and no drafts. Adjust supports/overhang speed rather than fan.", requiresEnclosure: true },

  // === TPU (FDM Bible: 220-240°C nozzle, 55-75°C bed, MVS ~1-2.5) ===
  { brand: "Prusament", name: "TPU 95A", material: "TPU", nozzleTemp: [220, 240], bedTemp: [55, 75], fanSpeed: [30, 60], density: 1.21, maxVolumetricSpeed: 2.5, pricePerKg: 32, notes: "FDM Bible: MVS 1-2.5 mm³/s. Retraction is tricky. Avoid Smooth PEI without glue.", recommendedSurface: "Satin/Textured (not Smooth without glue)" },
  { brand: "Sainsmart", name: "TPU 95A", material: "TPU", nozzleTemp: [220, 240], bedTemp: [40, 60], fanSpeed: [30, 60], density: 1.21, maxVolumetricSpeed: 2, pricePerKg: 30, notes: "Flexible, Shore 95A. Max speed 25mm/s. Direct drive recommended." },
  { brand: "Generic", name: "TPU", material: "TPU", nozzleTemp: [210, 240], bedTemp: [40, 65], fanSpeed: [30, 50], density: 1.21, maxVolumetricSpeed: 2, pricePerKg: 28, notes: "FDM Bible: speed capped via MVS (1-2.5 mm³/s). Minimal retraction.", recommendedSurface: "PA Nylon/Satin/Textured PEI" },

  // === NYLON (FDM Bible: 285°C nozzle, 110°C bed, hygroscopic) ===
  { brand: "Polymaker", name: "PolyMide CoPA", material: "NYLON", nozzleTemp: [250, 270], bedTemp: [70, 90], fanSpeed: [0, 30], density: 1.14, maxVolumetricSpeed: 8, pricePerKg: 45, notes: "Very strong. Dry 12h at 80°C before printing.", requiresEnclosure: true, recommendedSurface: "Special PA Nylon sheet" },
  { brand: "Generic", name: "Nylon", material: "NYLON", nozzleTemp: [250, 285], bedTemp: [70, 110], fanSpeed: [0, 20], density: 1.14, maxVolumetricSpeed: 8, pricePerKg: 35, notes: "FDM Bible: hygroscopic. Drying required. Enclosure is critical. Priorities: bed, surface, enclosure.", requiresEnclosure: true, recommendedSurface: "Special PA Nylon sheet" },

  // === PC (FDM Bible: 275°C nozzle, 110/115°C bed) ===
  { brand: "Prusament", name: "PC Blend", material: "PC", nozzleTemp: [265, 280], bedTemp: [100, 115], fanSpeed: [0, 20], density: 1.20, maxVolumetricSpeed: 8, pricePerKg: 40, notes: "Polycarbonate. Very high strength. Enclosure at 50°C+ required.", requiresEnclosure: true, recommendedSurface: "Textured/Satin PEI (glue as release layer)" },
  { brand: "Generic", name: "PC", material: "PC", nozzleTemp: [260, 280], bedTemp: [100, 115], fanSpeed: [0, 10], density: 1.20, maxVolumetricSpeed: 8, pricePerKg: 38, notes: "FDM Bible: enclosure at 50°C+ required. Can tear the sheet surface. Release layer recommended.", requiresEnclosure: true },

  // === Composites (FDM Bible: variable, hardened nozzle recommended) ===
  { brand: "Generic", name: "PLA Bois", material: "PLA-WOOD", nozzleTemp: [190, 220], bedTemp: [50, 60], fanSpeed: [80, 100], density: 1.15, maxVolumetricSpeed: 10, pricePerKg: 30, notes: "FDM Bible: clogging risk. Nozzle ≥0.5mm recommended.", recommendedSurface: "Smooth PEI" },
  { brand: "Generic", name: "PLA Métal", material: "PLA-METAL", nozzleTemp: [200, 230], bedTemp: [50, 60], fanSpeed: [80, 100], density: 2.0, maxVolumetricSpeed: 8, pricePerKg: 40, notes: "FDM Bible: hardened nozzle required (abrasive). Clogging risk.", recommendedSurface: "Smooth PEI" },

  // === Soluble (FDM Bible: MVS ~4 mm³/s) ===
  { brand: "Prusament", name: "PVA", material: "PVA", nozzleTemp: [190, 210], bedTemp: [45, 60], fanSpeed: [50, 80], density: 1.23, maxVolumetricSpeed: 4, pricePerKg: 60, notes: "FDM Bible: soluble support. MVS ~4 mm³/s. Drying recommended." },
  { brand: "Generic", name: "BVOH", material: "BVOH", nozzleTemp: [190, 210], bedTemp: [45, 60], fanSpeed: [50, 80], density: 1.14, maxVolumetricSpeed: 4, pricePerKg: 65, notes: "FDM Bible: soluble support, alternative to PVA. MVS ~4 mm³/s." },
];

/**
 * Search filament database.
 */
export function searchFilaments(
  query?: string,
  material?: string,
  brand?: string,
): FilamentEntry[] {
  let results = [...FILAMENT_DB];

  if (material) {
    results = results.filter((f) => f.material.toUpperCase() === material.toUpperCase());
  }
  if (brand) {
    results = results.filter((f) => f.brand.toLowerCase().includes(brand.toLowerCase()));
  }
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(
      (f) =>
        f.brand.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        f.material.toLowerCase().includes(q) ||
        f.notes.toLowerCase().includes(q),
    );
  }

  return results;
}

/**
 * Get the best matching filament entry for a brand + material.
 */
export function getFilamentSettings(
  brand: string,
  material: string,
): FilamentEntry | null {
  const exact = FILAMENT_DB.find(
    (f) =>
      f.brand.toLowerCase() === brand.toLowerCase() &&
      f.material.toUpperCase() === material.toUpperCase(),
  );
  if (exact) return exact;

  // Fallback to generic
  return FILAMENT_DB.find(
    (f) => f.brand === "Generic" && f.material.toUpperCase() === material.toUpperCase(),
  ) ?? null;
}
