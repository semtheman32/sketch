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
  if (element === 'B' && charge === -1) return 4 - (radical ? 1 : 0) // borate, BF4-
  const shift = ELECTRON_RICH.has(element) ? charge : -Math.abs(charge)
  return Math.max(...info.valence) + shift - (radical ? 1 : 0)
}

/** Most bond order an atom could reach if its charge were adjusted automatically (see autoCharge). */
export function reachableBonds(element: string, charge: number, radical: boolean): number {
  const r = radical ? 1 : 0
  let best = Math.max(maxBonds(element, charge, radical), maxBonds(element, 0, radical))
  const low = lowestValence(element)
  if (low !== null && ELECTRON_RICH.has(element)) best = Math.max(best, low + 1 - r)
  if (element === 'B') best = Math.max(best, 4 - r)
  return best
}

function lowestValence(element: string): number | null {
  const info = ELEMENTS[element]
  return info && info.valence.length ? Math.min(...info.valence) : null
}

/**
 * Give atoms the formal charge their new bonds imply, so intermediates can be drawn directly:
 * a third bond on O makes O+ (oxonium), a fourth on N makes N+, a second on Br makes Br+ (bromonium),
 * a fourth on B makes B−; an anion or carbocation that forms a bond becomes neutral.
 * Taking the extra bond away again removes the charge. Only atoms whose bonds or element changed in this
 * edit (and whose charge wasn't set in the same edit) are touched. Mutates `after`.
 */
export function autoCharge(before: Doc, after: Doc) {
  const sb = bondSums(before), sa = bondSums(after)
  for (const a of Object.values(after.atoms)) {
    const old = before.atoms[a.id]
    if (!old || old.charge !== a.charge || isAbbrev(a.element)) continue
    const s1 = sa.get(a.id) ?? 0
    // a new element counts as gaining all its bonds (typing O over a carbon with three bonds gives O+)
    const s0 = old.element === a.element ? sb.get(a.id) ?? 0 : 0
    if (s0 === s1) continue
    const low = lowestValence(a.element)
    if (low === null) continue
    const r = a.radical ? 1 : 0
    if (ELECTRON_RICH.has(a.element)) {
      const needed = s1 - (low - r) // the charge that makes this bond count normal
      if (s1 > s0 && needed <= 1 && needed > a.charge) a.charge = needed
      else if (s1 < s0 && a.charge === 1 && s0 - (low - r) === 1 && needed <= 0) a.charge = 0
    } else if (a.element === 'B') {
      if (s1 > s0 && s1 === 4 - r && a.charge === 0) a.charge = -1
      else if (s1 < s0 && a.charge === -1 && s0 === 4 - r) a.charge = 0
    } else if (s1 > s0 && a.charge !== 0 && s1 > maxBonds(a.element, a.charge, a.radical) && s1 <= maxBonds(a.element, 0, a.radical)) {
      a.charge = 0 // carbanion or carbocation forming its fourth bond
    }
  }
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
