/*
 * Templates: rings, amino acids and reaction mechanisms. Each insert is one undo step.
 * Mechanisms are built from real molecules (RDKit layout), then given lone pairs, charges,
 * explicit H where an arrow needs one, curly arrows, reaction arrows and brackets.
 */
import type { ArrowKind, Doc, ID } from './model/types'
import { batch, commit, getDoc, newId } from './model/store'
import { bondBetween, bracketAround, contentBounds, flipItems, growBond, insertMolecule } from './model/ops'
import { parseMolfile } from './chem/molfile'
import { smilesToMolblock } from './chem/rdkit'

export interface StructureTemplate { name: string; smiles: string }

export const RINGS: StructureTemplate[] = [
  { name: 'Cyclopropane', smiles: 'C1CC1' },
  { name: 'Cyclobutane', smiles: 'C1CCC1' },
  { name: 'Cyclopentane', smiles: 'C1CCCC1' },
  { name: 'Cyclohexane', smiles: 'C1CCCCC1' },
  { name: 'Cyclohexene', smiles: 'C1=CCCCC1' },
  { name: 'Cycloheptane', smiles: 'C1CCCCCC1' },
  { name: 'Benzene', smiles: 'c1ccccc1' },
  { name: 'Naphthalene', smiles: 'c1ccc2ccccc2c1' },
  { name: 'Anthracene', smiles: 'c1ccc2cc3ccccc3cc2c1' },
  { name: 'Pyridine', smiles: 'c1ccncc1' },
  { name: 'Pyrrole', smiles: 'c1cc[nH]c1' },
  { name: 'Furan', smiles: 'c1ccoc1' },
  { name: 'Thiophene', smiles: 'c1ccsc1' },
  { name: 'Imidazole', smiles: 'c1cnc[nH]1' },
  { name: 'Indole', smiles: 'c1ccc2[nH]ccc2c1' },
  { name: 'Piperidine', smiles: 'C1CCNCC1' },
]

/** The 20 standard L-amino acids (PubChem isomeric SMILES). */
export const AMINO_ACIDS: StructureTemplate[] = [
  { name: 'Glycine (Gly)', smiles: 'C(C(=O)O)N' },
  { name: 'Alanine (Ala)', smiles: 'C[C@@H](C(=O)O)N' },
  { name: 'Valine (Val)', smiles: 'CC(C)[C@@H](C(=O)O)N' },
  { name: 'Leucine (Leu)', smiles: 'CC(C)C[C@@H](C(=O)O)N' },
  { name: 'Isoleucine (Ile)', smiles: 'CC[C@H](C)[C@@H](C(=O)O)N' },
  { name: 'Proline (Pro)', smiles: 'C1C[C@H](NC1)C(=O)O' },
  { name: 'Phenylalanine (Phe)', smiles: 'C1=CC=C(C=C1)C[C@@H](C(=O)O)N' },
  { name: 'Tryptophan (Trp)', smiles: 'C1=CC=C2C(=C1)C(=CN2)C[C@@H](C(=O)O)N' },
  { name: 'Methionine (Met)', smiles: 'CSCC[C@@H](C(=O)O)N' },
  { name: 'Serine (Ser)', smiles: 'C([C@@H](C(=O)O)N)O' },
  { name: 'Threonine (Thr)', smiles: 'C[C@H]([C@@H](C(=O)O)N)O' },
  { name: 'Cysteine (Cys)', smiles: 'C([C@@H](C(=O)O)N)S' },
  { name: 'Tyrosine (Tyr)', smiles: 'C1=CC(=CC=C1C[C@@H](C(=O)O)N)O' },
  { name: 'Asparagine (Asn)', smiles: 'C([C@@H](C(=O)O)N)C(=O)N' },
  { name: 'Glutamine (Gln)', smiles: 'C(CC(=O)N)[C@@H](C(=O)O)N' },
  { name: 'Aspartic acid (Asp)', smiles: 'C([C@@H](C(=O)O)N)C(=O)O' },
  { name: 'Glutamic acid (Glu)', smiles: 'C(CC(=O)O)[C@@H](C(=O)O)N' },
  { name: 'Lysine (Lys)', smiles: 'C(CCN)C[C@@H](C(=O)O)N' },
  { name: 'Arginine (Arg)', smiles: 'C(C[C@@H](C(=O)O)N)CN=C(N)N' },
  { name: 'Histidine (His)', smiles: 'C1=C(NC=N1)C[C@@H](C(=O)O)N' },
]

