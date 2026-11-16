import type { Atom, BondOrder, BondStereo, Doc, ID } from './types'
import { kindOf } from './types'
import { BOND, add, angleGap, angleOf, dist, fromAngle, mid, mul, norm, perp, sub, type P, type Rect } from './geometry'
import { adjacency, type Adjacency } from '../chem/chem'
import type { ParsedMol } from '../chem/molfile'
import { newId } from './store'
import { freeValence } from '../chem/valence'

export function addAtom(d: Doc, x: number, y: number, element = 'C', charge = 0): ID {
  const id = newId('a')
  d.atoms[id] = { id, x, y, element, charge, lonePairs: 0, radical: false }
  return id
}

export function atomNear(d: Doc, p: P, tol = BOND * 0.3, exclude?: ID): ID | null {
  let best: ID | null = null, bestD = tol
  for (const a of Object.values(d.atoms)) {
    if (a.id === exclude) continue
    const dd = dist(a, p)
    if (dd < bestD) { bestD = dd; best = a.id }
  }
  return best
}

export function atomAtOrNew(d: Doc, p: P): ID {
  return atomNear(d, p) ?? addAtom(d, p.x, p.y)
}

export function bondBetween(d: Doc, a1: ID, a2: ID) {
  return Object.values(d.bonds).find(b => (b.a1 === a1 && b.a2 === a2) || (b.a1 === a2 && b.a2 === a1))
}

export function addBond(d: Doc, a1: ID, a2: ID, order: BondOrder = 1, stereo: BondStereo = 'none'): ID {
  if (a1 === a2) throw new Error('A bond needs two different atoms')
  const existing = bondBetween(d, a1, a2)
  if (existing) return existing.id
  const id = newId('b')
  d.bonds[id] = { id, a1, a2, order, stereo }
  return id
}

/** Best direction for a new bond leaving `atomId`: zigzag for chains, widest gap otherwise. */
export function nextBondDirection(d: Doc, atomId: ID, adj: Adjacency = adjacency(d)): P {
  const a = d.atoms[atomId]
  const ns = adj.get(atomId) ?? []
  const angles = ns.map(n => angleOf(sub(d.atoms[n.other], a)))
  if (angles.length === 0) return fromAngle(-Math.PI / 6)
  // sp atoms (triple bond, or two double bonds as in allenes/CO2) are linear
  const linear = ns.some(n => n.bond.order === 3) || ns.filter(n => n.bond.order === 2).length >= 2
  if (angles.length === 1 && linear) return fromAngle(angles[0] + Math.PI)
  if (angles.length === 1) {
    const cands = [angles[0] + (2 * Math.PI) / 3, angles[0] - (2 * Math.PI) / 3]
    const score = (ang: number) => {
      const end = add(a, mul(fromAngle(ang), BOND))
      let minD = BOND
      for (const o of Object.values(d.atoms)) if (o.id !== atomId) minD = Math.min(minD, dist(o, end))
      return minD + 0.3 * Math.abs(Math.cos(ang)) * BOND
    }
    return fromAngle(score(cands[0]) >= score(cands[1]) ? cands[0] : cands[1])
  }
  const sorted = [...angles].sort((x, y) => x - y)
  let bestGap = -1, bestAng = 0
  for (let i = 0; i < sorted.length; i++) {
    const a1 = sorted[i], a2 = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2
    if (a2 - a1 > bestGap) { bestGap = a2 - a1; bestAng = (a1 + a2) / 2 }
  }
  return fromAngle(bestAng)
}

/** Add a new carbon bonded to `atomId` in the best free direction. Returns the new atom id. */
export function growBond(d: Doc, atomId: ID, order: BondOrder = 1, stereo: BondStereo = 'none', element = 'C'): ID {
  const a = d.atoms[atomId]
  const dir = nextBondDirection(d, atomId)
  const p = add(a, mul(dir, BOND))
  const target = atomNear(d, p, BOND * 0.2, atomId) ?? addAtom(d, p.x, p.y, element)
  const bid = addBond(d, atomId, target, order, stereo)
  if (order === 3) straightenTriple(d, bid)
  return target
}

/**
 * Make the atoms around a triple bond collinear: for each end with one other substituent,
 * rotate that substituent's branch so it continues in a straight line.
 */
