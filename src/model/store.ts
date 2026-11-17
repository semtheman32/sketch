import { useSyncExternalStore } from 'react'
import { emptyDoc, type Doc } from './types'
import { checkValence } from '../chem/valence'

const STORAGE_KEY = 'chemsketch-clone:doc'
const LIMIT = 200

let doc: Doc = load()
let past: Doc[] = []
let future: Doc[] = []
const listeners = new Set<() => void>()
const counters: Record<string, number> = {}
syncCounters(doc)

function load(): Doc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...emptyDoc(), ...JSON.parse(raw) } // older saves have no brackets: emptyDoc fills them in
  } catch { /* storage unavailable */ }
  return emptyDoc()
}

let saveTimer: number | undefined
function emit() {
  listeners.forEach(l => l())
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)) } catch { /* ignore */ }
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

/** Apply an edit as one undoable step. The callback mutates a fresh copy. */
export function commit<T>(fn: (d: Doc) => T): T {
  const draft = structuredClone(doc)
  const result = fn(draft)
  checkValence(doc, draft)
  pushPast(doc)
  doc = draft
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
export function setLive(d: Doc) { doc = d; emit() }

/** Finish a live edit: record `base` as the undo point for the current document. */
export function finishLive(base: Doc) {
  if (base !== doc) { pushPast(base); emit() }
}

export function replaceDoc(d: Doc) {
  pushPast(doc)
  doc = { ...emptyDoc(), ...d }
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

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useDoc = () => useSyncExternalStore(subscribe, getDoc)
