/*
 * Connects the app to the Claude bridge (bridge/server.mjs) over a local WebSocket.
 * The bridge forwards MCP tool calls from Claude; each call runs here as one undoable edit.
 */
import { useSyncExternalStore } from 'react'
import type { ArrowKind, BondOrder, BondStereo, Doc, ID } from '../model/types'
import { emptyDoc, kindOf } from '../model/types'
import { BOND } from '../model/geometry'
import { commit, getDoc, newId, redo, replaceDoc, undo } from '../model/store'
import { addAtom, addBond, contentBounds, growBond, moveItems, removeItems, straightenTriple } from '../model/ops'
import { adjacency, componentOf, hCount } from '../chem/chem'
import { writeMolfile } from '../chem/molfile'
import { addMolecule, cleanStructures, exportPngDataUrl, exportSvg, moleculeSummaries, smilesOf } from '../actions'

export const BRIDGE_URL = 'ws://127.0.0.1:3917'

export interface LogEntry { time: number; method: string; ok: boolean; detail?: string }

let state = { connected: false, log: [] as LogEntry[] }
const listeners = new Set<() => void>()
const set = (s: Partial<typeof state>) => { state = { ...state, ...s }; listeners.forEach(l => l()) }
export const useBridge = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)

const r1 = (n: number) => Math.round(n * 10) / 10

async function describe(doc: Doc = getDoc()) {
  const adj = adjacency(doc)
  return {
    note: 'Coordinates are canvas units; y grows downward; a standard bond is 40 units.',
    atoms: Object.values(doc.atoms).map(a => ({
      id: a.id, element: a.element, x: r1(a.x), y: r1(a.y), charge: a.charge,
      lonePairs: a.lonePairs, radical: a.radical, implicitH: hCount(a, adj),
    })),
    bonds: Object.values(doc.bonds).map(b => ({ id: b.id, from: b.a1, to: b.a2, order: b.order, stereo: b.stereo })),
    reactionArrows: Object.values(doc.arrows).map(r => ({ ...r, x1: r1(r.x1), y1: r1(r.y1), x2: r1(r.x2), y2: r1(r.y2) })),
    curlyArrows: Object.values(doc.curlies),
    texts: Object.values(doc.texts).map(t => ({ ...t, x: r1(t.x), y: r1(t.y) })),
    molecules: await moleculeSummaries(doc),
    bounds: contentBounds(doc),
  }
}

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined || v === null) throw new Error(`${what} not found`)
  return v
}

type Params = Record<string, any>

