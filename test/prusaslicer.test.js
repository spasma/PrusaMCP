// PrusaSlicer.ini, window titles, file resolution, detection, and slice configuration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parsePrusaSlicerIni,
  parseWindowTitle,
  candidateFileNames,
  matchRecentProjects,
  stripModelExtension,
} from "../build/prusaslicer-state.js";
import { detectPrusaSlicerPath, getProfilesDir } from "../build/config.js";
import {
  choosePresets,
  filterSettings,
  buildSliceArgs,
  nozzleFromPresetName,
  materialFromPresetName,
  gcodeFormatSettings,
} from "../build/slice-args.js";

const INI = `
version = 2.9.7

[presets]
filament = Generic PETG @COREONE HF0.4
physical_printer =
print = 0.28mm DRAFT @COREONE HF0.4
printer = Prusa CORE One HF0.4 nozzle

[recent]
skein_directory = /Users/me/Models

[recent_projects]
2 = /Users/me/Downloads/older.3mf
1 = /Users/me/Models/egel-v6-hoekstuk-2x.3mf
10 = /Users/me/oldest.3mf
`;

test("PrusaSlicer.ini: presets, skein directory, recent projects in order", () => {
  const state = parsePrusaSlicerIni(INI);
  assert.deepEqual(state.presets, {
    printer: "Prusa CORE One HF0.4 nozzle",
    print: "0.28mm DRAFT @COREONE HF0.4",
    filament: "Generic PETG @COREONE HF0.4",
    physicalPrinter: null,
  });
  assert.equal(state.skeinDirectory, "/Users/me/Models");
  assert.deepEqual(state.recentProjects, [
    "/Users/me/Models/egel-v6-hoekstuk-2x.3mf",
    "/Users/me/Downloads/older.3mf",
    "/Users/me/oldest.3mf",
  ]);
});

test("window titles in several languages", () => {
  assert.deepEqual(parseWindowTitle("*egel-v6-hoekstuk-2x - PrusaSlicer-2.9.7 gebaseerd op Slic3r"), { name: "egel-v6-hoekstuk-2x", modified: true });
  assert.deepEqual(parseWindowTitle("cube.stl - PrusaSlicer-2.9.7 based on Slic3r"), { name: "cube.stl", modified: false });
  assert.deepEqual(parseWindowTitle("*Sans titre - PrusaSlicer-2.9.4 basé sur Slic3r"), { name: null, modified: true });
  assert.deepEqual(parseWindowTitle("*Naamloos - PrusaSlicer-2.9.7 gebaseerd op Slic3r"), { name: null, modified: true });
  assert.deepEqual(parseWindowTitle("PrusaSlicer-2.9.7 based on Slic3r"), { name: null, modified: false });
});

test("file names: extension handling and recent project matching", () => {
  assert.deepEqual(candidateFileNames("part"), ["part.3mf", "part.stl", "part.obj"]);
  assert.deepEqual(candidateFileNames("part.STL"), ["part.STL"]);
  assert.equal(stripModelExtension("part.v2"), "part.v2");
  assert.equal(stripModelExtension("part.v2.3mf"), "part.v2");
  const recent = parsePrusaSlicerIni(INI).recentProjects;
  assert.deepEqual(matchRecentProjects("EGEL-v6-hoekstuk-2x", recent), ["/Users/me/Models/egel-v6-hoekstuk-2x.3mf"]);
  assert.deepEqual(matchRecentProjects("older.3mf", recent), ["/Users/me/Downloads/older.3mf"]);
  assert.deepEqual(matchRecentProjects("missing", recent), []);
});

test("PRUSASLICER_PATH may point at an .app bundle (macOS)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "prusamcp-app-"));
  const binary = join(dir, "PrusaSlicer.app", "Contents", "MacOS", "PrusaSlicer");
  mkdirSync(join(dir, "PrusaSlicer.app", "Contents", "MacOS"), { recursive: true });
  writeFileSync(binary, "");
  const previous = process.env.PRUSASLICER_PATH;
  t.after(() => { if (previous === undefined) delete process.env.PRUSASLICER_PATH; else process.env.PRUSASLICER_PATH = previous; });

  process.env.PRUSASLICER_PATH = join(dir, "PrusaSlicer.app");
  assert.equal(detectPrusaSlicerPath(), binary);
  process.env.PRUSASLICER_PATH = binary;
  assert.equal(detectPrusaSlicerPath(), binary);
});

