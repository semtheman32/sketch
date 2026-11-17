import type { BondOrder, BondStereo, Doc, ID } from '../model/types'
import { BOND } from '../model/geometry'
import { isAbbrev } from './abbrev'

/** Molfile coordinates use ~1.5 Å bond length; the canvas uses BOND units with y pointing down. */
const SCALE = BOND / 1.5

export interface ParsedMol {
  atoms: { element: string; x: number; y: number; charge: number }[]
  bonds: { i: number; j: number; order: BondOrder; stereo: BondStereo }[]
}

const pad = (s: string | number, n: number) => String(s).padStart(n)

export function writeMolfile(doc: Doc, atomIds: ID[] = Object.keys(doc.atoms), name = ''): string {
  const index = new Map<ID, number>()
  atomIds.forEach((id, i) => index.set(id, i + 1))
  const bonds = Object.values(doc.bonds).filter(b => index.has(b.a1) && index.has(b.a2))
  const lines = [name, '  ChemSketchClone', '']
  lines.push(`${pad(atomIds.length, 3)}${pad(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`)
  const charged: [number, number][] = []
  for (const id of atomIds) {
    const a = doc.atoms[id]
    const x = (a.x / SCALE).toFixed(4), y = (-a.y / SCALE).toFixed(4)
    // Group labels (Ph, Boc…) are written as C here, which is right for layout. Anything that needs the
    // real structure (SMILES, MOL export) expands them first: see expandAbbreviations in actions.tsx.
    const el = isAbbrev(a.element) ? 'C' : a.element
    lines.push(`${pad(x, 10)}${pad(y, 10)}${pad('0.0000', 10)} ${el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`)
    if (a.charge) charged.push([index.get(id)!, a.charge])
  }
  for (const b of bonds) {
    const st = b.stereo === 'wedge' ? 1 : b.stereo === 'dash' ? 6 : 0
    lines.push(`${pad(index.get(b.a1)!, 3)}${pad(index.get(b.a2)!, 3)}${pad(b.order, 3)}${pad(st, 3)}`)
  }
  for (let i = 0; i < charged.length; i += 8) {
    const chunk = charged.slice(i, i + 8)
    lines.push(`M  CHG${pad(chunk.length, 3)}` + chunk.map(([n, c]) => `${pad(n, 4)}${pad(c, 4)}`).join(''))
  }
  lines.push('M  END')
  return lines.join('\n')
}

const OLD_CHARGE: Record<number, number> = { 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 }

export function parseMolfile(text: string): ParsedMol {
  const lines = text.replace(/\r/g, '').split('\n')
  // find the counts line (contains V2000)
  let c = lines.findIndex(l => /V2000/.test(l))
  if (c < 0) c = 3
  const counts = lines[c]
  const nAtoms = parseInt(counts.slice(0, 3)), nBonds = parseInt(counts.slice(3, 6))
  if (!Number.isFinite(nAtoms)) throw new Error('Not a valid molfile')
  const atoms: ParsedMol['atoms'] = []
  for (let i = 0; i < nAtoms; i++) {
    const l = lines[c + 1 + i]
    const x = parseFloat(l.slice(0, 10)), y = parseFloat(l.slice(10, 20))
    const element = l.slice(31, 34).trim()
    const oldC = parseInt(l.slice(36, 39)) || 0
    atoms.push({ element, x: x * SCALE, y: -y * SCALE, charge: OLD_CHARGE[oldC] ?? 0 })
  }
  const bonds: ParsedMol['bonds'] = []
  for (let i = 0; i < nBonds; i++) {
    const l = lines[c + 1 + nAtoms + i]
    const a = parseInt(l.slice(0, 3)), b = parseInt(l.slice(3, 6))
    const t = parseInt(l.slice(6, 9)), st = parseInt(l.slice(9, 12)) || 0
    // aromatic (4) bonds are rare in molfiles we read; treat as single
    const order = (t === 2 || t === 3 ? t : 1) as BondOrder
    bonds.push({ i: a - 1, j: b - 1, order, stereo: st === 1 ? 'wedge' : st === 6 ? 'dash' : 'none' })
  }
  for (let k = c + 1 + nAtoms + nBonds; k < lines.length; k++) {
    const l = lines[k]
    if (l.startsWith('M  END')) break
    if (l.startsWith('M  CHG')) {
      const n = parseInt(l.slice(6, 9))
      for (let j = 0; j < n; j++) {
        const idx = parseInt(l.slice(9 + j * 8, 13 + j * 8)), ch = parseInt(l.slice(13 + j * 8, 17 + j * 8))
        if (atoms[idx - 1]) atoms[idx - 1].charge = ch
      }
    }
  }
  return separateFragments(normalizeBondLength(stripHydrogens({ atoms, bonds })))
}