export function straightenTriple(d: Doc, bondId: ID) {
  const b = d.bonds[bondId]
  if (!b || b.order !== 3) return
  for (const [endId, otherId] of [[b.a1, b.a2], [b.a2, b.a1]]) {
    const adj = adjacency(d)
    const subs = (adj.get(endId) ?? []).filter(n => n.other !== otherId)
    if (subs.length !== 1) continue
    const E = d.atoms[endId], O = d.atoms[otherId]
    // collect the branch on the substituent's side, without crossing back through E
    const branch = new Set<ID>([subs[0].other])
    const stack = [subs[0].other]
    while (stack.length) {
      const cur = stack.pop()!
      for (const n of adj.get(cur) ?? []) {
        if (n.other === endId || branch.has(n.other)) continue
        branch.add(n.other); stack.push(n.other)
      }
    }
    if (branch.has(otherId)) continue // in a ring; leave it alone
    const want = angleOf(sub(E, O))
    const have = angleOf(sub(d.atoms[subs[0].other], E))
    const rot = want - have
    if (Math.abs(Math.sin(rot)) < 1e-3 && Math.cos(rot) > 0) continue
    const c = Math.cos(rot), s = Math.sin(rot)
    for (const id of branch) {
      const a = d.atoms[id]
      const dx = a.x - E.x, dy = a.y - E.y
      a.x = E.x + dx * c - dy * s
      a.y = E.y + dx * s + dy * c
    }
  }
}

/** Apply the bond tool to an existing bond: set the style, or cycle the order if it already matches. */
export function applyBondStyle(d: Doc, bondId: ID, order: BondOrder, stereo: BondStereo) {
  const b = d.bonds[bondId]
  if (!b) return
  if (stereo !== 'none') {
    if (b.stereo === stereo) [b.a1, b.a2] = [b.a2, b.a1]
    else { b.stereo = stereo; b.order = 1 }
  } else if (b.stereo !== 'none') {
    b.stereo = 'none'; b.order = order
  } else if (b.order === order) {
    // cycle 1 → 2 → 3 → 1, skipping orders the atoms have no room for
    const room = Math.min(freeValence(d, b.a1), freeValence(d, b.a2)) + b.order
    const next = (order === 3 ? 1 : order + 1) as BondOrder
    b.order = next <= room ? next : 1
  } else {
    b.order = order
  }
  if (b.order === 3) straightenTriple(d, bondId)
}

export type RingTarget = { kind: 'point'; p: P } | { kind: 'atom'; id: ID } | { kind: 'bond'; id: ID }

export function addRing(d: Doc, size: number, aromatic: boolean, target: RingTarget): ID[] {
  const n = size
  const r = BOND / (2 * Math.sin(Math.PI / n))
  const step = (2 * Math.PI) / n
  const pts: P[] = []
  const fixed: (ID | null)[] = new Array(n).fill(null)
  const adj = adjacency(d)

  if (target.kind === 'point') {
    const c = target.p
    for (let k = 0; k < n; k++) pts.push(add(c, mul(fromAngle(-Math.PI / 2 + k * step), r)))
  } else if (target.kind === 'atom') {
    const a = d.atoms[target.id]
    const ns = adj.get(a.id) ?? []
    let away: P = { x: 0, y: -1 }
    if (ns.length) {
      let s: P = { x: 0, y: 0 }
      for (const nb of ns) s = add(s, norm(sub(d.atoms[nb.other], a)))
      away = Math.hypot(s.x, s.y) < 1e-3 ? perp(norm(sub(d.atoms[ns[0].other], a))) : mul(norm(s), -1)
    }
    const c = add(a, mul(away, r))
    const t0 = angleOf(sub(a, c))
    for (let k = 0; k < n; k++) pts.push(add(c, mul(fromAngle(t0 + k * step), r)))
    fixed[0] = a.id
  } else {
    const b = d.bonds[target.id]
    const A = d.atoms[b.a1], B = d.atoms[b.a2]
    const m = mid(A, B)
    const nrm = perp(norm(sub(B, A)))
    let s = 0
    for (const id of [A.id, B.id]) {
      for (const nb of adj.get(id) ?? []) {
        if (nb.other === A.id || nb.other === B.id) continue
        const o = d.atoms[nb.other]
        s += (o.x - m.x) * nrm.x + (o.y - m.y) * nrm.y
      }
    }
    const side = s > 0 ? mul(nrm, -1) : nrm
    const c = add(m, mul(side, r * Math.cos(Math.PI / n)))
    const tA = angleOf(sub(A, c)), tB = angleOf(sub(B, c))
    const dir = angleGap(tA + step, tB) < 0.01 ? -1 : 1
    for (let k = 0; k < n; k++) pts.push(add(c, mul(fromAngle(tA + dir * k * step), r)))
    fixed[0] = A.id
    fixed[n - 1] = B.id
  }

  const ids = pts.map((p, k) => fixed[k] ?? atomAtOrNew(d, p))
  const ringBonds: ID[] = []
  for (let k = 0; k < n; k++) ringBonds.push(addBond(d, ids[k], ids[(k + 1) % n]))

  if (aromatic) {
    const hasMultiple = (atomId: ID) =>
      Object.values(d.bonds).some(b => (b.a1 === atomId || b.a2 === atomId) && b.order > 1)
    for (const bid of ringBonds) {
      const b = d.bonds[bid]
      if (b.order === 1 && !hasMultiple(b.a1) && !hasMultiple(b.a2)
        && freeValence(d, b.a1) >= 1 && freeValence(d, b.a2) >= 1) b.order = 2
    }
  }
  return ids
}

