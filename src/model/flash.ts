/* Items to glow briefly on the canvas: what Claude just added or changed. */
import { useSyncExternalStore } from 'react'
import type { ID } from './types'

let state = { ids: new Set<ID>(), key: 0 }
const listeners = new Set<() => void>()
let clearTimer: number | undefined

export function flashItems(ids: ID[]) {
  if (!ids.length) return
  // Edits that arrive close together (one Claude turn) glow together.
  const merged = state.key && Date.now() - lastAt < 1500 ? new Set([...state.ids, ...ids]) : new Set(ids)
  lastAt = Date.now()
  state = { ids: merged, key: state.key + 1 }
  listeners.forEach(l => l())
  clearTimeout(clearTimer)
  clearTimer = window.setTimeout(() => { state = { ids: new Set(), key: state.key }; listeners.forEach(l => l()) }, 2200)
}
let lastAt = 0

export const useFlash = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)
