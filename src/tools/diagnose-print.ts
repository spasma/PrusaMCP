import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * FDM Bible defect diagnostic database: comprehensive post-print troubleshooting.
 *
 * Input is matched in English and French: `aliases` holds terms in both
 * languages, `symptoms` (displayed) is English, and `symptomsFr` keeps the
 * original French symptoms for fuzzy matching only.
 */
interface DiagnosticEntry {
  defect: string;
  aliases: string[];
  symptoms: string[];
  symptomsFr: string[];
  causes: string[];
  fixes: string[];
  preventionSettings: Record<string, string>;
}

const DIAGNOSTIC_DB: DiagnosticEntry[] = [
  {
    defect: "Warping / Lifting",
    aliases: [
      "warping", "décollement", "coin qui lève", "curling", "lifting",
      "warped", "corners lifting", "peeling", "detaching", "came loose",
      "bed adhesion", "poor adhesion", "not sticking",
    ],
    symptoms: [
      "Corners lifting off the bed",
      "Distorted base",
      "Part coming loose during the print",
    ],
    symptomsFr: [
      "Coins qui se soulèvent du plateau",
      "Base déformée",
      "Pièce qui se décolle en cours d'impression",
    ],
    causes: [
      "Differential thermal shrinkage (hot → cold)",
      "Bed temperature too low",
      "No enclosure (ABS/ASA/PC/Nylon)",
      "Drafts",
      "Dirty bed surface",
      "First layer poorly calibrated (too high)",
    ],
    fixes: [
      "Closed enclosure required for ABS/ASA/PC/Nylon",
      "Raise bed temp by 5-10°C",
      "Add a 5-10mm brim",
      "Clean the surface (IPA for Smooth PEI, hot soapy water for Textured)",
      "Check Live Adjust Z: the first layer must be well squished",
      "Turn the fan off for the first layers (ABS/ASA)",
      "Use a raft if a brim is not enough",
    ],
    preventionSettings: {
      brim_width: "5-10mm",
      bed_temperature: "+5-10°C",
      first_layer_speed: "lower to 15-20mm/s",
      fan_speed: "0% for the first 3 layers with ABS/ASA",
    },
  },
  {
    defect: "Stringing / Oozing",
    aliases: [
      "stringing", "fils", "oozing", "bave", "filaments entre",
      "strings", "stringy", "ooze", "hairy", "cobweb", "spider web", "wisps",
    ],
    symptoms: [
      "Thin strings between parts of the model",
      "Cobwebs along travel moves",
      "Blobs at restart points",
    ],
    symptomsFr: [
      "Fils fins entre les parties de la pièce",
      "Toiles d'araignée entre les mouvements de déplacement",
      "Blobs aux points de redémarrage",
    ],
    causes: [
      "Nozzle temperature too high",
      "Retraction too short or too slow",
      "Extrusion Multiplier (EM) too high. FDM Bible: calibrate EM BEFORE retraction",
      "Wet filament",
      "Travel speed too low",
    ],
    fixes: [
      "FDM Bible: calibrate EM first (a wrong EM mimics stringing/blobs)",
      "Lower nozzle temperature by 5-10°C",
      "Increase retraction length (+0.2mm, max 2mm MK3 / 3.2mm MINI bowden)",
      "Increase retraction speed (35-45mm/s)",
      "Increase travel speed (150-200mm/s)",
      "Enable wipe (except TPU/flex)",
      "Dry the filament for PETG/Nylon/TPU",
    ],
    preventionSettings: {
      temperature: "-5 to -10°C",
      retract_length: "+0.2mm (max 2mm direct drive)",
      retract_speed: "35-45mm/s",
      travel_speed: "150-200mm/s",
      wipe: "1 (except TPU)",
    },
  },
  {
    defect: "Under-extrusion",
    aliases: [
      "sous-extrusion", "under-extrusion", "manque matière", "couches incomplètes", "gaps",
      "under extrusion", "underextrusion", "under-extruding", "under extruding",
      "missing material", "incomplete layers", "thin walls",
    ],
    symptoms: [
      "Layers with holes or missing sections",
      "Visible gaps in the surface",
      "Incomplete infill",
      "Thin/translucent walls",
    ],
    symptomsFr: [
      "Couches avec des trous ou manques",
      "Surface avec des gaps visibles",
      "Infill incomplet",
      "Parois fines/transparentes",
    ],
    causes: [
      "Temperature too low for the requested flow",
      "MVS (Max Volumetric Speed) exceeded",
      "Partially clogged nozzle",
      "Extrusion Multiplier too low",
      "Wrong filament diameter (check 1.75mm)",
      "Worn or dirty extruder gear",
    ],
    fixes: [
      "Check that MVS is not exceeded (layer height × width × speed < MVS)",
      "Raise nozzle temperature by 5-10°C",
      "Lower print speed",
      "Do a cold pull to clear the nozzle",
      "Calibrate the Extrusion Multiplier (FDM Bible: step 4 of the workflow)",
      "Check extruder tension and gear wear",
      "Measure the filament diameter with calipers",
    ],
    preventionSettings: {
      max_volumetric_speed: "stay within the material's MVS",
      temperature: "+5-10°C",
      extrusion_multiplier: "calibrate with a test cube",
    },
  },
  {
    defect: "Over-extrusion",
    aliases: [
      "sur-extrusion", "over-extrusion", "bourrelets", "blobs", "trop de matière",
      "over extrusion", "overextrusion", "over-extruding", "over extruding",
      "blob", "zits", "too much material", "excess material", "bulging",
    ],
    symptoms: [
      "Rough surface with excess material",
      "Blobs/zits on the walls",
      "Layers bulging out",
      "Excessive elephant foot",
    ],
    symptomsFr: [
      "Surface rugueuse avec excès de matière",
      "Blobs/zits sur les parois",
      "Couches qui débordent",
      "Elephant foot excessif",
    ],
    causes: [
      "Extrusion Multiplier too high",
      "Temperature too high (plastic too runny)",
      "Actual filament diameter > 1.75mm",
      "Flow rate poorly calibrated",
    ],
    fixes: [
      "Calibrate EM with a test cube (FDM Bible: measure the wall thickness)",
      "Lower nozzle temperature by 5°C",
      "Measure the actual filament diameter and set it in the slicer",
      "Check extrusion_multiplier, typically 0.95-1.0",
    ],
    preventionSettings: {
      extrusion_multiplier: "0.95-1.0 (calibrate)",
      temperature: "-5°C if you see bulges",
    },
  },
  {
    defect: "Layer shift",
    aliases: [
      "layer shift", "décalage", "couches décalées", "shifted layers",
      "layer-shift", "layers shifted", "shifted layer", "layer offset",
      "misaligned layers", "skipped steps", "lost steps",
    ],
    symptoms: [
      "Layers offset in X or Y",
      "Part looks 'cut' at one height",
      "Unintended staircase pattern",
    ],
    symptomsFr: [
      "Couches décalées en X ou Y",
      "Pièce comme 'coupée' à un endroit",
      "Motif en escalier non intentionnel",
    ],
    causes: [
      "Acceleration too high",
      "Loose belts",
      "Speed too high for the mechanics",
      "Overheating motor drivers",
      "Physical obstruction (cable, etc.)",
    ],
    fixes: [
      "Lower acceleration (1000mm/s² max without Input Shaper)",
      "Check X/Y belt tension",
      "Lower print speed by 20%",
      "Check that nothing blocks the axes",
      "FDM Bible: Input Shaper allows higher accelerations",
      "Check driver cooling (especially in summer)",
    ],
    preventionSettings: {
      default_acceleration: "1000 (500-800 without Input Shaper)",
      perimeter_speed: "lower by 20%",
    },
  },
  {
    defect: "Ringing / Ghosting",
    aliases: [
      "ringing", "ghosting", "ondulations", "vibrations", "écho",
      "ripples", "rippling", "waves", "wavy", "echo", "vibration",
    ],
    symptoms: [
      "Ripples/waves on flat surfaces",
      "Echoes of sharp corners",
      "Visible vibrations around features",
    ],
    symptomsFr: [
      "Ondulations/vagues sur les surfaces planes",
      "Écho des angles vifs",
      "Vibrations visibles autour des features",
    ],
    causes: [
      "Acceleration too high",
      "Jerk too high",
      "Print speed too high",
      "Printer frame not rigid enough",
    ],
    fixes: [
      "Lower acceleration (500-800mm/s²)",
      "Enable Input Shaper if the firmware supports it",
      "Lower external_perimeter_speed (50% of perimeter_speed)",
      "Check that all frame screws are tight",
      "FDM Bible: acceleration/jerk calibration is step 9 of the workflow",
    ],
    preventionSettings: {
      default_acceleration: "500-800",
      external_perimeter_speed: "50% of perimeter_speed",
    },
  },
  {
    defect: "Elephant foot",
    aliases: [
      "elephant foot", "pied d'éléphant", "base élargie", "première couche écrasée",
      "elephant's foot", "elephants foot", "elephants-foot", "elephant-foot",
      "flared base", "wide base", "squished first layer",
    ],
    symptoms: [
      "Base of the part wider than intended",
      "First layer spreading out",
      "Bulge at the base",
    ],
    symptomsFr: [
      "Base de la pièce plus large que prévu",
      "Première couche qui déborde",
      "Bourrelet à la base",
    ],
    causes: [
      "Live Adjust Z too low (first layer squished too much)",
      "Bed temp too high",
      "No elephant foot compensation in the slicer",
    ],
    fixes: [
      "Adjust Live Adjust Z (raise it slightly)",
      "Enable elefant_foot_compensation = 0.1-0.2mm in PrusaSlicer",
      "Lower bed temp by 5°C for the first layer",
      "FDM Bible: first layer calibration is step 3 of the workflow",
    ],
    preventionSettings: {
      elefant_foot_compensation: "0.1-0.2mm",
      first_layer_bed_temperature: "-5°C if elephant foot appears",
    },
  },
  {
    defect: "Delamination / Layer separation",
    aliases: [
      "délamination", "layer separation", "couches qui se séparent", "splitting",
      "delamination", "delaminating", "delaminated", "layers separating",
      "layer adhesion", "layer bonding", "crack",
    ],
    symptoms: [
      "Layers separating from each other",
      "Horizontal cracks in the part",
      "Part breaks easily along the layers",
    ],
    symptomsFr: [
      "Couches qui se décollent entre elles",
      "Fissures horizontales dans la pièce",
      "Pièce qui se casse facilement en couches",
    ],
    causes: [
      "Temperature too low (weak layer bonding)",
      "Fan too strong (especially ABS/ASA)",
      "Speed too high",
      "Wet filament",
      "Drafts (ABS/ASA)",
    ],
    fixes: [
      "Raise nozzle temperature by 10-15°C",
      "Lower fan speed (0% for ABS/ASA, 50% for PETG)",
      "Closed enclosure for ABS/ASA/PC",
      "Lower print speed",
      "Dry the filament",
      "FDM Bible: layer bonding depends mainly on temperature",
    ],
    preventionSettings: {
      temperature: "+10-15°C",
      max_fan_speed: "0% ABS/ASA, 50% PETG",
    },
  },
  {
    defect: "Clogged nozzle / Clogging",
    aliases: [
      "clogging", "bouchage", "buse bouchée", "nozzle clog", "jam",
      "clog", "blocked nozzle", "not extruding", "no extrusion", "stopped extruding",
      "clicking", "grinding", "heat creep",
    ],
    symptoms: [
      "Extrusion stops mid-print",
      "Extruder clicking",
      "No filament coming out",
      "Sudden under-extrusion",
    ],
    symptomsFr: [
      "Extrusion qui s'arrête en cours d'impression",
      "Claquements de l'extrudeur",
      "Filament qui ne sort plus",
      "Sous-extrusion soudaine",
    ],
    causes: [
      "Heat creep (heat travelling up the heatbreak)",
      "Poor-quality filament / contaminants",
      "Temperature too low for the material",
      "Retraction too long (transition zone)",
      "Faulty hotend fan",
    ],
    fixes: [
      "Do a cold pull to clear it",
      "Check the hotend fan (must run at 100%)",
      "Shorten retraction (max 2mm direct drive, 3.2mm bowden)",
      "Raise nozzle temperature",
      "Replace the nozzle if worn (especially with composites/CF)",
      "FDM Bible: retraction that is too long is the #1 cause of heat creep",
    ],
    preventionSettings: {
      retract_length: "max 2mm (direct drive)",
      temperature: "check the material's range",
    },
  },
];

