import { useSyncExternalStore } from 'react'
import { emptyDoc, type Doc } from './types'
import { autoCharge, checkValence } from '../chem/valence'

const STORAGE_KEY = 'chemsketch-clone:doc'
const TABS_KEY = 'chemsketch-clone:tabs'
const LIMIT = 200

/**
 * Tabs: several drawings open at once, like browser tabs. The active tab's drawing and history live in
 * `doc`/`past`/`future` below (so every edit works as before); the other tabs keep theirs in `tabs`.
 */
export interface Tab { id: string; name: string; doc: Doc; past: Doc[]; future: Doc[] }
export interface TabInfo { id: string; name: string; active: boolean; empty: boolean }

const listeners = new Set<() => void>()
const counters: Record<string, number> = {}
let tabs: Tab[] = []
let activeId = ''
let tabSeq = 0
let doc: Doc = emptyDoc()
let past: Doc[] = []
let future: Doc[] = []
loadTabs()
syncCounters(doc)

function fill(d: Partial<Doc>): Doc { return { ...emptyDoc(), ...d } } // older saves have no brackets: emptyDoc fills them in

function loadTabs() {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { active: string; tabs: { id: string; name: string; doc: Doc }[] }
      if (saved.tabs?.length) {
        tabs = saved.tabs.map(t => ({ id: t.id, name: t.name, doc: fill(t.doc), past: [], future: [] }))
        const a = tabs.find(t => t.id === saved.active) ?? tabs[0]
        activeId = a.id
        doc = a.doc
        tabSeq = Math.max(0, ...tabs.map(t => parseInt(t.id.slice(3)) || 0))
        return
      }
    }
  } catch { /* storage unavailable or broken: start fresh */ }
  // First run with tabs: the drawing saved by older versions becomes the first tab.
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) doc = fill(JSON.parse(raw))
  } catch { /* ignore */ }
  const t: Tab = { id: 'tab' + ++tabSeq, name: 'Drawing 1', doc, past: [], future: [] }
  tabs = [t]
  activeId = t.id
}

/** Write the active tab's state back into its slot in `tabs`. */
function stash() {
  const t = tabs.find(x => x.id === activeId)
  if (t) { t.doc = doc; t.past = past; t.future = future }
}

let saveTimer: number | undefined
function emit() {
  listeners.forEach(l => l())
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    stash()
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ active: activeId, tabs: tabs.map(t => ({ id: t.id, name: t.name, doc: t.doc })) }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)) // kept for older versions of the app
    } catch { /* ignore */ }
  }, 300)
}

function syncCounters(d: Doc) {
  for (const group of [d.atoms, d.bonds, d.arrows, d.curlies, d.texts, d.brackets ?? {}]) {
    for (const id of Object.keys(group)) {
      const prefix = id[0], n = parseInt(id.slice(1))
      if (Number.isFinite(n)) counters[prefix] = Math.max(counters[prefix] ?? 0, n)
    }
  }
}

export function newId(prefix: 'a' | 'b' | 'r' | 'c' | 't' | 'k'): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1
  return prefix + counters[prefix]
}

/** Run `fn` on a scratch copy (previews) without using up ids: counters are restored afterwards. */
export function scratch<T>(fn: () => T): T {
  const saved = { ...counters }
  try { return fn() } finally { for (const k of Object.keys(counters)) delete counters[k]; Object.assign(counters, saved) }
}

export const getDoc = () => doc
export const canUndo = () => past.length > 0
export const canRedo = () => future.length > 0

function pushPast(d: Doc) {
  past.push(d)
  if (past.length > LIMIT) past.shift()
  future = []
}

type Items = Record<string, Record<string, unknown>>
const GROUPS = ['atoms', 'bonds', 'arrows', 'curlies', 'texts', 'brackets'] as const

/**
 * Keep every item that didn't change as the very same object as in `prev`. The canvas redraws a molecule
 * only when one of its atom or bond objects is new, so an edit (or undo) redraws just what it touched.
 */
function reshare(prev: Doc, next: Doc): Doc {
  for (const g of GROUPS) {
    const a = (prev[g] ?? {}) as unknown as Items, b = next[g] as unknown as Items | undefined
    if (!b || a === b) continue
    for (const id in b) {
      const o = a[id], n = b[id]
      if (o && o !== n && sameFields(o, n)) b[id] = o
    }
  }
  return next
}

function sameFields(a: Record<string, unknown>, b: Record<string, unknown>) {
  let n = 0
  for (const k in a) { if (a[k] !== b[k]) return false; n++ }
  for (const _ in b) n--
  return n === 0
}

