// Smoke test: starts the bridge as an MCP server and drives the open app (needs `npm run dev` + browser tab).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { writeFileSync } from 'node:fs'

const client = new Client({ name: 'sketch-test', version: '1.0.0' })
await client.connect(new StdioClientTransport({ command: 'node', args: ['bridge/server.mjs'], stderr: 'inherit' }))
const tools = await client.listTools()
console.log('tools:', tools.tools.map(t => t.name).join(', '))

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const c = r.content[0]
  if (r.isError) throw new Error(`${name}: ${c.text}`)
  return c.type === 'text' ? (c.text.startsWith('{') || c.text.startsWith('[') ? JSON.parse(c.text) : c.text) : c
}

// wait for the app to connect
for (let i = 0; i < 20; i++) {
  try { await call('get_document'); break } catch (e) { if (i === 19) throw e; await new Promise(r => setTimeout(r, 1000)) }
}

// add_molecule answers in text: "Atoms (index:id): 0:a1 C 0,0; …" and "Bonds: b1 a1-a2; …"
const atomIds = text => [...text.matchAll(/\d+:(a\d+)/g)].map(m => m[1])
const bondBetween = (text, x, y) => [...text.matchAll(/(b\d+) (a\d+)[-=#](a\d+)/g)].find(m => (m[2] === x && m[3] === y) || (m[2] === y && m[3] === x))[1]

const out = process.argv[2] ?? 'sn2.png'
const saved = await call('export_drawing', { format: 'json' })
await call('clear_canvas')
const oh = await call('add_molecule', { smiles: '[OH-]', x: 0, y: 0 })
const o = atomIds(oh)[0]
await call('set_atom', { id: o, lone_pairs: 3 })
const rx = await call('add_molecule', { smiles: 'BrCC', x: 110, y: 0 })
const [br, c1] = atomIds(rx)
const cBr = bondBetween(rx, br, c1)
await call('set_atom', { id: br, lone_pairs: 3 })
await call('add_curly_arrow', { from: o, to: c1, bend: -1 })
await call('add_curly_arrow', { from: cBr, to: br, bend: 1 })
await call('add_reaction_arrow', { x1: 190, y1: 0, x2: 280, y2: 0, below: 'SN2' })
await call('add_molecule', { smiles: 'OCC', x: 340, y: 0 })
const brm = await call('add_molecule', { smiles: '[Br-]', x: 440, y: 0 })
await call('set_atom', { id: atomIds(brm)[0], lone_pairs: 4 })
await call('add_text', { text: '+', x: 395, y: 5 })
const doc = await call('get_document')
console.log(doc)
const shot = await call('screenshot')
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('screenshot saved', out)
await call('set_document', { doc: JSON.stringify(saved) })
console.log('restored the previous drawing')
await client.close()
