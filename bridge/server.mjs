#!/usr/bin/env node
/*
 * Claude bridge for Sketch.
 *
 * Runs as an MCP server over stdio (Claude Code starts it from .mcp.json) and also
 * hosts a local WebSocket on 127.0.0.1:3917 that the open app connects to.
 * Each MCP tool call is forwarded to the app, which applies it as one undoable edit.
 *
 * stdout belongs to the MCP protocol, so all logging goes to stderr.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { WebSocketServer } from 'ws'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod'

const PORT = Number(process.env.SKETCH_BRIDGE_PORT ?? 3917)
const TIMEOUT_MS = 30_000
const log = (...a) => console.error('[sketch-bridge]', ...a)

// ---------------------------------------------------------------- WebSocket side

let app = null
let wsError = null
let nextId = 1
const pending = new Map()

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT })
wss.on('listening', () => log(`waiting for the app on ws://127.0.0.1:${PORT}`))
wss.on('error', err => {
  wsError = err.code === 'EADDRINUSE'
    ? `Port ${PORT} is already in use, probably by another Claude session's bridge. Close it, then restart this MCP server.`
    : String(err)
  log(wsError)
})
wss.on('connection', socket => {
  if (app && app !== socket) app.close()
  app = socket
  log('app connected')
  socket.on('message', raw => {
    let msg
    try { msg = JSON.parse(String(raw)) } catch { return }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  })
  socket.on('close', () => {
    if (app === socket) { app = null; log('app disconnected') }
  })
})

function call(method, params = {}) {
  if (wsError) return Promise.reject(new Error(wsError))
  if (!app || app.readyState !== 1) {
    return Promise.reject(new Error(
      'The Sketch app is not connected. Ask the user to start it with `npm run dev` in the project folder and open http://localhost:5173 in a browser.'))
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    app.send(JSON.stringify({ id, method, params }))
  })
}

// ---------------------------------------------------------------- MCP side

const INSTRUCTIONS = `
Sketch is a 2D chemical drawing canvas (molecules and reaction mechanisms) that the user has open in a browser.

Coordinates: canvas units, x to the right, y DOWNWARD. A standard bond is 40 units long.
IDs: atoms "a…", bonds "b…", reaction arrows "r…", curly arrows "c…", texts "t…".

Good workflow:
1. get_document to see what's already there (call it again whenever the user may have edited by hand).
2. add_molecule with SMILES (or a name) for each species. It returns atom ids in SMILES heavy-atom order,
   so you can find the atom you need. Leave ~60 units between species. Use x/y to place them.
3. For mechanisms: set lone pairs / charges with set_atom, then add_curly_arrow from an atom (its lone pair)
   or a bond, to the atom or bond the electrons move to. half=true for single-electron (radical) arrows.
   Use bend 1 or -1 to choose which side the arrow curves; pick the side away from other atoms.
4. add_reaction_arrow between reactants and products, with reagents in "above" and conditions in "below".
   Use add_text for "+" signs between species.
5. Call screenshot to look at the result and fix overlaps or awkward arrows before telling the user it's done.
Every tool call is one undo step for the user.
`.trim()

const server = new McpServer({ name: 'sketch', version: '1.0.0' }, { instructions: INSTRUCTIONS })

const json = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] })
const fail = err => ({ content: [{ type: 'text', text: `Error: ${err.message ?? err}` }], isError: true })

function tool(name, description, shape, method, transform = json) {
  server.registerTool(name, { description, inputSchema: shape }, async args => {
    try { return await transform(await call(method, args ?? {}), args ?? {}) } catch (err) { return fail(err) }
  })
}

const id = z.string()
const num = z.number()
const order = z.union([z.literal(1), z.literal(2), z.literal(3)])

tool('get_document',
  'Read everything on the canvas: atoms (with implicit H count), bonds, reaction arrows, curly arrows, texts, and per-molecule formula, mass and SMILES.',
  {}, 'get_document')

tool('add_molecule',
  'Add a molecule from SMILES, a compound name (looked up on PubChem) or a V2000 molfile. Gives it clean 2D coordinates centred at x,y (or to the right of existing content). Returns atom ids in input order.',
  {
    smiles: z.string().optional().describe('SMILES, e.g. "CCBr" or "[OH-]"'),
    name: z.string().optional().describe('Compound name, e.g. "aspirin"'),
    molfile: z.string().optional(),
    x: num.optional().describe('Centre x'),
    y: num.optional().describe('Centre y'),
  }, 'add_molecule')

tool('add_atom',
  'Add one atom. Give x,y, or bond_to (an atom id) to grow it off that atom in a sensible direction.',
  {
    element: z.string().default('C'),
    x: num.optional(), y: num.optional(),
    bond_to: id.optional(), order: order.optional(),
    charge: z.number().int().optional(),
  }, 'add_atom')

tool('add_bond', 'Bond two existing atoms.',
  { from: id, to: id, order: order.optional(), stereo: z.enum(['none', 'wedge', 'dash']).optional().describe('Wedge/dash narrow end is at "from"') },
  'add_bond')

tool('set_atom', 'Change an atom: element, formal charge, number of lone pairs shown (0–4), radical dot, or position.',
  {
    id, element: z.string().optional(), charge: z.number().int().optional(),
    lone_pairs: z.number().int().min(0).max(4).optional(), radical: z.boolean().optional(),
    x: num.optional(), y: num.optional(),
  }, 'set_atom')

tool('set_bond', 'Change a bond order or stereo. flip=true swaps its direction (wedge narrow end).',
  { id, order: order.optional(), stereo: z.enum(['none', 'wedge', 'dash']).optional(), flip: z.boolean().optional() },
  'set_bond')

tool('move', 'Move items by dx,dy. With whole_molecule=true, giving any atom id moves its entire molecule.',
  { ids: z.array(id), dx: num, dy: num, whole_molecule: z.boolean().optional() }, 'move')

tool('delete_items', 'Delete atoms, bonds, arrows, curly arrows or texts by id (bonds of deleted atoms go too).',
  { ids: z.array(id) }, 'delete')

tool('add_reaction_arrow',
  'Add a straight reaction arrow from (x1,y1) to (x2,y2). Without coordinates it goes right of existing content.',
  {
    x1: num.optional(), y1: num.optional(), x2: num.optional(), y2: num.optional(),
    kind: z.enum(['forward', 'equilibrium', 'resonance', 'retro']).optional(),
    above: z.string().optional().describe('Reagents written above'),
    below: z.string().optional().describe('Conditions written below'),
  }, 'add_reaction_arrow')

tool('set_reaction_arrow', 'Edit an existing reaction arrow.',
  {
    id, kind: z.enum(['forward', 'equilibrium', 'resonance', 'retro']).optional(),
    above: z.string().optional(), below: z.string().optional(),
    x1: num.optional(), y1: num.optional(), x2: num.optional(), y2: num.optional(),
  }, 'set_reaction_arrow')

tool('add_curly_arrow',
  'Add a mechanism (curly) arrow showing electron movement. from/to are atom ids (starts at its lone pair if it has one) or bond ids (bond midpoint).',
  {
    from: id, to: id,
    half: z.boolean().optional().describe('true = fishhook, single electron'),
    bend: z.number().min(-3).max(3).optional().describe('Curvature; 1 curves left of the from→to direction, -1 right. Default 1.'),
  }, 'add_curly_arrow')

const textStyle = {
  color: z.string().optional().describe('Hex colour like #d64545; omit for the normal ink colour'),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  size: num.optional().describe('Font size in canvas units; default 14'),
}

tool('add_text', 'Add a text label (e.g. "+", "Step 1", "δ+") with its left baseline at x,y. Optional colour, bold, italic and size.',
  { text: z.string(), x: num.optional(), y: num.optional(), ...textStyle }, 'add_text')

tool('set_text', 'Change a text label: its words, position or style.',
  { id, text: z.string().optional(), x: num.optional(), y: num.optional(), ...textStyle }, 'set_text')

tool('clean_structure', 'Recompute tidy 2D coordinates for the molecules containing atom_ids (or every molecule).',
  { atom_ids: z.array(id).optional() }, 'clean')

tool('undo', 'Undo the last edit (the user\'s or yours).', {}, 'undo')
tool('redo', 'Redo the last undone edit.', {}, 'redo')
tool('clear_canvas', 'Remove everything from the canvas (undoable). Ask the user before using this on their work.', {}, 'clear')

tool('screenshot', 'Render the canvas as a PNG so you can check how the drawing looks.', {}, 'screenshot',
  res => ({ content: [{ type: 'image', data: res.png, mimeType: 'image/png' }] }))

tool('export_drawing',
  'Export the drawing as svg, png, mol, smiles or json. With path, writes the file there (relative to the project folder) instead of returning it.',
  { format: z.enum(['svg', 'png', 'mol', 'smiles', 'json']), path: z.string().optional() },
  'export',
  (res, args) => {
    if (args.path) {
      const file = resolve(process.cwd(), args.path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, res.png ? Buffer.from(res.png, 'base64') : res.data)
      return json({ saved: file })
    }
    if (res.png) return { content: [{ type: 'image', data: res.png, mimeType: 'image/png' }] }
    return { content: [{ type: 'text', text: res.data }] }
  })

tool('set_document', 'Replace the whole canvas with a saved Sketch JSON document (from export_drawing json).',
  { doc: z.string().describe('JSON text') }, 'set_document')

await server.connect(new StdioServerTransport())
log('MCP server ready')