/** Where a new template goes: below what's already there, aligned to its left edge. */
function startPoint(d: Doc) {
  const b = contentBounds(d)
  return b ? { x: b.x1 + 20, y: b.y2 + 110 } : { x: 0, y: 0 }
}

/** Insert one structure; returns its atom ids. */
export async function insertTemplate(t: StructureTemplate, at?: { x: number; y: number }): Promise<ID[]> {
  const mb = await smilesToMolblock(t.smiles)
  if (!mb) throw new Error(`Couldn't build ${t.name}`)
  const m = parseMolfile(mb)
  const p = at ?? (() => { const b = contentBounds(getDoc()); return b ? { x: b.x2 + 90, y: (b.y1 + b.y2) / 2 } : { x: 0, y: 0 } })()
  return commit(d => insertMolecule(d, m, p).atomIds)
}

/** Lays species out left to right, wrapping into rows. */
class Scheme {
  private x0: number
  x: number
  y: number
  ids: ID[] = []
  constructor(at: { x: number; y: number }) { this.x0 = this.x = at.x; this.y = at.y }

  async mol(smiles: string): Promise<ID[]> {
    const mb = await smilesToMolblock(smiles)
    if (!mb) throw new Error(`Couldn't build ${smiles}`)
    const m = parseMolfile(mb)
    const xs = m.atoms.map(a => a.x)
    const w = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
    const cx = this.x + w / 2 + 16
    const ids = commit(d => insertMolecule(d, m, { x: cx, y: this.y }).atomIds)
    this.x = cx + w / 2 + 30
    this.ids.push(...ids)
    return ids
  }

  plus() { this.text('+', this.x, this.y + 5); this.x += 34 }

  text(s: string, x: number, y: number) {
    commit(d => { const id = newId('t'); d.texts[id] = { id, x: x - 4, y, text: s }; this.ids.push(id) })
  }

  arrow(above = '', below = '', kind: ArrowKind = 'forward') {
    const x1 = this.x, x2 = this.x + 96
    commit(d => {
      const id = newId('r')
      d.arrows[id] = { id, kind, x1, y1: this.y, x2, y2: this.y, above, below }
      this.ids.push(id)
    })
    this.x = x2 + 16
  }

  row() { this.x = this.x0; this.y += 170 }
  caption(s: string) { this.text(s, this.x0 + 4, this.y - 70) }
}

const lp = (id: ID, n: number) => commit(d => { d.atoms[id].lonePairs = n })
const bond = (a: ID, b: ID): ID => {
  const bd = bondBetween(getDoc(), a, b)
  if (!bd) throw new Error('Template bond missing')
  return bd.id
}
const pos = (id: ID) => {
  const d = getDoc()
  if (id[0] === 'b') { const b = d.bonds[id]; return { x: (d.atoms[b.a1].x + d.atoms[b.a2].x) / 2, y: (d.atoms[b.a1].y + d.atoms[b.a2].y) / 2 } }
  return d.atoms[id]
}
/** Curly arrow that arches upward, whichever way it points. */
const curly = (from: ID, to: ID, flip = false) => commit(d => {
  const id = newId('c')
  const up = pos(to).x >= pos(from).x ? 1 : -1
  d.curlies[id] = { id, from, to, half: false, bend: flip ? -up : up }
})
/** Explicit H on a carbon, so an arrow can point at it. */
const explicitH = (c: ID): ID => commit(d => growBond(d, c, 1, 'none', 'H'))
/**
 * Turn a molecule so `target` is on the given side of it (flip left-right if not), so arrows from a
 * partner on that side don't cross the molecule.
 */
const face = (ids: ID[], target: ID, side: 'left' | 'right') => {
  const xs = ids.map(id => pos(id).x)
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2
  const x = pos(target).x
  if ((side === 'left' && x > mid + 1) || (side === 'right' && x < mid - 1)) commit(d => flipItems(d, ids, 'h'))
}
/** The atom furthest right among ids (for picking which methyl the base reaches). */
const rightmost = (ids: ID[]) => ids.reduce((best, id) => (pos(id).x > pos(best).x ? id : best))

