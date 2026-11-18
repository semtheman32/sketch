import type { Atom, BondOrder, BondStereo, Doc, ID } from './types'
import { emptyDoc, kindOf } from './types'
import { BOND, add, angleGap, angleOf, dist, fromAngle, mid, mul, norm, perp, rotate, sub, type P, type Rect } from './geometry'
import { adjacency, type Adjacency } from '../chem/chem'
import type { ParsedMol } from '../chem/molfile'
import { newId } from './store'
import { bondSum, freeValence, reachableBonds } from '../chem/valence'

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
    // cycle 1 → 2 → 3 → 1, skipping orders the atoms have no room for (even with an automatic charge)
    const reach = (id: ID) => { const a = d.atoms[id]; return reachableBonds(a.element, a.charge, a.radical) - bondSum(d, id) }
    const room = Math.min(reach(b.a1), reach(b.a2)) + b.order
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
      case 'bracket': delete d.brackets[id]; break
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
    else if (k === 'bracket' && d.brackets[id]) {
      const b = d.brackets[id]
      b.x1 += dx; b.x2 += dx; b.y1 += dy; b.y2 += dy
    }
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
  for (const k of Object.values(d.brackets ?? {})) { xs.push(k.x1, k.x2 + (k.label ? 14 : 0)); ys.push(k.y1 - (k.label ? 8 : 0), k.y2) }
  if (!xs.length) return null
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/** Where to drop new content: to the right of what's there. */
export function nextFreeSpot(d: Doc, width = BOND * 2): P {
  const b = contentBounds(d)
  if (!b) return { x: 0, y: 0 }
  return { x: b.x2 + 50 + width / 2, y: (b.y1 + b.y2) / 2 }
}

// ------------------------------------------------------------------ selections

/** Atom ids covered by a selection: selected atoms plus both ends of selected bonds. */
export function selectedAtoms(d: Doc, ids: ID[]): Set<ID> {
  const atoms = new Set<ID>()
  for (const id of ids) {
    const k = kindOf(id)
    if (k === 'atom' && d.atoms[id]) atoms.add(id)
    else if (k === 'bond' && d.bonds[id]) { atoms.add(d.bonds[id].a1); atoms.add(d.bonds[id].a2) }
  }
  return atoms
}

