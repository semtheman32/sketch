import type { Doc, ID } from '../model/types'
import { ELEMENTS } from './elements'
import { isAbbrev } from './abbrev'

/** Thrown when an edit would give an atom more bonds than it can have. The UI shows the message. */
export class ValenceError extends Error {}

const ELECTRON_RICH = new Set(['N', 'P', 'O', 'S', 'Se', 'F', 'Cl', 'Br', 'I'])

/** Most bonds (sum of bond orders) an atom may have. Metals and unknown elements are not limited. */
export function maxBonds(element: string, charge: number, radical: boolean): number {
  if (isAbbrev(element)) return 1 // a group like Ph or Boc has one attachment point
  const info = ELEMENTS[element]
  if (!info || info.valence.length === 0) return Infinity
  const shift = ELECTRON_RICH.has(element) ? charge : -Math.abs(charge)
  return Math.max(...info.valence) + shift - (radical ? 1 : 0)
}

function bondSums(d: Doc): Map<ID, number> {
  const sums = new Map<ID, number>()
  for (const b of Object.values(d.bonds)) {
    sums.set(b.a1, (sums.get(b.a1) ?? 0) + b.order)
    sums.set(b.a2, (sums.get(b.a2) ?? 0) + b.order)
  }
  return sums
}

export function bondSum(d: Doc, atomId: ID): number {
  let s = 0
  for (const b of Object.values(d.bonds)) if (b.a1 === atomId || b.a2 === atomId) s += b.order
  return s
}

/** Room left on an atom for more bond order. */
export function freeValence(d: Doc, atomId: ID): number {
  const a = d.atoms[atomId]
  return a ? maxBonds(a.element, a.charge, a.radical) - bondSum(d, atomId) : 0
}

/**
 * Reject an edit that over-bonds an atom. Only atoms that got worse are checked,
 * so an already-odd drawing (e.g. an old file) can still be edited and fixed.
 */
export function checkValence(before: Doc, after: Doc) {
  const sb = bondSums(before), sa = bondSums(after)
  for (const a of Object.values(after.atoms)) {
    const excess = (sa.get(a.id) ?? 0) - maxBonds(a.element, a.charge, a.radical)
    if (excess <= 0) continue
    const old = before.atoms[a.id]
    const oldExcess = old ? (sb.get(a.id) ?? 0) - maxBonds(old.element, old.charge, old.radical) : -Infinity
    if (excess > oldExcess) {
      const max = maxBonds(a.element, a.charge, a.radical)
      const what = a.charge ? `${a.element}${a.charge > 0 ? '+' : '−'}` : a.element
      throw new ValenceError(`${what} can only have ${max} bond${max === 1 ? '' : 's'}. That would make ${sa.get(a.id)}.`)
    }
  }
}
