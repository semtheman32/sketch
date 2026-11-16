# ChemSketch Clone

A browser-based chemical drawing tool for molecule structures and reaction mechanisms, inspired by ACD/ChemSketch. Claude can control it through an MCP server.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173. Your drawing autosaves in the browser.

## Using it

| Tool | Key | What it does |
|---|---|---|
| Select | V | Click a molecule to select it, drag to move. Alt+drag moves one atom. Drag on empty space to box-select. Double-click an atom, label or arrow to edit it. |
| Bond | B | Click empty space for a bond, click an atom to grow a chain, drag from an atom to aim. Click a bond to change its order. |
| Atom | A | Pick an element, charge, lone pair or radical, then click atoms. |
| Ring | R | Click empty space, an atom (spiro) or a bond (fused). Keys 3–8 pick a ring size. |
| Reaction arrow | W | Drag to draw: reaction, equilibrium, resonance or retrosynthesis. |
| Curly arrow | M | Click where electrons come from (atom/lone pair or bond), then where they go. Click an arrow to flip its curve, or drag it with Select to bend it. |
| Text | T | Click to add a label like `+` or `Step 1`. |
| Eraser | E | Click or drag over anything. |

**Shortcuts while hovering an atom:** `C N O S P F H I B` change the element, `L` gives Cl, `R` gives Br, `+`/`-` change the charge, `1 2 3` grow a bond. **While hovering a bond:** `1 2 3` set the order, `W` wedge, `D` dash.
**Everywhere:** Ctrl+Z / Ctrl+Y undo and redo, Delete removes, Ctrl+A selects all, Ctrl+S saves, Space+drag or right-drag pans, scroll zooms.

Type a name (`caffeine`) or SMILES (`CC(=O)O`) in the top box to add a molecule. Names are looked up on PubChem, so that needs internet.

## Letting Claude draw

1. Run `npm run dev` and keep the page open.
2. Open Claude Code in this folder. It reads `.mcp.json` and starts `bridge/server.mjs` (approve the `sketch` MCP server when asked).
3. Ask, for example: "draw the E1 mechanism of tert-butyl bromide". The Claude button in the app turns green when the bridge is connected, and its panel lists Claude's edits. Every edit is one undo step.

To check the bridge without Claude: `node scripts/test-bridge.mjs` draws an SN2 mechanism, saves a screenshot to `sn2.png`, then restores your drawing.

## Design principles

ChemSketch has too many menus, modes and dialogs. This app does less, and keeps it out of the way.

- **One mode.** No separate Structure and Draw modes. Molecules, arrows and text all live on the same canvas.
- **Eight tools, no more.** Select, Bond, Atom, Ring, Reaction arrow, Curly arrow, Text and Eraser sit in one slim left toolbar.
- **Options appear only when needed.** Picking a tool shows a small floating bar of its options (for example single, double, triple, wedge or dash for Bond). It hides again when you switch tools.
- **No dialogs.** Element properties open in a small popover beside the selection, not a modal window.
- **The canvas gets the space.** A thin top bar holds only the file name, undo/redo, Export and the Claude toggle.
- **Quiet info.** A small status line shows the formula and mass of the selection. There are no property panels.
- **Keyboard first.** Hover an atom and type `N`, `O`, `Cl` and so on to change it. Press `1`, `2` or `3` over a bond to set its order, and `5` or `6` to drop a ring.
- **Claude panel can be hidden.** The chat panel on the right is collapsible and stays closed by default.
- **Calm visual style.** A neutral palette with one accent color, curly arrows in a single highlight color, and light and dark themes.

## Stack

- **TypeScript + React + Vite** for the UI
- **SVG canvas** for rendering, so output exports cleanly and every element has an ID
- **RDKit.js (WASM)** for chemistry: SMILES/MOL parsing, valence, formula and mass, 2D clean-up
- **Node bridge server** exposing an MCP server so Claude can drive the canvas
- **Electron** (optional, later) to package it as a desktop app

## Architecture

1. **Document model**: JSON scene of `atoms`, `bonds`, `arrows`, `texts`, `shapes`, `groups`, all with stable IDs.
2. **Command bus**: every edit is a command with undo/redo. The mouse UI and Claude dispatch the same commands.
3. **Chemistry service**: wraps RDKit for conversion between the scene and molfile/SMILES, plus validation.
4. **Renderer**: bonds (single, double, triple, wedge, dash, aromatic), atom labels with implicit H, charges, lone pairs, arrows.
5. **Tools layer**: select, atom, bond, ring, chain, eraser, arrow, text, pan/zoom.

## Reaction mechanism features

- Curly arrows (full-headed for electron pairs, half-headed for radicals) as Bézier curves anchored to atoms, bonds or lone pairs
- Reaction arrows: forward, reversible, equilibrium, resonance, retrosynthetic, with reagent/condition text
- Lone-pair dots, radicals, circled charges
- Brackets for intermediates and transition states (‡)
- Multi-step schemes with `+` signs and alignment helpers
- Mechanism templates (SN1, SN2, E1, E2, carbonyl addition)

## Claude control (MCP tools)

| Tool | Purpose |
|---|---|
| `add_molecule` | From SMILES, molfile or name (PubChem/OPSIN) at x,y |
| `add_atom` / `add_bond` / `set_charge` | Atom-level edits |
| `move` / `delete` / `group` | Edit by element ID |
| `add_curly_arrow` | From atom/bond/lone-pair ID to atom/bond ID |
| `add_reaction_arrow` | With reagent and condition text |
| `add_text` | Labels and annotations |
| `clean_structure` | RDKit 2D clean-up |
| `get_document` | Scene JSON plus SMILES, formula and mass per molecule |
| `screenshot` | PNG/SVG of the canvas so Claude can check its work |
| `export` | PNG, SVG, MOL/SDF, SMILES, PDF |
| `undo` / `redo` / `clear` | History |

## Roadmap

- [x] **Phase 1, Foundation**: SVG canvas, document model, undo/redo, pan/zoom
- [x] **Phase 2, Structure drawing**: atoms, bonds, rings, selection and move, valence and formula
- [x] **Phase 3, Import/export**: SMILES, names, MOL, SVG, PNG, clean-up
- [x] **Phase 4, Mechanism tools**: anchored curly arrows, reaction arrows, lone pairs, radicals (brackets still to do)
- [x] **Phase 5, Claude bridge**: WebSocket server, MCP tools, screenshot feedback loop
- [ ] **Phase 6, Polish**: brackets and ‡, mechanism templates, copy/paste, Electron package