/** Remove explicit hydrogens on a single heavy atom; the renderer shows implicit H instead. */
function stripHydrogens(m: ParsedMol): ParsedMol {
  const degree = new Array(m.atoms.length).fill(0)
  const heavyNeighbor = new Array(m.atoms.length).fill(false)
  for (const b of m.bonds) {
    degree[b.i]++; degree[b.j]++
    if (m.atoms[b.j].element !== 'H') heavyNeighbor[b.i] = true
    if (m.atoms[b.i].element !== 'H') heavyNeighbor[b.j] = true
  }
  const drop = m.atoms.map((a, i) => a.element === 'H' && a.charge === 0 && degree[i] === 1 && heavyNeighbor[i])
  if (!drop.some(Boolean)) return m
  const remap: number[] = []
  const atoms: ParsedMol['atoms'] = []
  m.atoms.forEach((a, i) => { if (!drop[i]) { remap[i] = atoms.length; atoms.push(a) } })
  const bonds = m.bonds
    .filter(b => !drop[b.i] && !drop[b.j])
    .map(b => ({ ...b, i: remap[b.i], j: remap[b.j] }))
  return { atoms, bonds }
}

/**
 * Rescale so the typical (median) bond is exactly BOND long. Molfiles disagree on units: RDKit and PubChem
 * use ~1.0 Å bonds, other programs ~1.5, so a fixed factor drew some molecules at two-thirds size.
 */
export function bondScale(pts: { x: number; y: number }[], bonds: { i: number; j: number }[]): number {
  const lens = bonds.map(b => Math.hypot(pts[b.i].x - pts[b.j].x, pts[b.i].y - pts[b.j].y)).filter(l => l > 1e-6).sort((a, b) => a - b)
  if (!lens.length) return 1
  return BOND / lens[Math.floor(lens.length / 2)]
}

function normalizeBondLength(m: ParsedMol): ParsedMol {
  const k = bondScale(m.atoms, m.bonds)
  for (const a of m.atoms) { a.x *= k; a.y *= k }
  return m
}

/**
 * Salts and mixtures (sodium dodecyl sulfate, hydrochlorides…) come in as several unbonded pieces. Layout
 * engines either drop a counter-ion on top of the main structure or leave it far away, so: keep the largest
 * piece where it is and line the others up to its right, one bond apart, centred on it.
 */
function separateFragments(m: ParsedMol): ParsedMol {
  arrangeFragments(m.atoms, m.bonds)
  return m
}

/**
 * Move the unbonded pieces of `pts` (mutated in place) next to the largest one. A charged piece goes beside
 * the oppositely charged atom of the main piece (Na+ next to the O-), on whichever side that atom is nearer;
 * the rest line up to the right. Returns the indices of the largest piece.
 */
export function arrangeFragments(pts: { x: number; y: number; charge?: number }[], bonds: { i: number; j: number }[]): number[] {
  const n = pts.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (const b of bonds) parent[find(b.i)] = find(b.j)
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(i) }
  const frags = [...groups.values()].sort((a, b) => b.length - a.length)
  if (frags.length < 2) return frags[0] ?? []

  const box = (ids: number[]) => {
    const xs = ids.map(i => pts[i].x), ys = ids.map(i => pts[i].y)
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
  }
  const main = box(frags[0])
  const charge = (ids: number[]) => ids.reduce((s, i) => s + (pts[i].charge ?? 0), 0)
  const partners = frags[0].filter(i => pts[i].charge)
  const used = new Set<number>()
  let right = main.x2, left = main.x1
  for (const f of frags.slice(1)) {
    const b = box(f), q = charge(f)
    const p = q ? partners.find(i => !used.has(i) && Math.sign(pts[i].charge!) === -Math.sign(q)) : undefined
    let dx: number, dy: number
    if (p !== undefined) {
      used.add(p)
      const toLeft = pts[p].x - main.x1 < main.x2 - pts[p].x
      dx = toLeft ? left - BOND - b.x2 : right + BOND - b.x1
      dy = pts[p].y - (b.y1 + b.y2) / 2
    } else {
      dx = right + BOND - b.x1
      dy = (main.y1 + main.y2) / 2 - (b.y1 + b.y2) / 2
    }
    for (const i of f) { pts[i].x += dx; pts[i].y += dy }
    right = Math.max(right, b.x2 + dx); left = Math.min(left, b.x1 + dx)
  }
  return frags[0]
}
