# PrusaMCP

**MCP server for PrusaSlicer**: 18 tools to analyze, configure, slice, render and send your 3D prints from Claude or any MCP client.

PrusaMCP is not a thin CLI wrapper. It analyzes your mesh, recommends settings with a reason for each one, slices with your own PrusaSlicer presets, renders the model, diagnoses defects, and uploads to your printer.

> Built with [Claude Code](https://claude.ai/claude-code).

## Features

- **Native mesh analysis**: binary/ASCII STL and 3MF (multiple objects, transforms, components, Bambu/Orca `p:path` files), no external parser
- **Slicing with your presets**: the printer/print/filament selected in PrusaSlicer, or a 3MF project's own config, with the recommendation applied on top
- **Rendering without screen access**: PNG views of the model with overhangs in red
- **Project insight**: settings, per-object overrides and thumbnail from PrusaSlicer 3MF projects
- **Recommendation engine**: FDM Bible + official Prusa knowledge, with a justification per setting
- **MVS-based speed capping** from the material's max volumetric speed
- **Post-print diagnostics**: diagnostic tree for 9 common defects
- **Filament database**: 30+ filaments with temperatures, MVS and recommended print surface
- **Local printer upload**: PrusaLink (MK4/MK4S, CORE One, XL, MINI) and OctoPrint

## Tools

### Analysis & recommendation (no PrusaSlicer needed)

| Tool | Description |
|------|-------------|
| `analyze_mesh` | Geometry of an STL/3MF: dimensions, volume, overhangs, manifold |
| `check_printability` | Issues: thin walls, bridges, overhangs, stability |
| `suggest_orientation` | Scores 6 orientations (overhangs, height, bed contact) |
| `render_model` | PNG with up to 8 views, overhangs in red; can preview an orientation |
| `recommend_profile` | Full profile recommendation with per-setting justification |
| `generate_prusaslicer_config` | PrusaSlicer `.ini` from a recommendation |
| `estimate_cost` | Filament and electricity cost, print time |
| `search_filament` | Filament database (30+ entries) |
| `print_wizard` | All in one: analysis, printability, orientation, profile, follow-up questions |
| `diagnose_print` | Post-print diagnosis (warping, stringing, under-extrusion...) |

### PrusaSlicer integration

| Tool | Description |
|------|-------------|
| `slice_prusaslicer` | Slice with your presets or the project's config; returns time, grams, cost and printer model |
| `get_current_model` | The model open in PrusaSlicer, its presets, project settings and thumbnail |
| `screenshot_prusaslicer` | Capture the PrusaSlicer window (Windows, macOS) |
| `postprocess_gcode` | Insert a pause, filament change, etc. (ASCII G-code) |
| `upload_print` | Upload to PrusaLink or OctoPrint, optionally start the print |

### Feedback & community

| Tool | Description |
|------|-------------|
| `submit_feedback` | Record how a print turned out |
| `feedback_stats` | Feedback statistics by material and goal |
| `export_feedback` | Anonymized export of your feedback |

All tools carry MCP annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`), so a client can allow the read-only ones without asking.

## Installation

```bash
git clone https://github.com/Noosbai/PrusaMCP.git
cd PrusaMCP
npm install
npm run build
```

## Configuration

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "prusa-mcp": {
      "command": "node",
      "args": ["/path/to/PrusaMCP/build/index.js"],
      "env": {
        "PRUSALINK_URL": "http://192.168.1.50",
        "PRUSALINK_PASSWORD": "password shown on the printer"
      }
    }
  }
}
```

PrusaSlicer is auto-detected in the standard install locations. Set `PRUSASLICER_PATH` only when it lives elsewhere:

- **Windows**: `"C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe"`
- **macOS**: `"/Applications/PrusaSlicer.app"` (the `.app` bundle or the binary inside it, `Contents/MacOS/PrusaSlicer`)

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PRUSASLICER_PATH` | PrusaSlicer CLI: `prusa-slicer-console.exe` on Windows, `PrusaSlicer.app` on macOS | Auto-detected |
| `PRUSASLICER_PROFILES_DIR` | PrusaSlicer profiles folder | Windows: `%APPDATA%/PrusaSlicer`<br>macOS: `~/Library/Application Support/PrusaSlicer`<br>Linux: `~/.config/PrusaSlicer` |
| `PRUSALINK_URL` | Printer address for `upload_print` | — |
| `PRUSALINK_PASSWORD` | PrusaLink password (HTTP Digest), shown on the printer | — |
| `PRUSALINK_USER` | PrusaLink user | `maker` |
| `PRUSALINK_API_KEY` | Instead of user/password, on firmware that uses an API key | — |
| `OCTOPRINT_URL` | OctoPrint address | — |
| `OCTOPRINT_API_KEY` | OctoPrint API key | — |

Credentials are only read from the environment. `upload_print` has no argument for them, so they never appear in a conversation. For Prusa Connect (cloud), use Prusa's official MCP server.

## Usage

### Slicing with your presets

`slice_prusaslicer` picks its configuration in this order:

1. `printer_profile` / `print_profile` / `material_profile` given to the tool (missing ones come from PrusaSlicer's selection)
2. The config inside a 3MF saved by PrusaSlicer
3. The printer, print and filament currently selected in PrusaSlicer
4. Nothing found: PrusaSlicer's generic defaults, with a warning not to send the G-code to a printer

With `goal`, the recommendation is applied on top. By default (`override_scope: "intent"`) only layer height, perimeters, top/bottom layers, infill, supports and brim are overridden, so the vendor profile keeps its tuned speeds, temperatures and retraction. `override_scope: "full"` applies everything.

Printer profiles with binary G-code (CORE One, MK4S, XL...) produce `.bgcode`. Pass `gcode_format: "ascii"` when you want to run `postprocess_gcode` on the result.

### Typical workflow

1. `get_current_model` or `analyze_mesh` for dimensions, overhangs and settings
2. `render_model` to see it, `suggest_orientation` + `render_model` with the rotation to compare orientations
3. `check_printability` for potential issues
4. `slice_prusaslicer` with a `goal`
5. `upload_print` with `start_print: true`

`print_wizard` does steps 1 to 3 at once and asks follow-up questions.

### Goals

| Goal | Description |
|------|-------------|
| `draft` / `prototype` | Fast, quality secondary |
| `standard` | Good quality/time balance |
| `quality` / `fine` | Smooth surface, fine details |
| `strong` / `structural` | Maximum mechanical strength |
| `vase` | Spiral vase mode |
| `speed` | Everything maxed out |

French goal names (`prototype rapide`, `beau rendu`...) are still accepted.

### Supported materials

PLA, PETG, ABS, ASA, TPU, Nylon, PC: official Prusa temperatures, FDM Bible MVS values, drying and enclosure warnings.

## Knowledge base

The recommendation engine is built on:

- **Bible de l'impression 3D FDM**: a comprehensive FDM settings guide for PrusaSlicer
- **Official Prusa documentation**: temperatures, MVS, reference profiles
- **9-step calibration workflow** (mechanical → PID → Z → EM → MVS → retraction → cooling → PA → accel)
- **Diagnostic tree** for 9 common defects with causes and fixes

### MVS (max volumetric speed), the central parameter

| Material | MVS (mm³/s) |
|----------|-------------|
| PLA | ~15 |
| ABS/ASA | ~11 |
| PETG | ~8 |
| Nylon/PC | ~8 |
| PVA/BVOH | ~4 |
| TPU | ~1-2.5 |

## Architecture

```
src/
├── index.ts              # MCP entry point + STDIO transport
├── version.ts            # Version (keep in sync with package.json)
├── types.ts              # TypeScript interfaces
├── config.ts             # PrusaSlicer detection (Windows, macOS, Linux)
├── platform/             # Window title + capture: win32.ts (PowerShell), darwin.ts (CGWindowList + screencapture)
├── prusaslicer-state.ts  # PrusaSlicer.ini (presets, recent projects), window title → file
├── geometry.ts           # Normals, areas, overhang test (bed faces excluded), rotation
├── stl-parser.ts         # Binary/ASCII STL
├── threemf-parser.ts     # 3MF: objects, components, build transforms, p:path, units
├── zip.ts                # ZIP entry reader (3MF)
├── project-3mf.ts        # PrusaSlicer project data: config, per-object settings, thumbnail
├── mesh-analyzer.ts      # Geometric analysis
├── renderer.ts           # Software rasterizer (z-buffer, flat shading, outlines)
├── png.ts                # PNG encoder
├── profile-engine.ts     # Recommendation engine (FDM Bible)
├── ini-writer.ts         # PrusaSlicer .ini generation
├── slice-args.ts         # Preset choice, intent overlay, CLI arguments
├── prusa-cli.ts          # PrusaSlicer CLI runner, G-code statistics
├── bgcode.ts             # Binary G-code metadata reader
├── print-hosts.ts        # PrusaLink (API key / HTTP Digest) and OctoPrint uploads
├── print-issues.ts       # Issue detection + FDM Bible diagnostics
├── orientation.ts        # Orientation scoring
├── cost-estimator.ts     # Cost/time estimation
├── filament-db.ts        # Filament database
├── community-data.json   # Community data (MVS, diagnostics, best practices)
└── tools/                # 18 MCP tools
```

## Development

```bash
npm test                     # build + unit tests (node:test), no PrusaSlicer or printer needed
node test/test-platform.js   # smoke test of detection, window title and capture; needs PrusaSlicer open
```

## Requirements

- **Node.js** >= 20
- **PrusaSlicer** (optional; needed for `slice_prusaslicer`, `get_current_model`, `screenshot_prusaslicer`)
- **Windows or macOS** for `screenshot_prusaslicer` and the window part of `get_current_model`. Slicing also works on Linux.

### macOS: Screen Recording permission

`screenshot_prusaslicer` and `get_current_model` read PrusaSlicer's window through `CGWindowList` and `screencapture`. Without Screen Recording permission, macOS hides window titles and contents. Grant it to the app that runs the MCP server (Claude Desktop, Terminal, VS Code, Cursor...) in **System Settings > Privacy & Security > Screen & System Audio Recording**, then restart that app.

Without it, everything else keeps working:

- `get_current_model` falls back to the most recent project in PrusaSlicer's history, and reads that project's settings and thumbnail from the 3MF.
- `render_model` shows the model itself, without PrusaSlicer.

## License

MIT
