/*
 * The Sketch tools Claude can use, shared by both ways Claude reaches the app:
 *   - bridge/server.mjs: the MCP server Claude Code starts from .mcp.json
 *   - chat/plugin.mjs:   the chatbox inside the app (Claude Agent SDK in the Vite dev server)
 *
 * Each tool names a `method` that src/bridge/client.ts runs in the browser as one undoable edit.
 * `transform` turns the browser's result into an MCP tool result.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as z from 'zod'

export const INSTRUCTIONS = `
Sketch is a 2D chemical drawing canvas (molecules and reaction mechanisms) that the user has open in a browser.

Coordinates: canvas units, x to the right, y DOWNWARD. A standard bond is 40 units long.
IDs: atoms "a…", bonds "b…", reaction arrows "r…", curly arrows "c…", texts "t…", brackets "k…".
Group abbreviations are allowed as an atom's element (Me, Et, iPr, tBu, Ph, Bn, Ac, Bz, Boc, Cbz, Fmoc, Ts, Ms, Tf,
TMS, TBS, OMe, OEt, OAc, OTs, OTf, CO2Me, CO2Et, CO2H, CHO, CN, NO2, CF3, N3…): one bond each, counted in formulas.

For a mechanism or reaction scheme, use draw_mechanism: one call draws every species, curly arrow, "+" and
reaction arrow. Then one screenshot to check it, and fix only what is clearly wrong.

Good workflow for single structures and edits:
1. get_document to see what's already there (call it again whenever the user may have edited by hand).
2. add_molecule with SMILES (or a name) for each species. It returns atom ids in SMILES heavy-atom order,
   so you can find the atom you need. Leave ~60 units between species. Use x/y to place them.
3. For mechanisms: set lone pairs / charges with set_atom, then add_curly_arrow from an atom (its lone pair)
   or a bond, to the atom or bond the electrons move to. half=true for single-electron (radical) arrows.
   Leave out bend: Sketch curves the arrow on the open side, away from other atoms. Only pass bend
   (1 or -1) to flip an arrow that the screenshot shows on the wrong side.
4. add_reaction_arrow between reactants and products, with reagents in "above" and conditions in "below".
   Use add_text for "+" signs between species, as the last step once nothing will move again: put each one
   midway between the two species it separates, on their shared centre line. Text that would land on a
   structure is nudged clear; the result gives its final x and y.
5. Call screenshot to look at the result and fix overlaps or awkward arrows before telling the user it's done.

Getting the chemistry right:
- Draw every species (reactant, intermediate, product, resonance form) from a complete SMILES (draw_mechanism or add_molecule).
  Don't build a new structure by editing a copy atom by atom: that is where wrong structures come from.
- Resonance forms keep exactly the same atoms and connections; only bond orders, charges and lone pairs move.
  Write the SMILES of each form, check the atoms match, and draw the curly arrows on the first form.
- Before replying, compare each molecule's SMILES with what you meant to draw. The results of add_molecule and
  draw_mechanism already give the drawn SMILES, so call get_document again only after edits that don't.
  Delete failed attempts and leftovers. Your reply must describe what is actually on the canvas.
Every tool call is one undo step for the user.

Practice mode (the app's Practice tab): the user solves mechanism exercises by drawing them, then has them checked.
- practice_add_exercises puts exercises in the tab (a whole set at once is fine, e.g. made from lecture notes).
  Give each a setup (reactant SMILES, reagents above/below the arrow, and the product unless they must predict it)
  and a thorough answer_key; the app draws the setup itself. Don't draw the answer.
  Set in_course on each: true when it can be solved with the user's course material, false when it goes beyond.
  practice_set_scope changes that afterwards.
- To check the user's work yourself: practice_get_state (answer key), get_document and screenshot, then
  practice_record_feedback. Accept any chemically valid mechanism; point at mistakes by id and ask a guiding
  question rather than giving the corrected structure. Give reaction_type with every verdict. Written
  explanations are a bonus: a missing one never counts as wrong or lowers the verdict.
`.trim()

export const json = data => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }] })
const image = png => ({ content: [{ type: 'image', data: png, mimeType: 'image/png' }] })

const id = z.string()
const num = z.number()
const order = z.union([z.literal(1), z.literal(2), z.literal(3)])
const arrowKind = z.enum(['forward', 'equilibrium', 'resonance', 'retro'])
const stereo = z.enum(['none', 'wedge', 'dash'])
const textStyle = {
  color: z.string().optional().describe('Hex colour like #d64545; omit for the normal ink colour'),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  size: num.optional().describe('Font size in canvas units; default 14'),
}

/** @type {{ name: string, description: string, shape: Record<string, z.ZodType>, method: string, transform?: (res: any, args: any) => any }[]} */
export const TOOLS = [
  {
    name: 'get_document', method: 'get_document', shape: {},
    description: 'Read everything on the canvas as compact text. Per molecule: "M1 <formula> <SMILES>", then its atoms "a3 OH 120,80 -1 lp3 rad" (id, element with implicit H, x,y, then charge, lone pairs and radical only when present), then its bonds "b2 a1=a3" (- single, = double, # triple; wedge/dash after). Then "Curly: c1 a5>b2 half" (from > to), reaction arrows, texts, brackets and the content bounds.',
  },
  {
    name: 'draw_mechanism', method: 'draw_mechanism',
    description: 'Draw a whole mechanism (or reaction scheme) in ONE call, as one undo step: the species of each step from SMILES left to right with "+" between, its curly arrows, then a reaction arrow to the next step. Rows wrap automatically; by default it goes below everything on the canvas. Lone pairs are added on atoms where a curly arrow starts and on anionic heteroatoms. Prefer this over add_molecule + add_curly_arrow + add_reaction_arrow + add_text for any mechanism.',
    shape: {
      steps: z.array(z.object({
        species: z.array(z.object({ smiles: z.string().describe('Complete SMILES with charges, e.g. "C[C+](C)C" or "[Br-]"; "?" draws a question mark') })).min(1),
        arrows: z.array(z.object({
          from: z.string().describe('Where the electrons start: atom "2.3" (species 2 of this step, its 3rd heavy atom in SMILES order; both count from 1) = its lone pair, or bond "2.3-2.4". "2.3H" is an H on atom 2.3, drawn explicitly (e.g. bond "2.3-2.3H" for a deprotonation).'),
          to: z.string().describe('Where they go: atom or bond, same notation'),
          half: z.boolean().optional().describe('Fishhook (one electron)'),
        })).optional().describe('Curly arrows on the species of this step'),
        then: z.object({ above: z.string().optional(), below: z.string().optional(), kind: arrowKind.optional() }).optional()
          .describe('The reaction arrow after this step: reagents above, conditions below. Leave out on the last step.'),
      })).min(1),
      title: z.string().optional().describe('Bold label above the scheme, e.g. "Solution"'),
      x: num.optional().describe('Left edge; default: left edge of the existing content'),
      y: num.optional().describe('Top edge; default: below the existing content'),
      width: num.optional().describe('Wrap to a new row past this width; default 1000'),
      lone_pairs: z.enum(['arrows', 'heteroatoms', 'none']).optional().describe('Which atoms get lone-pair dots; default arrows'),
    },
  },
  {
    name: 'add_molecule', method: 'add_molecule',
    description: 'Add a molecule from SMILES, a compound name (looked up on PubChem) or a V2000 molfile. Gives it clean 2D coordinates centred at x,y (or to the right of existing content). Returns atom ids in input order.',
    shape: {
      smiles: z.string().optional().describe('SMILES, e.g. "CCBr" or "[OH-]"'),
      name: z.string().optional().describe('Compound name, e.g. "aspirin"'),
      molfile: z.string().optional(),
      x: num.optional().describe('Centre x'),
      y: num.optional().describe('Centre y'),
    },
  },
  {
    name: 'add_atom', method: 'add_atom',
    description: 'Add one atom. Give x,y, or bond_to (an atom id) to grow it off that atom in a sensible direction.',
    shape: {
      element: z.string().default('C'),
      x: num.optional(), y: num.optional(),
      bond_to: id.optional(), order: order.optional(),
      charge: z.number().int().optional(),
    },
  },
  {
    name: 'add_bond', method: 'add_bond', description: 'Bond two existing atoms.',
    shape: { from: id, to: id, order: order.optional(), stereo: stereo.optional().describe('Wedge/dash narrow end is at "from"') },
  },
  {
    name: 'set_atom', method: 'set_atom',
    description: 'Change an atom: element, formal charge, number of lone pairs shown (0–4), radical dot, or position.',
    shape: {
      id, element: z.string().optional(), charge: z.number().int().optional(),
      lone_pairs: z.number().int().min(0).max(4).optional(), radical: z.boolean().optional(),
      x: num.optional(), y: num.optional(),
    },
  },
  {
    name: 'set_bond', method: 'set_bond',
    description: 'Change a bond order or stereo. flip=true swaps its direction (wedge narrow end).',
    shape: { id, order: order.optional(), stereo: stereo.optional(), flip: z.boolean().optional() },
  },
  {
    name: 'move', method: 'move',
    description: 'Move items by dx,dy. With whole_molecule=true, giving any atom id moves its entire molecule.',
    shape: { ids: z.array(id), dx: num, dy: num, whole_molecule: z.boolean().optional() },
  },
  {
    name: 'delete_items', method: 'delete',
    description: 'Delete atoms, bonds, arrows, curly arrows, texts or brackets by id (bonds of deleted atoms go too).',
    shape: { ids: z.array(id) },
  },
  {
    name: 'add_reaction_arrow', method: 'add_reaction_arrow',
    description: 'Add a straight reaction arrow from (x1,y1) to (x2,y2). Without coordinates it goes right of existing content.',
    shape: {
      x1: num.optional(), y1: num.optional(), x2: num.optional(), y2: num.optional(),
      kind: arrowKind.optional(),
      above: z.string().optional().describe('Reagents written above'),
      below: z.string().optional().describe('Conditions written below'),
    },
  },
  {
    name: 'set_reaction_arrow', method: 'set_reaction_arrow', description: 'Edit an existing reaction arrow.',
    shape: {
      id, kind: arrowKind.optional(),
      above: z.string().optional(), below: z.string().optional(),
      x1: num.optional(), y1: num.optional(), x2: num.optional(), y2: num.optional(),
    },
  },
  {
    name: 'add_curly_arrow', method: 'add_curly_arrow',
    description: 'Add a mechanism (curly) arrow showing electron movement. from/to are atom ids (starts at its lone pair if it has one) or bond ids (bond midpoint).',
    shape: {
      from: id, to: id,
      half: z.boolean().optional().describe('true = fishhook, single electron'),
      bend: z.number().min(-3).max(3).optional().describe('Leave out to curve on the open side automatically. 1 curves left of the from→to direction, -1 right.'),
    },
  },
  {
    name: 'add_text', method: 'add_text',
    description: 'Add a text label (e.g. "+", "Step 1", "δ+") with its left baseline at x,y. Optional colour, bold, italic and size.',
    shape: { text: z.string(), x: num.optional(), y: num.optional(), ...textStyle },
  },
  {
    name: 'set_text', method: 'set_text', description: 'Change a text label: its words, position or style.',
    shape: { id, text: z.string().optional(), x: num.optional(), y: num.optional(), ...textStyle },
  },
  {
    name: 'add_bracket', method: 'add_bracket',
    description: 'Put square or round brackets around items (give ids, e.g. the atoms of an intermediate) or a box (x1,y1,x2,y2). label goes top right: "‡" for a transition state, "n" for a repeat unit, "+" or "−" for a charge. shape "box" is decoration instead: a soft coloured panel behind the items (color = hex, e.g. #2e9e5b green, #3b6fd4 blue; none = grey card) with label as its heading top left, e.g. "Onthoud" or "Stap 1".',
    shape: {
      ids: z.array(id).optional(), x1: num.optional(), y1: num.optional(), x2: num.optional(), y2: num.optional(),
      shape: z.enum(['square', 'round', 'box']).optional(), label: z.string().optional(), padding: num.optional(), color: z.string().optional(),
    },
  },
  {
    name: 'clean_structure', method: 'clean',
    description: 'Recompute tidy 2D coordinates for the molecules containing atom_ids (or every molecule).',
    shape: { atom_ids: z.array(id).optional() },
  },
  { name: 'undo', method: 'undo', shape: {}, description: 'Undo the last edit (the user\'s or yours).' },
  { name: 'redo', method: 'redo', shape: {}, description: 'Redo the last undone edit.' },
  {
    name: 'clear_canvas', method: 'clear', shape: {},
    description: 'Remove everything from the canvas (undoable). Ask the user before using this on their work.',
  },
  {
    name: 'screenshot', method: 'screenshot', shape: {},
    description: 'Render the canvas as a PNG so you can check how the drawing looks (layout, overlaps). get_document is cheaper for checking the chemistry.',
    transform: res => image(res.png),
  },
  {
    name: 'export_drawing', method: 'export',
    description: 'Export the drawing as svg, png, mol, smiles or json. With path, writes the file there (relative to the project folder) instead of returning it.',
    shape: { format: z.enum(['svg', 'png', 'mol', 'smiles', 'json']), path: z.string().optional() },
    transform: (res, args) => {
      if (args.path) {
        const file = resolve(process.cwd(), args.path)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, res.png ? Buffer.from(res.png, 'base64') : res.data)
        return json({ saved: file })
      }
      if (res.png) return image(res.png)
      return { content: [{ type: 'text', text: res.data }] }
    },
  },
  {
    name: 'practice_add_exercises', method: 'practice_add',
    description: 'Practice mode: put mechanism exercises in the Practice tab of the app for the user to solve by drawing. The first new one opens on a fresh canvas (Undo brings back the previous drawing) with its setup drawn. The answer key and hints stay hidden until the user asks; the Check button in the app grades against the answer key. See the practice notes in the server instructions.',
    shape: {
      exercises: z.array(z.object({
        title: z.string().optional(),
        question: z.string().describe('The task as the user sees it'),
        answer_key: z.string().describe('Full worked answer for the grader: numbered steps with every curly arrow (from which lone pair/bond to which atom/bond), intermediate SMILES with charges, product SMILES, acceptable alternatives'),
        hints: z.array(z.string()).optional().describe('2–3 hints, gentle to concrete'),
        topic: z.string().optional(), difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
        source: z.string().optional().describe('e.g. "Organic Synthesis 2, lecture 3" or "practice test Q4"'),
        in_course: z.boolean().optional().describe('true if it can be solved with the course material only; false if it goes beyond it (hidden when the user ticks "only course material")'),
        setup: z.object({
          reactants: z.array(z.object({ smiles: z.string(), label: z.string().optional() })).min(1),
          above: z.string().optional(), below: z.string().optional(),
          product: z.array(z.object({ smiles: z.string(), label: z.string().optional() })).optional().describe('Leave out to ask for the product ("?")'),
        }).optional().describe('What the app draws when the exercise opens'),
      })).min(1),
      replace: z.boolean().optional().describe('true replaces the current list instead of adding to it'),
      language: z.enum(['en', 'nl']).optional().describe('Language for the in-app Check, Hint and Solution buttons'),
    },
  },
  {
    name: 'practice_get_state', method: 'practice_state', shape: {},
    description: 'Practice mode: the open exercise (with its answer key, the attempts and all feedback so far) and the list of exercises with their results. Use with get_document and screenshot to check the drawing yourself.',
  },
  {
    name: 'practice_open', method: 'practice_open',
    description: 'Practice mode: open exercise number `index` from the list (redraws its setup on a fresh canvas; Undo brings back the previous drawing).',
    shape: { index: z.number().int().min(0) },
  },
  {
    name: 'practice_set_scope', method: 'practice_scope',
    description: 'Practice mode: mark exercises (by id from practice_get_state) as solvable with the course material (in_course true) or beyond it (false). The Practice tab hides the "false" ones when the user ticks "only course material".',
    shape: { ids: z.array(z.string()).min(1), in_course: z.boolean() },
  },
  {
    name: 'practice_record_feedback', method: 'practice_feedback',
    description: 'Practice mode: show your grading or hint for the open exercise in the Practice tab and count it in the score. Use after checking the drawing yourself.',
    shape: {
      verdict: z.enum(['correct', 'almost', 'incorrect']).optional().describe('Leave out for a hint'),
      reaction_type: z.string().optional().describe('With a verdict: the kind of reaction, e.g. "Zure epoxide-opening (SN1-achtig)"'),
      summary: z.string(),
      points: z.array(z.object({ ok: z.boolean(), text: z.string() })).optional().describe('Step-by-step: what is right and what is wrong; refer to items by id (a12, c3)'),
    },
  },
  {
    name: 'set_document', method: 'set_document',
    description: 'Replace the whole canvas with a saved Sketch JSON document (from export_drawing json).',
    shape: { doc: z.string().describe('JSON text') },
  },
]

/**
 * Run one tool: send its method to the app with `call`, then shape the result for MCP.
 * Errors come back as an error result so Claude can see what went wrong and try again.
 */
export async function runTool(def, args, call) {
  try {
    const res = await call(def.method, args ?? {})
    return (def.transform ?? json)(res, args ?? {})
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err?.message ?? err}` }], isError: true }
  }
}