/** Bounding box of the selected items (atoms, arrows, texts, brackets). */
export function selectionBounds(d: Doc, ids: ID[]): Rect | null {
  const xs: number[] = [], ys: number[] = []
  for (const id of selectedAtoms(d, ids)) { xs.push(d.atoms[id].x); ys.push(d.atoms[id].y) }
  for (const id of ids) {
    const k = kindOf(id)
    if (k === 'arrow' && d.arrows[id]) { const a = d.arrows[id]; xs.push(a.x1, a.x2); ys.push(a.y1, a.y2) }
    else if (k === 'text' && d.texts[id]) { const t = d.texts[id]; const s = t.size ?? 14; xs.push(t.x, t.x + t.text.length * s * 0.6); ys.push(t.y - s, t.y) }
    else if (k === 'bracket' && d.brackets[id]) { const b = d.brackets[id]; xs.push(b.x1, b.x2); ys.push(b.y1, b.y2) }
  }
  if (!xs.length) return null
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/**
 * A copy of `d` that is safe to move/rotate `ids` in: the item maps are new, and only the
 * entries that will change are copied (far cheaper than structuredClone while dragging).
 */
export function cloneTouched(d: Doc, ids: ID[]): Doc {
  const out: Doc = { ...d, atoms: { ...d.atoms }, arrows: { ...d.arrows }, texts: { ...d.texts }, brackets: { ...(d.brackets ?? {}) } }
  for (const id of selectedAtoms(d, ids)) out.atoms[id] = { ...d.atoms[id] }
  for (const id of ids) {
    const k = kindOf(id)
    if (k === 'arrow' && d.arrows[id]) out.arrows[id] = { ...d.arrows[id] }
    else if (k === 'text' && d.texts[id]) out.texts[id] = { ...d.texts[id] }
    else if (k === 'bracket' && d.brackets?.[id]) out.brackets[id] = { ...d.brackets[id] }
  }
  return out
}

/**
 * Split a document for a smooth drag: what moves and what stays. Returns null when the move
 * stretches a bond or curly arrow between the two parts (then the drag edits the document live).
 */
export function splitForDrag(d: Doc, ids: ID[]): { stat: Doc; moving: Doc } | null {
  const atoms = selectedAtoms(d, ids)
  const moving = emptyDoc(), stat = emptyDoc()
  for (const a of Object.values(d.atoms)) (atoms.has(a.id) ? moving : stat).atoms[a.id] = a
  for (const b of Object.values(d.bonds)) {
    const n = (atoms.has(b.a1) ? 1 : 0) + (atoms.has(b.a2) ? 1 : 0)
    if (n === 1) return null
    ;(n === 2 ? moving : stat).bonds[b.id] = b
  }
  const sel = new Set(ids)
  for (const r of Object.values(d.arrows)) (sel.has(r.id) ? moving : stat).arrows[r.id] = r
  for (const t of Object.values(d.texts)) (sel.has(t.id) ? moving : stat).texts[t.id] = t
  for (const k of Object.values(d.brackets ?? {})) (sel.has(k.id) ? moving : stat).brackets[k.id] = k
  const side = (anchor: ID) => (moving.atoms[anchor] || moving.bonds[anchor] ? 'm' : 's')
  for (const c of Object.values(d.curlies)) {
    const a = side(c.from), b = side(c.to)
    if (a !== b) return null
    ;(a === 'm' ? moving : stat).curlies[c.id] = c
  }
  return { stat, moving }
}

/** Rotate the selection by `ang` radians around `c` (screen y-down, so positive is clockwise). */
export function rotateItems(d: Doc, ids: ID[], c: P, ang: number) {
  const turn = (p: P) => add(c, rotate(sub(p, c), ang))
  for (const id of selectedAtoms(d, ids)) Object.assign(d.atoms[id], turn(d.atoms[id]))
  for (const id of ids) {
    const k = kindOf(id)
    if (k === 'arrow' && d.arrows[id]) {
      const a = d.arrows[id]
      const p1 = turn({ x: a.x1, y: a.y1 }), p2 = turn({ x: a.x2, y: a.y2 })
      a.x1 = p1.x; a.y1 = p1.y; a.x2 = p2.x; a.y2 = p2.y
    } else if (k === 'text' && d.texts[id]) {
      Object.assign(d.texts[id], turn(d.texts[id]))
    } else if (k === 'bracket' && d.brackets[id]) {
      // brackets stay upright: move their centre
      const b = d.brackets[id]
      const m = turn(mid({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }))
      const hw = (b.x2 - b.x1) / 2, hh = (b.y2 - b.y1) / 2
      b.x1 = m.x - hw; b.x2 = m.x + hw; b.y1 = m.y - hh; b.y2 = m.y + hh
    }
  }
}

/** Mirror the selection left-right ('h') or top-bottom ('v') about its own centre. */
export function flipItems(d: Doc, ids: ID[], axis: 'h' | 'v') {
  const r = selectionBounds(d, ids)
  if (!r) return
  const cx = (r.x1 + r.x2) / 2, cy = (r.y1 + r.y2) / 2
  const fx = (x: number) => (axis === 'h' ? 2 * cx - x : x)
  const fy = (y: number) => (axis === 'v' ? 2 * cy - y : y)
  const atoms = selectedAtoms(d, ids)
  for (const id of atoms) { const a = d.atoms[id]; a.x = fx(a.x); a.y = fy(a.y) }
  for (const id of ids) {
    const k = kindOf(id)
    if (k === 'arrow' && d.arrows[id]) {
      const a = d.arrows[id]
      a.x1 = fx(a.x1); a.x2 = fx(a.x2); a.y1 = fy(a.y1); a.y2 = fy(a.y2)
    } else if (k === 'text' && d.texts[id]) {
      const t = d.texts[id]
      const w = t.text.length * (t.size ?? 14) * 0.6
      if (axis === 'h') t.x = 2 * cx - t.x - w
      else t.y = fy(t.y) + (t.size ?? 14) * 0.7
    } else if (k === 'bracket' && d.brackets[id]) {
      const b = d.brackets[id]
      const xs = [fx(b.x1), fx(b.x2)].sort((p, q) => p - q), ys = [fy(b.y1), fy(b.y2)].sort((p, q) => p - q)
      b.x1 = xs[0]; b.x2 = xs[1]; b.y1 = ys[0]; b.y2 = ys[1]
    }
  }
  // A mirrored curly arrow bends the other way.
  const inSel = (anchor: ID) => atoms.has(anchor) || (kindOf(anchor) === 'bond' && !!d.bonds[anchor] && atoms.has(d.bonds[anchor].a1) && atoms.has(d.bonds[anchor].a2))
  for (const c of Object.values(d.curlies)) if (inSel(c.from) && inSel(c.to)) c.bend *= -1
}

/** Wrap the selection in a bracket. Returns the new bracket id. */
export function bracketAround(d: Doc, ids: ID[], label = '', pad = 14): ID | null {
  const r = selectionBounds(d, ids)
  if (!r) return null
  const id = newId('k')
  d.brackets[id] = { id, x1: r.x1 - pad, y1: r.y1 - pad, x2: r.x2 + pad, y2: r.y2 + pad, shape: 'square', label }
  return id
}

// ------------------------------------------------------------------ copy and paste

/**
 * The selected items as a stand-alone document: the atoms and every bond between them,
 * plus selected arrows, texts and brackets, and curly arrows whose both ends are copied.
 */
export function copyItems(d: Doc, ids: ID[]): Doc {
  const out = emptyDoc()
  const atoms = selectedAtoms(d, ids)
  for (const id of atoms) out.atoms[id] = structuredClone(d.atoms[id])
  for (const b of Object.values(d.bonds)) if (atoms.has(b.a1) && atoms.has(b.a2)) out.bonds[b.id] = structuredClone(b)
  for (const id of ids) {
    const k = kindOf(id)
    if (k === 'arrow' && d.arrows[id]) out.arrows[id] = structuredClone(d.arrows[id])
    else if (k === 'text' && d.texts[id]) out.texts[id] = structuredClone(d.texts[id])
    else if (k === 'bracket' && d.brackets[id]) out.brackets[id] = structuredClone(d.brackets[id])
  }
  const has = (anchor: ID) => !!out.atoms[anchor] || !!out.bonds[anchor]
  for (const c of Object.values(d.curlies)) if (has(c.from) && has(c.to)) out.curlies[c.id] = structuredClone(c)
  return out
}

/** Add a copied fragment to `d`, shifted by (dx, dy), with fresh ids. Returns the new ids. */
export function pasteFragment(d: Doc, frag: Doc, dx: number, dy: number): ID[] {
  const map = new Map<ID, ID>()
  const added: ID[] = []
  for (const a of Object.values(frag.atoms)) {
    const id = newId('a'); map.set(a.id, id)
    d.atoms[id] = { ...a, id, x: a.x + dx, y: a.y + dy }; added.push(id)
  }
  for (const b of Object.values(frag.bonds)) {
    const a1 = map.get(b.a1), a2 = map.get(b.a2)
    if (!a1 || !a2) continue
    const id = newId('b'); map.set(b.id, id)
    d.bonds[id] = { ...b, id, a1, a2 }; added.push(id)
  }
  for (const r of Object.values(frag.arrows ?? {})) {
    const id = newId('r')
    d.arrows[id] = { ...r, id, x1: r.x1 + dx, x2: r.x2 + dx, y1: r.y1 + dy, y2: r.y2 + dy }; added.push(id)
  }
  for (const t of Object.values(frag.texts ?? {})) {
    const id = newId('t')
    d.texts[id] = { ...t, id, x: t.x + dx, y: t.y + dy }; added.push(id)
  }
  for (const k of Object.values(frag.brackets ?? {})) {
    const id = newId('k')
    d.brackets[id] = { ...k, id, x1: k.x1 + dx, x2: k.x2 + dx, y1: k.y1 + dy, y2: k.y2 + dy }; added.push(id)
  }
  for (const c of Object.values(frag.curlies ?? {})) {
    const from = map.get(c.from), to = map.get(c.to)
    if (!from || !to) continue
    const id = newId('c')
    d.curlies[id] = { ...c, id, from, to }; added.push(id)
  }
  return added
}

/** Ids of items that are new or different in `after` compared with `before`. */
export function changedIds(before: Doc, after: Doc): ID[] {
  const out: ID[] = []
  const groups = ['atoms', 'bonds', 'arrows', 'curlies', 'texts', 'brackets'] as const
  for (const g of groups) {
    const a = (before[g] ?? {}) as Record<ID, unknown>, b = (after[g] ?? {}) as Record<ID, unknown>
    for (const id of Object.keys(b)) if (a[id] !== b[id] && JSON.stringify(a[id]) !== JSON.stringify(b[id])) out.push(id)
  }
  return out
}
