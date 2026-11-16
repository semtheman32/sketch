import type { BondOrder, BondStereo, Doc, ID } from '../model/types'
import { BOND } from '../model/geometry'

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
    lines.push(`${pad(x, 10)}${pad(y, 10)}${pad('0.0000', 10)} ${a.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`)
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
  return stripHydrogens({ atoms, bonds })
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
