import type { Atom, Bond, Doc, ID } from '../model/types'
import { ELEMENTS, implicitHydrogens } from './elements'
import { abbrevOf } from './abbrev'

export interface Neighbor { bond: Bond; other: ID }
export type Adjacency = Map<ID, Neighbor[]>

export function adjacency(doc: Doc): Adjacency {
  const adj: Adjacency = new Map()
  for (const id in doc.atoms) adj.set(id, [])
  for (const b of Object.values(doc.bonds)) {
    adj.get(b.a1)?.push({ bond: b, other: b.a2 })
    adj.get(b.a2)?.push({ bond: b, other: b.a1 })
  }
  return adj
}

export function bondOrderSum(atomId: ID, adj: Adjacency): number {
  let s = 0
  for (const n of adj.get(atomId) ?? []) s += n.bond.order
  return s
}

export function hCount(atom: Atom, adj: Adjacency): number {
  return implicitHydrogens(atom.element, bondOrderSum(atom.id, adj), atom.charge, atom.radical)
}

/** Connected components (molecules) as arrays of atom ids. */
export function components(doc: Doc, adj: Adjacency = adjacency(doc)): ID[][] {
  const seen = new Set<ID>()
  const out: ID[][] = []
  for (const id in doc.atoms) {
    if (seen.has(id)) continue
    const comp: ID[] = []
    const stack = [id]
    seen.add(id)
    while (stack.length) {
      const cur = stack.pop()!
      comp.push(cur)
      for (const n of adj.get(cur) ?? []) {
        if (!seen.has(n.other)) { seen.add(n.other); stack.push(n.other) }
      }
    }
    out.push(comp)
  }
  return out
}

export function componentOf(doc: Doc, atomId: ID, adj: Adjacency = adjacency(doc)): ID[] {
  return components(doc, adj).find(c => c.includes(atomId)) ?? []
}

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const subscript = (n: number) => String(n).split('').map(d => SUB[+d]).join('')

export interface FormulaInfo { formula: string; plain: string; mass: number; charge: number }

/** Hill-order molecular formula and average mass for a set of atoms. */
export function formulaOf(doc: Doc, atomIds: ID[], adj: Adjacency = adjacency(doc)): FormulaInfo {
  const counts: Record<string, number> = {}
  let charge = 0
  for (const id of atomIds) {
    const a = doc.atoms[id]
    if (!a) continue
    const ab = abbrevOf(a.element)
    if (ab) for (const [el, n] of Object.entries(ab.formula)) counts[el] = (counts[el] ?? 0) + n
    else counts[a.element] = (counts[a.element] ?? 0) + 1
    const h = hCount(a, adj)
    if (h) counts.H = (counts.H ?? 0) + h
    charge += a.charge
  }
  const keys = Object.keys(counts)
  const order = counts.C
    ? ['C', ...(counts.H ? ['H'] : []), ...keys.filter(k => k !== 'C' && k !== 'H').sort()]
    : keys.sort()
  let formula = '', plain = '', mass = 0
  for (const k of order) {
    const n = counts[k]
    formula += k + (n > 1 ? subscript(n) : '')
    plain += k + (n > 1 ? n : '')
    mass += (ELEMENTS[k]?.mass ?? 0) * n
  }
  if (charge) {
    const mag = Math.abs(charge) > 1 ? String(Math.abs(charge)) : ''
    const sign = charge > 0 ? '+' : '−'
    formula += superscript(mag + sign)
    plain += mag + (charge > 0 ? '+' : '-')
  }
  return { formula, plain, mass, charge }
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '−': '⁻' }
const superscript = (s: string) => s.split('').map(c => SUP[c] ?? c).join('')

export function chargeLabel(charge: number): string {
  if (!charge) return ''
  const mag = Math.abs(charge) > 1 ? String(Math.abs(charge)) : ''
  return mag + (charge > 0 ? '+' : '−')
}