const handlers: Record<string, (p: Params) => unknown> = {
  get_document: () => describe(),

  async add_molecule(p) {
    const input = p.smiles ?? p.name ?? p.molfile
    if (!input) throw new Error('Give smiles, name or molfile')
    const kind = p.smiles ? 'smiles' : p.name ? 'name' : 'molfile'
    const at = p.x !== undefined && p.y !== undefined ? { x: p.x, y: p.y } : undefined
    const res = await addMolecule(String(input), at, kind)
    const doc = getDoc()
    const adj = adjacency(doc)
    return {
      atoms: res.atomIds.map((id, index) => {
        const a = doc.atoms[id]
        return { index, id, element: a.element, x: r1(a.x), y: r1(a.y), charge: a.charge, implicitH: hCount(a, adj) }
      }),
      bonds: res.bondIds.map(id => ({ id, from: doc.bonds[id].a1, to: doc.bonds[id].a2, order: doc.bonds[id].order })),
      smiles: await smilesOf(doc, res.atomIds),
      note: kind === 'smiles' ? 'Atom index follows the heavy-atom order of the SMILES string.' : undefined,
    }
  },

  add_atom(p) {
    return commit(d => {
      const element = p.element ?? 'C'
      let id: ID
      if (p.bond_to && (p.x === undefined || p.y === undefined)) {
        need(d.atoms[p.bond_to], `Atom ${p.bond_to}`)
        id = growBond(d, p.bond_to, (p.order ?? 1) as BondOrder, 'none', element)
      } else {
        id = addAtom(d, p.x ?? 0, p.y ?? 0, element, p.charge ?? 0)
        if (p.bond_to) addBond(d, need(d.atoms[p.bond_to], `Atom ${p.bond_to}`).id, id, (p.order ?? 1) as BondOrder)
      }
      if (p.charge !== undefined) d.atoms[id].charge = p.charge
      return { id, x: r1(d.atoms[id].x), y: r1(d.atoms[id].y) }
    })
  },

  add_bond(p) {
    return commit(d => {
      need(d.atoms[p.from], `Atom ${p.from}`); need(d.atoms[p.to], `Atom ${p.to}`)
      const id = addBond(d, p.from, p.to, (p.order ?? 1) as BondOrder, (p.stereo ?? 'none') as BondStereo)
      if (p.order) d.bonds[id].order = p.order
      return { id }
    })
  },

  set_atom(p) {
    return commit(d => {
      const a = need(d.atoms[p.id], `Atom ${p.id}`)
      if (p.element !== undefined) a.element = p.element
      if (p.charge !== undefined) a.charge = p.charge
      if (p.lone_pairs !== undefined) a.lonePairs = Math.max(0, Math.min(4, p.lone_pairs))
      if (p.radical !== undefined) a.radical = !!p.radical
      if (p.x !== undefined) a.x = p.x
      if (p.y !== undefined) a.y = p.y
      return { ...a }
    })
  },

  set_bond(p) {
    return commit(d => {
      const b = need(d.bonds[p.id], `Bond ${p.id}`)
      if (p.order !== undefined) b.order = p.order
      if (p.stereo !== undefined) b.stereo = p.stereo
      if (p.flip) [b.a1, b.a2] = [b.a2, b.a1]
      straightenTriple(d, b.id)
      return { ...b }
    })
  },

  move(p) {
    return commit(d => {
      let ids: ID[] = p.ids ?? []
      if (p.whole_molecule) {
        const extra = new Set(ids)
        for (const id of ids) if (kindOf(id) === 'atom' && d.atoms[id]) componentOf(d, id).forEach(a => extra.add(a))
        ids = [...extra]
      }
      moveItems(d, ids, p.dx ?? 0, p.dy ?? 0)
      return { moved: ids.length }
    })
  },

  delete(p) {
    return commit(d => { removeItems(d, p.ids ?? []); return { deleted: (p.ids ?? []).length } })
  },

  add_reaction_arrow(p) {
    return commit(d => {
      let { x1, y1, x2, y2 } = p
      if (x1 === undefined || y1 === undefined) {
        const b = contentBounds(d)
        x1 = b ? b.x2 + 30 : 0
        y1 = b ? (b.y1 + b.y2) / 2 : 0
      }
      if (x2 === undefined || y2 === undefined) { x2 = x1 + BOND * 2.5; y2 = y1 }
      const id = newId('r')
      d.arrows[id] = { id, kind: (p.kind ?? 'forward') as ArrowKind, x1, y1, x2, y2, above: p.above ?? '', below: p.below ?? '' }
      return { id, x1, y1, x2, y2 }
    })
  },

  set_reaction_arrow(p) {
    return commit(d => {
      const r = need(d.arrows[p.id], `Arrow ${p.id}`)
      for (const k of ['kind', 'above', 'below', 'x1', 'y1', 'x2', 'y2'] as const) if (p[k] !== undefined) (r as any)[k] = p[k]
      return { ...r }
    })
  },

  add_curly_arrow(p) {
    return commit(d => {
      for (const id of [p.from, p.to]) {
        const k = kindOf(id)
        if (k === 'atom') need(d.atoms[id], `Atom ${id}`)
        else if (k === 'bond') need(d.bonds[id], `Bond ${id}`)
        else throw new Error(`Curly arrows connect atoms (a…) or bonds (b…), got ${id}`)
      }
      if (p.from === p.to) throw new Error('from and to must differ')
      const id = newId('c')
      d.curlies[id] = { id, from: p.from, to: p.to, half: !!p.half, bend: p.bend ?? 1 }
      return { id }
    })
  },

  add_text(p) {
    return commit(d => {
      const id = newId('t')
      const b = contentBounds(d)
      d.texts[id] = { id, text: String(p.text ?? ''), x: p.x ?? (b ? b.x1 : 0), y: p.y ?? (b ? b.y2 + 40 : 0) }
      return { id }
    })
  },

  async clean(p) { return { cleaned: await cleanStructures(p.atom_ids) } },
  undo: () => ({ undone: undo() }),
  redo: () => ({ redone: redo() }),
  clear: () => { replaceDoc(emptyDoc()); return { cleared: true } },

  async screenshot() {
    const url = await exportPngDataUrl(getDoc(), 2)
    return { png: url.split(',')[1] }
  },

  async export(p) {
    const doc = getDoc()
    switch (p.format) {
      case 'svg': return { data: exportSvg(doc) }
      case 'mol': return { data: writeMolfile(doc) }
      case 'json': return { data: JSON.stringify(doc, null, 2) }
      case 'png': return { png: (await exportPngDataUrl(doc, 3)).split(',')[1] }
      case 'smiles': {
        const mols = await moleculeSummaries(doc)
        return { data: mols.map(m => m.smiles).filter(Boolean).join('.') }
      }
      default: throw new Error('format must be svg, png, mol, smiles or json')
    }
  },

  set_document(p) {
    const doc = typeof p.doc === 'string' ? JSON.parse(p.doc) : p.doc
    replaceDoc({ ...emptyDoc(), ...doc })
    return { ok: true }
  },
}

let started = false
let socket: WebSocket | null = null
let stopped = false

// During development, hot reload replaces this module; drop the old connection so new code handles calls.
if (import.meta.hot) {
  import.meta.hot.dispose(() => { stopped = true; socket?.close() })
  import.meta.hot.accept(() => location.reload())
}

export function startBridge() {
  if (started) return
  started = true
  const connect = () => {
    if (stopped) return
    let ws: WebSocket
    try { ws = new WebSocket(BRIDGE_URL) } catch { setTimeout(connect, 3000); return }
    socket = ws
    ws.onopen = () => { set({ connected: true }); ws.send(JSON.stringify({ hello: 'chemsketch-app' })) }
    ws.onclose = () => { set({ connected: false }); setTimeout(connect, 3000) }
    ws.onmessage = async ev => {
      let msg: { id: number; method: string; params?: Params }
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (typeof msg.id !== 'number') return
      const h = handlers[msg.method]
      try {
        if (!h) throw new Error(`Unknown method ${msg.method}`)
        const result = await h(msg.params ?? {})
        ws.send(JSON.stringify({ id: msg.id, result }))
        set({ log: [{ time: Date.now(), method: msg.method, ok: true }, ...state.log].slice(0, 50) })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        ws.send(JSON.stringify({ id: msg.id, error: message }))
        set({ log: [{ time: Date.now(), method: msg.method, ok: false, detail: message }, ...state.log].slice(0, 50) })
      }
    }
  }
  connect()
}
