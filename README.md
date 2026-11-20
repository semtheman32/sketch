# ChemSketch Clone

A browser-based chemical drawing tool for molecule structures and reaction mechanisms, inspired by ACD/ChemSketch. Claude can control it through an MCP server.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173. Your drawing autosaves in the browser.

**Desktop shortcut (Windows):** run `powershell -ExecutionPolicy Bypass -File scripts/make-shortcut.ps1` once. The "Sketch" shortcut starts the server in the background if needed and opens the app in its own window.

## Using it

| Tool | Key | What it does |
|---|---|---|
| Select | V | Click a molecule to select it, drag to move. Alt+drag moves one atom. Drag on empty space to box-select. Double-click an atom, label or arrow to edit it. |
| Bond | B | Click empty space for a bond, click an atom to grow a chain. Drag to draw a zigzag chain that follows the mouse (move back to remove bonds). Click a bond to change its order. Giving an atom one bond more than usual adds the charge for you (O with three bonds becomes O⁺, N with four N⁺, Br with two Br⁺, B with four B⁻), and an anion or carbocation that forms a bond becomes neutral, so intermediates draw directly. Removing that bond takes the charge away. Bonds no charge can explain, like a fifth bond on carbon, are refused. |
| Atom | A | Pick an element, charge, lone pair or radical, then click atoms. |
| Ring | R | Click empty space, an atom (spiro) or a bond (fused). Keys 3–8 pick a ring size. |
| Reaction arrow | W | Drag to draw: reaction, equilibrium, resonance or retrosynthesis. |
| Curly arrow | M | Click where electrons come from (atom/lone pair or bond), then where they go. Click an arrow to flip its curve, or drag it with Select to bend it. |
| Text | T | Click to add a label like `+` or `Step 1`. |
| Eraser | E | Click or drag over anything. |

**Shortcuts while hovering an atom:** `C N O S P F H I B` change the element, `L` gives Cl, `R` gives Br, `+`/`-` change the charge, `1 2 3` grow a bond. Type a group name quickly to replace the atom with that group: `Me`, `Et`, `Ph`, `Boc`, `OMe`, `CO2Me`, `NO2`, `OTf` and about 30 more. **While hovering a bond:** `1 2 3` set the order, `W` wedge, `D` dash.
**Everywhere:** Ctrl+K opens the command bar (every tool, action, theme and template, or type a molecule name or a question for Claude). Ctrl+Z / Ctrl+Y undo and redo, Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste, Ctrl+D duplicates, Ctrl+Shift+C copies the drawing as an image, Ctrl+E exports, Ctrl+T opens templates, Delete removes, Ctrl+A selects all, Ctrl+S saves, Space+drag or right-drag pans, scroll zooms.

**Selections** get their own bar: rotate 15°, flip left-right or top-bottom, put brackets (or transition-state brackets with ‡) around them, and expand group labels into full structures. Drag the round handle above a selection to rotate it freely (Shift turns off the 15° steps).

**Templates** (Ctrl+T, or the shapes button): 16 rings and heterocycles, the 20 amino acids, every group abbreviation, and mechanism templates for SN1, SN2, E1, E2 and carbonyl addition. Each template is one undo step.

**Looks** (the palette button): seven themes (Refined Lab light and dark, Cyanotype, Lab Notebook, Fume Hood, CPK, Spectrometer) and three drawing styles (Sketch, ACS 1996, Presentation). The theme only changes the screen. Exports always use white paper and the chosen drawing style, and the Export panel shows a live preview with style, transparent background, size and selection-only options.

Type a name (`caffeine`) or SMILES (`CC(=O)O`) in the top box to add a molecule. Names are looked up on PubChem, so that needs internet.

## Chatting with Claude in the app

Click **Claude** in the top bar and type in the box at the bottom of the panel. Claude can read and edit the canvas you're chatting from; every change it makes is one undo step, and the conversation is kept across reloads (**New chat** starts over).