export interface MechanismTemplate { name: string; note: string; build: (s: Scheme) => Promise<void> }

async function ionise(s: Scheme) {
  const [, c2, , , br] = await s.mol('CC(C)(C)Br')
  lp(br, 3)
  curly(bond(c2, br), br)
  s.arrow('', 'slow')
  const cat = await s.mol('C[C+](C)C')
  s.plus()
  const [brm] = await s.mol('[Br-]')
  lp(brm, 4)
  return cat
}

export const MECHANISMS: MechanismTemplate[] = [
  {
    name: 'SN2', note: 'Hydroxide displaces bromide in one step',
    async build(s) {
      const [o] = await s.mol('[OH-]')
      lp(o, 3)
      s.plus()
      const [c, br] = await s.mol('CBr')
      face([c, br], c, 'left')
      lp(br, 3)
      curly(o, c)
      curly(bond(c, br), br)
      s.arrow()
      const [, o2] = await s.mol('CO')
      lp(o2, 2)
      s.plus()
      const [brm] = await s.mol('[Br-]')
      lp(brm, 4)
    },
  },
  {
    name: 'SN1', note: 'Ionisation to a carbocation, then capture by water',
    async build(s) {
      await ionise(s)
      s.row()
      const cat = await s.mol('C[C+](C)C')
      const cp = cat[1]
      face(cat, cp, 'right')
      s.plus()
      const [w] = await s.mol('O')
      lp(w, 2)
      curly(w, cp)
      s.arrow('', 'fast')
      const p = await s.mol('CC(C)(C)[OH2+]')
      lp(p[4], 1)
    },
  },
  {
    name: 'E1', note: 'Ionisation, then water removes a proton',
    async build(s) {
      await ionise(s)
      s.row()
      const [m1, cp, m2, m3] = await s.mol('C[C+](C)C')
      const me = rightmost([m1, m2, m3])
      const h = explicitH(me)
      s.plus()
      const [w] = await s.mol('O')
      lp(w, 2)
      curly(w, h)
      curly(bond(me, h), bond(me, cp))
      s.arrow()
      await s.mol('C=C(C)C')
      s.plus()
      const [h3o] = await s.mol('[OH3+]')
      lp(h3o, 1)
    },
  },
  {
    name: 'E2', note: 'Base removes a proton as bromide leaves',
    async build(s) {
      const sub = await s.mol('BrCC')
      const [br, c2, c1] = sub
      face(sub, c1, 'right')
      lp(br, 3)
      const h = explicitH(c1)
      s.x = Math.max(s.x, pos(h).x + 30)
      s.plus()
      const [o] = await s.mol('[OH-]')
      lp(o, 3)
      curly(o, h)
      curly(bond(c1, h), bond(c1, c2))
      curly(bond(c2, br), br)
      s.arrow()
      await s.mol('C=C')
      s.plus()
      const [w] = await s.mol('O')
      lp(w, 2)
      s.plus()
      const [brm] = await s.mol('[Br-]')
      lp(brm, 4)
    },
  },
  {
    name: 'Carbonyl addition', note: 'Cyanide adds to acetaldehyde; the alkoxide is protonated',
    async build(s) {
      const [c] = await s.mol('[C-]#N')
      lp(c, 1)
      s.plus()
      const ald = await s.mol('CC=O')
      const [, cc, o] = ald
      face(ald, o, 'right') // the O points away from the cyanide, so its arrow doesn't cross the C=O
      lp(o, 2)
      curly(c, cc)
      curly(bond(cc, o), o)
      s.arrow()
      const inter = await s.mol('CC([O-])C#N')
      lp(inter[2], 3)
      commit(d => { const k = bracketAround(d, inter, '', 16); if (k) s.ids.push(k) })
      s.x += 18
      s.arrow('H⁺')
      const prod = await s.mol('CC(O)C#N')
      lp(prod[2], 2)
    },
  },
]

/** Insert a mechanism below the current drawing, as one undo step. Returns everything it added. */
export function insertMechanism(t: MechanismTemplate): Promise<ID[]> {
  return batch(async () => {
    const s = new Scheme(startPoint(getDoc()))
    await t.build(s)
    return s.ids
  })
}