export function registerDiagnosePrint(server: McpServer) {
  server.registerTool(
    "diagnose_print",
    {
      title: "Diagnose a print defect",
      description:
        "Post-print troubleshooting based on the FDM Bible. " +
        "Describe the observed defect to get the likely causes, " +
        "the fixes to apply, and the PrusaSlicer settings to change. " +
        "Accepts English and French terms.",
      inputSchema: {
        defect: z.string().describe(
          "Description of the observed defect, in English or French (e.g. 'warping', 'stringing', " +
          "'under-extrusion', 'layer shift', 'ringing', 'elephant foot', 'delamination', 'clogged nozzle', " +
          "'sous-extrusion', 'couches décalées', 'buse bouchée')"
        ),
        material: z.string().optional().describe("Material used (PLA, PETG, ABS...)"),
        details: z.string().optional().describe("Additional details about the problem"),
      },
      annotations: {
        title: "Diagnose a print defect",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ defect, material, details }) => {
      const query = defect.toLowerCase().trim();

      // Find matching diagnostics
      const matches = DIAGNOSTIC_DB.filter((entry) =>
        entry.aliases.some((alias) => startsWord(query, alias)) ||
        query.includes(entry.defect.toLowerCase())
      );

      // If no exact match, do fuzzy search on symptoms (English and French)
      if (matches.length === 0) {
        const fuzzy = DIAGNOSTIC_DB.filter((entry) =>
          [...entry.symptoms, ...entry.symptomsFr].some((s) => {
            const sLower = s.toLowerCase();
            return query.split(/\s+/).some((word) => word.length > 3 && sLower.includes(word));
          })
        );
        matches.push(...fuzzy);
      }

      if (matches.length === 0) {
        // Return all available defects as suggestions
        const available = DIAGNOSTIC_DB.map((e) => `- ${e.defect}`).join("\n");
        return {
          content: [{
            type: "text" as const,
            text: `Unrecognized defect: "${defect}"\n\n` +
              `**Defects that can be diagnosed:**\n${available}\n\n` +
              `_Describe the problem in more detail or use one of the terms above._`,
          }],
        };
      }

      const lines: string[] = [];

      for (const entry of matches) {
        lines.push(`## ${entry.defect}`);
        lines.push("");

        lines.push("### Symptoms");
        for (const s of entry.symptoms) {
          lines.push(`- ${s}`);
        }
        lines.push("");

        lines.push("### Likely causes");
        for (const c of entry.causes) {
          lines.push(`- ${c}`);
        }
        lines.push("");

        // Material-specific notes
        if (material) {
          const matUpper = material.toUpperCase();
          const materialNotes: string[] = [];

          if (entry.defect.includes("Warping") && ["ABS", "ASA", "PC", "NYLON"].includes(matUpper)) {
            materialNotes.push(`${matUpper} is particularly prone to warping: a closed enclosure is REQUIRED`);
          }
          if (entry.defect.includes("Stringing") && matUpper === "PETG") {
            materialNotes.push("PETG is known for stringing: lower the temp to 230°C, retraction max 0.8-1mm");
          }
          if (entry.defect.includes("Stringing") && matUpper === "TPU") {
            materialNotes.push("TPU: retraction is very limited (0.5mm max). Accept some stringing or post-process.");
          }
          if (entry.defect.includes("Delamination") && ["ABS", "ASA"].includes(matUpper)) {
            materialNotes.push(`${matUpper}: fan at 0%, closed enclosure, nozzle temp 255-260°C minimum`);
          }

          if (materialNotes.length > 0) {
            lines.push(`### ${matUpper}-specific notes`);
            for (const note of materialNotes) {
              lines.push(`- ${note}`);
            }
            lines.push("");
          }
        }

        lines.push("### Recommended fixes (FDM Bible)");
        for (let i = 0; i < entry.fixes.length; i++) {
          lines.push(`${i + 1}. ${entry.fixes[i]}`);
        }
        lines.push("");

        lines.push("### PrusaSlicer settings to change");
        for (const [key, value] of Object.entries(entry.preventionSettings)) {
          lines.push(`- **${key}**: ${value}`);
        }
        lines.push("");
      }

      if (details) {
        lines.push(`_Details provided: ${details}_`);
        lines.push("");
      }

      lines.push("---");
      lines.push("_Diagnosis based on the FDM Bible (Bible de l'impression 3D FDM) and official Prusa recommendations._");

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}

/**
 * True when `term` occurs in `text` at the start of a word: "stringing" must not match "ringing",
 * while inflections still do ("cracks" for "crack", "jammed" for "jam"). Unicode-aware for French.
 */
function startsWord(text: string, term: string): boolean {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, "u").test(text);
}
