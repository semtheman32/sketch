/*
 * Connects the app to the Claude bridge (bridge/server.mjs) over a local WebSocket.
 * The bridge forwards MCP tool calls from Claude; each call runs here as one undoable edit.
 */
import { useSyncExternalStore } from 'react'
import type { ArrowKind, BondOrder, BondStereo, Doc, ID, TextStyle } from '../model/types'
import { emptyDoc, kindOf } from '../model/types'
import { BOND } from '../model/geometry'
import { commit, getDoc, newId, redo, replaceDoc, undo } from '../model/store'
import { addAtom, addBond, bracketAround, changedIds, contentBounds, growBond, moveItems, removeItems, straightenTriple } from '../model/ops'
import { flashItems } from '../model/flash'
import { adjacency, componentOf, hCount } from '../chem/chem'
import { addMolecule, cleanStructures, exportMolfile, exportPngDataUrl, exportSvg, moleculeSummaries, smilesOf } from '../actions'
import { getDrawStyle } from '../render/styles'

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
    brackets: Object.values(doc.brackets ?? {}),
    molecules: await moleculeSummaries(doc),
    bounds: contentBounds(doc),
  }
}

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined || v === null) throw new Error(`${what} not found`)
  return v
}

type Params = Record<string, any>

function pickStyle(p: Params): TextStyle {
  const s: TextStyle = {}
  if (p.color !== undefined) s.color = String(p.color)
  if (p.bold !== undefined) s.bold = !!p.bold
  if (p.italic !== undefined) s.italic = !!p.italic
  if (p.size !== undefined) s.size = Math.max(6, Math.min(72, Number(p.size)))
  return s
}

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
      d.texts[id] = { id, text: String(p.text ?? ''), x: p.x ?? (b ? b.x1 : 0), y: p.y ?? (b ? b.y2 + 40 : 0), ...pickStyle(p) }
      return { id }
    })
  },

  set_text(p) {
    return commit(d => {
      const t = need(d.texts[p.id], `Text ${p.id}`)
      if (p.text !== undefined) t.text = String(p.text)
      if (p.x !== undefined) t.x = p.x
      if (p.y !== undefined) t.y = p.y
      Object.assign(t, pickStyle(p))
      return { ...t }
    })
  },

  add_bracket(p) {
    return commit(d => {
      let id: ID | null
      if (p.ids?.length) id = bracketAround(d, p.ids, p.label ?? '', p.padding ?? 14)
      else {
        if ([p.x1, p.y1, p.x2, p.y2].some(v => typeof v !== 'number')) throw new Error('Give ids to wrap, or x1, y1, x2, y2')
        id = newId('k')
        d.brackets[id] = { id, x1: Math.min(p.x1, p.x2), y1: Math.min(p.y1, p.y2), x2: Math.max(p.x1, p.x2), y2: Math.max(p.y1, p.y2), shape: 'square', label: '' }
      }
      if (!id) throw new Error('Nothing to wrap')
      if (p.shape) d.brackets[id].shape = p.shape
      if (p.label !== undefined) d.brackets[id].label = String(p.label)
      return { ...d.brackets[id] }
    })
  },

  async clean(p) { return { cleaned: await cleanStructures(p.atom_ids) } },
  undo: () => ({ undone: undo() }),
  redo: () => ({ redone: redo() }),
  clear: () => { replaceDoc(emptyDoc()); return { cleared: true } },

  async screenshot() {
    const url = await exportPngDataUrl(getDoc(), 2, { style: getDrawStyle() })
    return { png: url.split(',')[1] }
  },

  async export(p) {
    const doc = getDoc()
    switch (p.format) {
      case 'svg': return { data: exportSvg(doc, { style: getDrawStyle() }) }
      case 'mol': return { data: await exportMolfile(doc) }
      case 'json': return { data: JSON.stringify(doc, null, 2) }
      case 'png': return { png: (await exportPngDataUrl(doc, 3, { style: getDrawStyle() })).split(',')[1] }
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
      const reply = await runMethod(msg.method, msg.params ?? {})
      ws.send(JSON.stringify({ id: msg.id, ...reply }))
    }
  }
  connect()
}

/**
 * Run one of Claude's tool methods on the canvas and add it to the activity log.
 * Used by both the Claude Code bridge (above) and the in-app chat (src/chat/chat.ts).
 */
export async function runMethod(method: string, params: Params): Promise<{ result: unknown } | { error: string }> {
  const h = handlers[method]
  const before = getDoc()
  try {
    if (!h) throw new Error(`Unknown method ${method}`)
    const result = await h(params)
    // Make Claude's edits visible: whatever it added or changed glows briefly.
    if (getDoc() !== before && method !== 'undo' && method !== 'redo' && method !== 'clear' && method !== 'set_document') {
      flashItems(changedIds(before, getDoc()))
    }
    set({ log: [{ time: Date.now(), method, ok: true }, ...state.log].slice(0, 50) })
    return { result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    set({ log: [{ time: Date.now(), method, ok: false, detail: message }, ...state.log].slice(0, 50) })
    return { error: message }
  }
}