- It uses the Claude account Claude Code is signed into on this computer, so there is no API key and usage counts toward your plan. If the chat says you're not signed in, open a terminal, run `claude`, type `/login` and sign in once.
- It only works under `npm run dev` (the chat runs inside the dev server, in `chat/plugin.mjs`), and Claude only gets the drawing tools: it can't read your files, run commands or browse.

## Practising mechanisms

Open **Claude → Practice** (or Ctrl+K → "Practice mechanisms"). It works a bit like NMR Challenge, but for curly arrows:

1. Get an exercise: pick a topic and level and press **New exercise**, type your own question, or let a Claude Code session add a whole set (see below). The exercise opens on a fresh canvas with the starting materials, the reaction arrow with reagents, and the product (or a "?" when you have to predict it). Undo brings your previous drawing back.
2. Draw the mechanism yourself: curly arrows, intermediates, charges.
3. Press **Check**. Claude grades your drawing against the exercise's hidden answer key (any chemically valid route counts) and gives **Correct / Almost / Not yet** with a step-by-step list. Mistakes come with a guiding question instead of the answer; ids like `c3` highlight the arrow it means.
4. Stuck? **Hint** gives one nudge at a time; **Solution** draws the worked mechanism below your attempt.

The list keeps every exercise with its result, so you can redo the ones you missed. Feedback can be in Dutch or English (NL/EN).

**Exercise sets from another Claude Code session.** Any Claude Code session with the `sketch` MCP server (this folder's `.mcp.json`) can call `practice_add_exercises` with a list of exercises (question, answer key, hints, and a setup of reactant/product SMILES and reagents). So a session that has your lecture notes or a practice exam can make exercises from them and put them straight into the app. That session can also check your drawing itself (`practice_get_state` + `get_document` + `screenshot`) and post its verdict to the Practice tab with `practice_record_feedback`.

## Letting Claude draw from Claude Code

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
- Brackets for intermediates and transition states (‡), square or round, with ‡, n, + or − labels
- Multi-step schemes with `+` signs
- Mechanism templates (SN1, SN2, E1, E2, carbonyl addition), built from real molecules with lone pairs and curly arrows

## Claude control (MCP tools)

| Tool | Purpose |
|---|---|
| `add_molecule` | From SMILES, molfile or name (PubChem/OPSIN) at x,y |
| `add_atom` / `add_bond` / `set_charge` | Atom-level edits |
| `move` / `delete` / `group` | Edit by element ID |
| `add_curly_arrow` | From atom/bond/lone-pair ID to atom/bond ID |
| `add_reaction_arrow` | With reagent and condition text |
| `add_text` | Labels and annotations |
| `add_bracket` | Brackets around items, with ‡ or other labels |
| `clean_structure` | RDKit 2D clean-up |
| `get_document` | Scene JSON plus SMILES, formula and mass per molecule |
| `screenshot` | PNG/SVG of the canvas so Claude can check its work |
| `export` | PNG, SVG, MOL/SDF, SMILES, PDF |
| `undo` / `redo` / `clear` | History |
| `practice_add_exercises` / `practice_open` | Put exercises in the Practice tab; open one |
| `practice_get_state` / `practice_record_feedback` | Read the open exercise (with answer key) and attempts; post a grade or hint |

## Roadmap

- [x] **Phase 1, Foundation**: SVG canvas, document model, undo/redo, pan/zoom
- [x] **Phase 2, Structure drawing**: atoms, bonds, rings, selection and move, valence and formula
- [x] **Phase 3, Import/export**: SMILES, names, MOL, SVG, PNG, clean-up
- [x] **Phase 4, Mechanism tools**: anchored curly arrows, reaction arrows, lone pairs, radicals, brackets and ‡
- [x] **Phase 5, Claude bridge**: WebSocket server, MCP tools, screenshot feedback loop, in-app chat
- [x] **Phase 6, Polish**: motion, drawing previews, copy/paste, rotate/flip, group abbreviations, command bar, templates, style presets, export preview, themes
- [ ] **Phase 7**: Electron package