test("PRUSASLICER_PROFILES_DIR overrides the platform default", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "prusamcp-profiles-"));
  const previous = process.env.PRUSASLICER_PROFILES_DIR;
  t.after(() => { if (previous === undefined) delete process.env.PRUSASLICER_PROFILES_DIR; else process.env.PRUSASLICER_PROFILES_DIR = previous; });
  process.env.PRUSASLICER_PROFILES_DIR = dir;
  assert.equal(getProfilesDir(), dir);
});

const selected = parsePrusaSlicerIni(INI).presets;
const none = { printer: null, print: null, filament: null, physicalPrinter: null };

test("presets: arguments win and are completed from the selection", () => {
  assert.deepEqual(choosePresets({ material: "Prusament PLA @COREONE HF0.4" }, selected, true), {
    source: "arguments",
    printer: "Prusa CORE One HF0.4 nozzle",
    print: "0.28mm DRAFT @COREONE HF0.4",
    material: "Prusament PLA @COREONE HF0.4",
  });
});

test("presets: a project's own config beats the selection; selection beats nothing", () => {
  assert.equal(choosePresets({}, selected, true).source, "project");
  assert.equal(choosePresets({}, selected, false).source, "prusaslicer");
  assert.equal(choosePresets({}, none, false).source, "none");
});

test("intent scope keeps print intent and drops machine and filament tuning", () => {
  const settings = { layer_height: 0.12, fill_density: "20%", temperature: 215, perimeter_speed: 90, retract_length: 0.8, brim_width: 5, nozzle_diameter: 0.4 };
  assert.deepEqual(filterSettings(settings, "intent"), { layer_height: 0.12, fill_density: "20%", brim_width: 5 });
  assert.deepEqual(filterSettings(settings, "full"), settings);
});

test("nozzle and material from preset names", () => {
  assert.equal(nozzleFromPresetName("Prusa CORE One HF0.4 nozzle"), 0.4);
  assert.equal(nozzleFromPresetName("Original Prusa MK4S 0.6 nozzle"), 0.6);
  assert.equal(nozzleFromPresetName("Original Prusa MK4S"), null);
  assert.equal(materialFromPresetName("Generic PETG @COREONE HF0.4"), "PETG");
  assert.equal(materialFromPresetName("Prusament PLA Blend @COREONE"), "PLA");
  assert.equal(materialFromPresetName("Prusament PC Blend @COREONE"), "PC");
  assert.equal(materialFromPresetName("Generic FLEX @MK4S"), "TPU");
  assert.equal(materialFromPresetName("Some Resin"), null);
  assert.deepEqual(gcodeFormatSettings("ascii"), { binary_gcode: 0 });
  assert.deepEqual(gcodeFormatSettings("auto"), {});
});

test("slice arguments: profiles, then loads, then the action", () => {
  const presets = choosePresets({}, selected, false);
  assert.deepEqual(buildSliceArgs({ input: "/m/a.stl", output: "/m/a.gcode", presets, configIni: "/c.ini", overlayIni: "/o.ini" }), [
    "--printer-profile", "Prusa CORE One HF0.4 nozzle",
    "--print-profile", "0.28mm DRAFT @COREONE HF0.4",
    "--material-profile", "Generic PETG @COREONE HF0.4",
    "--load", "/c.ini",
    "--load", "/o.ini",
    "--export-gcode", "--output", "/m/a.gcode", "/m/a.stl",
  ]);
  assert.deepEqual(buildSliceArgs({ input: "/m/p.3mf", output: "/m/p.gcode", presets: choosePresets({}, selected, true) }), [
    "--export-gcode", "--output", "/m/p.gcode", "/m/p.3mf",
  ]);
});
