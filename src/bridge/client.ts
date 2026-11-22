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
import { autoBend, clearTextSpot } from '../render/layout'
import { drawMechanism, type MechSpec } from './mechanism'

export const BRIDGE_URL = 'ws://127.0.0.1:3917'

/** The app registers how to show the Practice tab, so bridge calls can bring it into view. */
let openPractice = () => {}
export function onOpenPractice(fn: () => void) { openPractice = fn }

export interface LogEntry { time: number; method: string; ok: boolean; detail?: string }

let state = { connected: false, log: [] as LogEntry[] }
const listeners = new Set<() => void>()
const set = (s: Partial<typeof state>) => { state = { ...state, ...s }; listeners.forEach(l => l()) }
export const useBridge = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)

const r1 = (n: number) => Math.round(n * 10) / 10

const r0 = (n: number) => Math.round(n)
const q = (s: string) => JSON.stringify(s)

/**
 * The canvas as compact text for Claude (a fraction of the tokens JSON would take). Atoms are grouped
 * per molecule; default values (no charge, no lone pairs, no H) are left out. See DOC_FORMAT.
 */
async function describe(doc: Doc = getDoc()): Promise<string> {
  const adj = adjacency(doc)
  const out: string[] = []
  const mols = await moleculeSummaries(doc)
  const bondsOf = new Map<ID, string[]>()
  for (const b of Object.values(doc.bonds)) {
    const sym = b.order === 2 ? '=' : b.order === 3 ? '#' : '-'
    const st = b.stereo && b.stereo !== 'none' ? ' ' + b.stereo : ''
    const list = bondsOf.get(b.a1) ?? []
    list.push(`${b.id} ${b.a1}${sym}${b.a2}${st}`)
    bondsOf.set(b.a1, list)
  }
  mols.forEach((m, i) => {
    out.push(`M${i + 1} ${m.formula} ${m.smiles ?? '?'}`)
    out.push('  ' + m.atomIds.map(id => {
      const a = doc.atoms[id]
      const h = hCount(a, adj)
      let s = `${a.id} ${a.element}${h ? 'H' + (h > 1 ? h : '') : ''} ${r0(a.x)},${r0(a.y)}`
      if (a.charge) s += ` ${a.charge > 0 ? '+' : ''}${a.charge}`
      if (a.lonePairs) s += ` lp${a.lonePairs}`
      if (a.radical) s += ' rad'
      return s
    }).join('; '))
    const bonds = m.atomIds.flatMap(id => bondsOf.get(id) ?? [])
    if (bonds.length) out.push('  ' + bonds.join('; '))
  })
  const curlies = Object.values(doc.curlies)
  if (curlies.length) out.push('Curly: ' + curlies.map(c => `${c.id} ${c.from}>${c.to}${c.half ? ' half' : ''}`).join('; '))
  for (const r of Object.values(doc.arrows)) {
    out.push(`Arrow ${r.id} ${r.kind} ${r0(r.x1)},${r0(r.y1)}>${r0(r.x2)},${r0(r.y2)}${r.above ? ' above ' + q(r.above) : ''}${r.below ? ' below ' + q(r.below) : ''}`)
  }
  const texts = Object.values(doc.texts)
  if (texts.length) out.push('Text: ' + texts.map(t => `${t.id} ${q(t.text)} ${r0(t.x)},${r0(t.y)}`).join('; '))
  for (const k of Object.values(doc.brackets ?? {})) {
    out.push(`Bracket ${k.id} ${k.shape} ${r0(k.x1)},${r0(k.y1)}>${r0(k.x2)},${r0(k.y2)}${k.label ? ' ' + q(k.label) : ''}${k.color ? ' ' + k.color : ''}`)
  }
  const b = contentBounds(doc)
  out.push(b ? `Bounds ${r0(b.x1)},${r0(b.y1)}>${r0(b.x2)},${r0(b.y2)}` : 'The canvas is empty.')
  return out.join('\n')
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
    const atoms = res.atomIds.map((id, index) => {
      const a = doc.atoms[id]
      const h = hCount(a, adj)
      return `${index}:${id} ${a.element}${h ? 'H' + (h > 1 ? h : '') : ''} ${r0(a.x)},${r0(a.y)}${a.charge ? ` ${a.charge > 0 ? '+' : ''}${a.charge}` : ''}`
    })
    const bonds = res.bondIds.map(id => {
      const b = doc.bonds[id]
      return `${id} ${b.a1}${b.order === 2 ? '=' : b.order === 3 ? '#' : '-'}${b.a2}`
    })
    return `Added ${await smilesOf(doc, res.atomIds)}
Atoms (index:id${kind === 'smiles' ? ', index = heavy-atom order in your SMILES' : ''}): ${atoms.join('; ')}${bonds.length ? `
Bonds: ${bonds.join('; ')}` : ''}`
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
      d.curlies[id] = { id, from: p.from, to: p.to, half: !!p.half, bend: p.bend ?? autoBend(d, p.from, p.to, adjacency(d)) }
      return { id }
    })
  },

  add_text(p) {
    return commit(d => {
      const id = newId('t')
      const b = contentBounds(d)
      d.texts[id] = { id, text: String(p.text ?? ''), x: p.x ?? (b ? b.x1 : 0), y: p.y ?? (b ? b.y2 + 40 : 0), ...pickStyle(p) }
      Object.assign(d.texts[id], clearTextSpot(d, d.texts[id], adjacency(d))) // never on top of a structure
      return { id, x: d.texts[id].x, y: d.texts[id].y }
    })
  },

  set_text(p) {
    return commit(d => {
      const t = need(d.texts[p.id], `Text ${p.id}`)
      if (p.text !== undefined) t.text = String(p.text)
      if (p.x !== undefined) t.x = p.x
      if (p.y !== undefined) t.y = p.y
      Object.assign(t, pickStyle(p))
      if (p.x !== undefined || p.y !== undefined) Object.assign(t, clearTextSpot(d, t, adjacency(d)))
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
      if (p.color !== undefined) d.brackets[id].color = String(p.color)
      return { ...d.brackets[id] }
    })
  },

  async clean(p) { const r = await cleanStructures(p.atom_ids); return { cleaned: r.structures, textsMoved: r.texts } },
  undo: () => ({ undone: undo() }),
  redo: () => ({ redone: redo() }),
  clear: () => { replaceDoc(emptyDoc()); return { cleared: true } },

  async draw_mechanism(p) {
    const spec: MechSpec = { steps: p.steps, title: p.title, x: p.x, y: p.y, width: p.width, lonePairs: p.lone_pairs }
    const r = await drawMechanism(spec)
    const b = contentBounds(getDoc())
    return [
      'Drawn. Atom ids per species, in SMILES heavy-atom order:',
      ...r.species.map(s => `${s.step}.${s.index} ${s.smiles}: ${s.atoms.join(' ')}`),
      r.curlies.length ? `Curly arrows: ${r.curlies.join(' ')}` : '',
      r.arrows.length ? `Reaction arrows: ${r.arrows.join(' ')}` : '',
      b ? `Canvas bounds now ${r0(b.x1)},${r0(b.y1)}>${r0(b.x2)},${r0(b.y2)}` : '',
    ].filter(Boolean).join('\n')
  },

  async screenshot() {
    // Big enough to read, small enough not to waste tokens: about 1000 px on the long side.
    const b = contentBounds(getDoc())
    const long = b ? Math.max(b.x2 - b.x1, b.y2 - b.y1) + 80 : 500
    const url = await exportPngDataUrl(getDoc(), Math.max(0.6, Math.min(2, 1000 / long)), { style: getDrawStyle() })
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

  async practice_add(p) {
    const { addExercises, setLang, toExercise } = await import('../chat/practice')
    if (!Array.isArray(p.exercises) || !p.exercises.length) throw new Error('Give at least one exercise')
    const list = p.exercises.map((e: unknown) => toExercise(e))
    if (p.language === 'en' || p.language === 'nl') setLang(p.language)
    openPractice()
    const ids = await addExercises(list, { replace: !!p.replace })
    return { added: ids, opened: ids[0], note: 'The first new exercise is open in the Practice tab with its setup drawn.' }
  },
  async practice_state() {
    const { practiceSummary } = await import('../chat/practice')
    return practiceSummary()
  },
  async practice_open(p) {
    const { getPractice, openExercise, practiceSummary } = await import('../chat/practice')
    if (!getPractice().exercises[p.index]) throw new Error(`There is no exercise ${p.index}`)
    openPractice()
    await openExercise(p.index)
    return practiceSummary().current
  },
  async practice_scope(p) {
    const { setInCourse } = await import('../chat/practice')
    if (!Array.isArray(p.ids) || !p.ids.length) throw new Error('Give at least one exercise id')
    const changed = setInCourse(p.ids.map(String), !!p.in_course)
    return { changed, missing: p.ids.filter((id: string) => !changed.includes(id)) }
  },
  async practice_feedback(p) {
    const { recordFeedback } = await import('../chat/practice')
    openPractice()
    return recordFeedback({ verdict: p.verdict, reactionType: p.reaction_type ? String(p.reaction_type) : undefined, summary: String(p.summary ?? ''), points: p.points })
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