/** Apply an edit as one undoable step. The callback mutates a fresh copy. */
export function commit<T>(fn: (d: Doc) => T): T {
  const draft = structuredClone(doc)
  const result = fn(draft)
  autoCharge(doc, draft)
  checkValence(doc, draft)
  pushPast(doc)
  doc = reshare(doc, draft)
  emit()
  return result
}

/**
 * Run several edits (which may be async, like inserting molecules) as ONE undo step.
 * Whatever `fn` commits is collapsed into a single history entry when it finishes.
 */
export async function batch<T>(fn: () => Promise<T>): Promise<T> {
  const base = doc
  const before = past.length
  try {
    return await fn()
  } finally {
    if (doc !== base && past.length >= before) {
      past.length = before
      pushPast(base)
      emit()
    }
  }
}

/** Show a document without recording history (used while dragging). */
export function setLive(d: Doc) { doc = reshare(doc, d); emit() }

/** Finish a live edit: record `base` as the undo point for the current document. */
export function finishLive(base: Doc) {
  if (base !== doc) { pushPast(base); emit() }
}

export function replaceDoc(d: Doc) {
  pushPast(doc)
  doc = reshare(doc, { ...emptyDoc(), ...d })
  syncCounters(doc)
  emit()
}

export function undo() {
  const prev = past.pop()
  if (!prev) return false
  future.push(doc)
  doc = prev
  emit()
  return true
}

export function redo() {
  const next = future.pop()
  if (!next) return false
  past.push(doc)
  doc = next
  emit()
  return true
}

// ------------------------------------------------------------ tabs

let tabInfo: TabInfo[] = []
function refreshTabInfo() {
  tabInfo = tabs.map(t => {
    const d = t.id === activeId ? doc : t.doc
    return { id: t.id, name: t.name, active: t.id === activeId, empty: isEmptyDoc(d) }
  })
}
refreshTabInfo()

export function isEmptyDoc(d: Doc) {
  return !Object.keys(d.atoms).length && !Object.keys(d.arrows).length && !Object.keys(d.texts).length
    && !Object.keys(d.curlies).length && !Object.keys(d.brackets ?? {}).length
}

export const getActiveTabId = () => activeId

function activate(id: string) {
  stash()
  const t = tabs.find(x => x.id === id)
  if (!t) return
  activeId = id
  doc = t.doc; past = t.past; future = t.future
  // Ids only need to be unique within one drawing: restart the counters from this tab's drawing.
  for (const k of Object.keys(counters)) delete counters[k]
  syncCounters(doc)
}

function nextName() {
  const used = new Set(tabs.map(t => t.name))
  let n = tabs.length + 1
  while (used.has(`Drawing ${n}`)) n++
  return `Drawing ${n}`
}

/** Open a new tab (empty, or with `d`) and switch to it. Returns its id. */
export function newTab(d?: Doc, name?: string): string {
  stash()
  const t: Tab = { id: 'tab' + ++tabSeq, name: name?.trim() || nextName(), doc: d ? fill(d) : emptyDoc(), past: [], future: [] }
  const i = tabs.findIndex(x => x.id === activeId)
  tabs.splice(i + 1, 0, t)
  activate(t.id)
  emit()
  return t.id
}

export function switchTab(id: string) {
  if (id === activeId || !tabs.some(t => t.id === id)) return
  activate(id)
  emit()
}

/** Switch to the tab `delta` places to the left/right of the active one (wrapping around). */
export function cycleTab(delta: number) {
  const i = tabs.findIndex(t => t.id === activeId)
  switchTab(tabs[(i + delta + tabs.length) % tabs.length].id)
}

export function closeTab(id: string) {
  const i = tabs.findIndex(t => t.id === id)
  if (i < 0) return
  if (tabs.length === 1) {
    // Closing the last tab leaves one empty tab, like a fresh start.
    tabs[0] = { id: 'tab' + ++tabSeq, name: 'Drawing 1', doc: emptyDoc(), past: [], future: [] }
    activeId = ''
    activate(tabs[0].id)
  } else if (id === activeId) {
    const next = tabs[i + 1] ?? tabs[i - 1]
    activate(next.id)
    tabs.splice(i, 1)
  } else {
    tabs.splice(i, 1)
  }
  emit()
}

export function renameTab(id: string, name: string) {
  const t = tabs.find(x => x.id === id)
  if (!t || !name.trim()) return
  t.name = name.trim()
  emit()
}

/** Move tab `id` to position `to` (drag to reorder). */
export function moveTab(id: string, to: number) {
  const i = tabs.findIndex(t => t.id === id)
  if (i < 0) return
  const [t] = tabs.splice(i, 1)
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, t)
  emit()
}

listeners.add(refreshTabInfo)
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useDoc = () => useSyncExternalStore(subscribe, getDoc)
export const useTabs = () => useSyncExternalStore(subscribe, () => tabInfo)