/** Delete atoms, bonds, arrows, curly arrows and texts. Bonds of deleted atoms go too. */
export function removeItems(d: Doc, ids: ID[]) {
  const gone = new Set<ID>()
  for (const id of ids) {
    switch (kindOf(id)) {
      case 'atom':
        if (!d.atoms[id]) break
        delete d.atoms[id]; gone.add(id)
        for (const b of Object.values(d.bonds)) if (b.a1 === id || b.a2 === id) { delete d.bonds[b.id]; gone.add(b.id) }
        break
      case 'bond': if (d.bonds[id]) { delete d.bonds[id]; gone.add(id) } break
      case 'arrow': delete d.arrows[id]; break
      case 'curly': delete d.curlies[id]; break
      case 'text': delete d.texts[id]; break
    }
  }
  for (const c of Object.values(d.curlies)) if (gone.has(c.from) || gone.has(c.to)) delete d.curlies[c.id]
}

export function moveItems(d: Doc, ids: ID[], dx: number, dy: number) {
  const atoms = new Set<ID>()
  for (const id of ids) {
    const k = kindOf(id)
    if (k === 'atom') atoms.add(id)
    else if (k === 'bond' && d.bonds[id]) { atoms.add(d.bonds[id].a1); atoms.add(d.bonds[id].a2) }
    else if (k === 'arrow' && d.arrows[id]) {
      const a = d.arrows[id]
      a.x1 += dx; a.x2 += dx; a.y1 += dy; a.y2 += dy
    } else if (k === 'text' && d.texts[id]) { d.texts[id].x += dx; d.texts[id].y += dy }
  }
  for (const id of atoms) { const a = d.atoms[id]; if (a) { a.x += dx; a.y += dy } }
}

/** Insert a parsed molfile centred at `center`. Returns ids in molfile atom order. */
export function insertMolecule(d: Doc, m: ParsedMol, center: P): { atomIds: ID[]; bondIds: ID[] } {
  if (!m.atoms.length) return { atomIds: [], bondIds: [] }
  let cx = 0, cy = 0
  for (const a of m.atoms) { cx += a.x; cy += a.y }
  cx /= m.atoms.length; cy /= m.atoms.length
  const atomIds = m.atoms.map(a => addAtom(d, a.x - cx + center.x, a.y - cy + center.y, a.element, a.charge))
  const bondIds = m.bonds.map(b => {
    const id = newId('b')
    d.bonds[id] = { id, a1: atomIds[b.i], a2: atomIds[b.j], order: b.order, stereo: b.stereo }
    return id
  })
  return { atomIds, bondIds }
}

export function atomsBounds(atoms: Atom[]): Rect | null {
  if (!atoms.length) return null
  const r = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }
  for (const a of atoms) {
    r.x1 = Math.min(r.x1, a.x); r.y1 = Math.min(r.y1, a.y)
    r.x2 = Math.max(r.x2, a.x); r.y2 = Math.max(r.y2, a.y)
  }
  return r
}

/** Bounding box of everything on the canvas (without label padding). */
export function contentBounds(d: Doc): Rect | null {
  const xs: number[] = [], ys: number[] = []
  for (const a of Object.values(d.atoms)) { xs.push(a.x); ys.push(a.y) }
  for (const a of Object.values(d.arrows)) { xs.push(a.x1, a.x2); ys.push(a.y1, a.y2) }
  for (const t of Object.values(d.texts)) {
    const size = t.size ?? 14
    xs.push(t.x, t.x + t.text.length * size * 0.6); ys.push(t.y - size, t.y)
  }
  if (!xs.length) return null
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/** Where to drop new content: to the right of what's there. */
export function nextFreeSpot(d: Doc, width = BOND * 2): P {
  const b = contentBounds(d)
  if (!b) return { x: 0, y: 0 }
  return { x: b.x2 + 50 + width / 2, y: (b.y1 + b.y2) / 2 }
}
