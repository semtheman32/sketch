import type { Arrow, Atom, Bond, Bracket, Curly, Doc, ID, TextItem } from '../model/types'
import { kindOf } from '../model/types'
import { add, angleGap, angleOf, dist, distToSeg, fromAngle, len, mid, mul, norm, perp, quadPoint, sub, type P } from '../model/geometry'
import { hCount, type Adjacency } from '../chem/chem'

export const FONT = 14

export function textWidth(s: string, size = FONT): number {
  let w = 0
  for (const c of s) w += (/[A-Z]/.test(c) ? 0.68 : /[a-z]/.test(c) ? 0.54 : 0.58) * size
  return w
}

export interface AtomVisual {
  showLabel: boolean
  h: number
  hSide: 'left' | 'right'
  /** How far bonds stop short of the atom centre. */
  trim: number
}

const H_LEFT_WHEN_ALONE = new Set(['O', 'S', 'Se', 'F', 'Cl', 'Br', 'I'])

/**
 * How an atom is drawn. `font`/`margin` come from the drawing style, so bonds stop the right
 * distance short of bigger labels (ACS) or smaller ones.
 */
export function atomVisual(doc: Doc, a: Atom, adj: Adjacency, font = FONT, margin = 4): AtomVisual {
  const ns = adj.get(a.id) ?? []
  // Carbon is a bare vertex, unless it stands alone or has lone pairs to show (a carbanion in a mechanism).
  const showLabel = a.element !== 'C' || ns.length === 0 || a.lonePairs > 0
  const h = showLabel ? hCount(a, adj) : 0
  let hSide: 'left' | 'right' = 'right'
  if (ns.length === 0) hSide = H_LEFT_WHEN_ALONE.has(a.element) ? 'left' : 'right'
  else {
    let sx = 0
    for (const n of ns) sx += norm(sub(doc.atoms[n.other], a)).x
    if (sx > 0.1) hSide = 'left'
  }
  // Bonds to a heteroatom (O, N, halogens…) stop further from its label than the label needs, so
  // they read as visibly shorter than a C–C bond and can't be mistaken for one.
  const hetero = a.element !== 'C' ? font * 0.35 : 0
  return { showLabel, h, hSide, trim: showLabel ? font * 0.36 + margin + hetero : 0 }
}

/** Free directions around an atom (for lone pairs and radicals), most open first. */
export function freeAngles(doc: Doc, a: Atom, adj: Adjacency, vis: AtomVisual, count: number): number[] {
  const occupied = (adj.get(a.id) ?? []).map(n => angleOf(sub(doc.atoms[n.other], a)))
  if (vis.h > 0) occupied.push(vis.hSide === 'right' ? 0 : Math.PI)
  if (a.charge) { const c = chargeDir(doc, a, adj, vis); occupied.push(Math.atan2(c.y, c.x)) }
  const out: number[] = []
  // Straight up/down/left/right read best; fall back to diagonals when those are crowded.
  const axes = [-Math.PI / 2, Math.PI / 2, 0, Math.PI]
  const diagonals = [-Math.PI / 4, (-3 * Math.PI) / 4, Math.PI / 4, (3 * Math.PI) / 4]
  const gapTo = (c: number) => {
    const all = [...occupied, ...out]
    return all.length ? Math.min(...all.map(o => angleGap(o, c))) : Math.PI
  }
  const pickFrom = (cands: number[]) => {
    let best = cands[0], bestScore = -1
    for (const c of cands) {
      const s = gapTo(c)
      if (s > bestScore + 1e-6) { bestScore = s; best = c }
    }
    return { best, bestScore }
  }
  for (let i = 0; i < count; i++) {
    const ax = pickFrom(axes)
    out.push(ax.bestScore >= Math.PI / 3 - 1e-6 ? ax.best : pickFrom([...axes, ...diagonals]).best)
  }
  return out
}

/**
 * Where an atom's charge sign goes, as a direction (x, y in -1..1): top-right unless a bond or the H label
 * is that way, then the other corners, then straight right, left, above or below. Charges are placed
 * before lone pairs, and the dots go around them (see freeAngles).
 */
export function chargeDir(doc: Doc, a: Atom, adj: Adjacency, vis: AtomVisual): P {
  const dirs = (adj.get(a.id) ?? []).map(n => doc.atoms[n.other]).filter(Boolean).map(o => Math.atan2(o.y - a.y, o.x - a.x))
  if (vis.showLabel && vis.h > 0) dirs.push(vis.hSide === 'right' ? 0 : Math.PI)
  const options = [{ x: 1, y: -1 }, { x: -1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]
  const clearance = (c: P) => Math.min(Math.PI, ...dirs.map(d => angleGap(d, Math.atan2(c.y, c.x))))
  return options.find(c => clearance(c) >= Math.PI / 3 - 1e-6) ?? options.reduce((b, c) => (clearance(c) > clearance(b) ? c : b))
}

export interface ElectronDots { pairs: P[][]; radical: P | null; centers: P[] }

export function electronDots(doc: Doc, a: Atom, adj: Adjacency, vis: AtomVisual, scale = 1): ElectronDots {
  const n = a.lonePairs + (a.radical ? 1 : 0)
  if (!n) return { pairs: [], radical: null, centers: [] }
  const angles = freeAngles(doc, a, adj, vis, n)
  const r = vis.showLabel ? 13 * scale : 9
  const pairs: P[][] = [], centers: P[] = []
  let radical: P | null = null
  angles.forEach((ang, i) => {
    const dir = fromAngle(ang)
    // dots sit a bit further out horizontally because labels are wider than tall
    const rr = r + (Math.abs(dir.x) > 0.5 ? 2 * scale : 0)
    const c = add(a, mul(dir, rr))
    const t = mul(perp(dir), 3)
    if (i < a.lonePairs) { pairs.push([add(c, t), sub(c, t)]); centers.push(c) }
    else radical = c
  })
  return { pairs, radical, centers }
}

export function anchorPoint(doc: Doc, id: ID): P | null {
  if (kindOf(id) === 'atom') return doc.atoms[id] ?? null
  if (kindOf(id) === 'bond') {
    const b = doc.bonds[id]
    if (!b || !doc.atoms[b.a1] || !doc.atoms[b.a2]) return null
    return mid(doc.atoms[b.a1], doc.atoms[b.a2])
  }
  return null
}

export interface CurlyGeom { p0: P; ctrl: P; p1: P }

/** How far the control point sits off the chord. Short arrows still get a visible arc. */
export const curlyLift = (chordLength: number) => Math.max(chordLength * 0.45, 30)

export function curlyGeometry(doc: Doc, c: Curly, adj: Adjacency, scale = 1): CurlyGeom | null {
  let s = anchorPoint(doc, c.from)
  const e = anchorPoint(doc, c.to)
  if (!s || !e) return null
  const side = Math.sign(c.bend || 1)
  let trimS = kindOf(c.from) === 'bond' ? 2 : 10
  if (kindOf(c.from) === 'atom') {
    const a = doc.atoms[c.from]
    if (a.lonePairs > 0) {
      const dots = electronDots(doc, a, adj, atomVisual(doc, a, adj), scale)
      let best = dots.centers[0]
      for (const p of dots.centers) if (dist(p, e) < dist(best, e)) best = p
      s = best
      trimS = 4
    }
  }
  let trimE = 4
  let e2: P = e
  let lift: number | null = null
  if (kindOf(c.to) === 'atom') {
    const toAtom = doc.atoms[c.to]
    const toVis = atomVisual(doc, toAtom, adj)
    trimE = toVis.showLabel ? 13 * scale : 7
    // Bond breaking toward one of its own atoms: the arrow leaves the bond sideways and lands on the
    // outside of the atom, just beyond its label and lone pairs, so it reads as a clean hook.
    const b = kindOf(c.from) === 'bond' ? doc.bonds[c.from] : undefined
    if (b && (b.a1 === c.to || b.a2 === c.to)) {
      const other = doc.atoms[b.a1 === c.to ? b.a2 : b.a1]
      const along = norm(sub(e, other))
      const r = (toVis.showLabel ? (toAtom.lonePairs ? 19 : 13) : 7) * scale
      e2 = add(add(e, mul(along, r * 0.35)), mul(perp(along), side * r))
      trimE = 1.5 * scale
      lift = Math.max(len(sub(e2, s)) * 0.6, 26)
    }
  }
  const dv = sub(e2, s)
  const L = len(dv)
  if (L < 1) return null
  const ctrl = add(mid(s, e2), mul(perp(norm(dv)), c.bend * (lift ?? curlyLift(L))))
  return {
    p0: add(s, mul(norm(sub(ctrl, s)), trimS)),
    ctrl,
    p1: add(e2, mul(norm(sub(ctrl, e2)), trimE)),
  }
}

/**
 * Which way a new curly arrow should bend (1 or -1): the side whose curve passes furthest from atoms,
 * labels and bonds that the arrow isn't about.
 */
export function autoBend(doc: Doc, from: ID, to: ID, adj: Adjacency): 1 | -1 {
  const own = new Set<ID>()
  for (const id of [from, to]) {
    if (kindOf(id) === 'atom') own.add(id)
    else if (doc.bonds[id]) { own.add(doc.bonds[id].a1); own.add(doc.bonds[id].a2) }
  }
  const atoms = Object.values(doc.atoms).filter(a => !own.has(a.id))
  // the arrow's own labelled atoms (O of H2O, Br) still mustn't be crossed away from its two ends
  const ownLabels = [...own].map(id => doc.atoms[id]).filter(a => a && atomVisual(doc, a, adj).showLabel)
  const bonds = Object.values(doc.bonds).filter(b => b.id !== from && b.id !== to && doc.atoms[b.a1] && doc.atoms[b.a2])
  const curve = (bend: number) => curlyGeometry(doc, { id: '', from, to, half: false, bend }, adj)
  const cost = (bend: number) => {
    const g = curve(bend)
    if (!g) return Infinity
    let total = 0
    for (let i = 1; i < 12; i++) {
      const q = quadPoint(g.p0, g.ctrl, g.p1, i / 12)
      for (const a of atoms) { const d = dist(a, q); if (d < 26) total += (26 - d) ** 2 }
      for (const b of bonds) { const d = distToSeg(q, doc.atoms[b.a1], doc.atoms[b.a2]); if (d < 14) total += (14 - d) ** 2 }
      if (i > 1 && i < 11) for (const a of ownLabels) { const d = dist(a, q); if (d < 15) total += 4 * (15 - d) ** 2 }
    }
    return total
  }
  const a = cost(1), b = cost(-1)
  if (Math.abs(a - b) > 1) return b < a ? -1 : 1
  // Both sides equally clear: bow away from the middle of the molecule(s) the arrow belongs to.
  const comp = new Set<ID>()
  for (const id of own) for (const x of componentAtoms(doc, adj, id)) comp.add(x)
  let cx = 0, cy = 0
  for (const id of comp) { cx += doc.atoms[id].x; cy += doc.atoms[id].y }
  const centre = { x: cx / comp.size, y: cy / comp.size }
  const g1 = curve(1), g2 = curve(-1)
  if (!g1 || !g2) return 1
  return dist(g2.ctrl, centre) > dist(g1.ctrl, centre) ? -1 : 1
}

function componentAtoms(doc: Doc, adj: Adjacency, start: ID): ID[] {
  const seen = new Set<ID>([start]), stack = [start]
  while (stack.length) {
    const id = stack.pop()!
    for (const n of adj.get(id) ?? []) if (!seen.has(n.other) && doc.atoms[n.other]) { seen.add(n.other); stack.push(n.other) }
  }
  return [...seen]
}

/**
 * Nudge a text so it doesn't sit on a structure: if its box covers an atom label, lone pairs or a bond,
 * try nearby spots along the same line first, then above and below. Returns the new position.
 */
export function clearTextSpot(doc: Doc, t: TextItem, adj: Adjacency): P {
  const blocked = (x: number, y: number) => {
    const b = textBox({ ...t, x, y })
    const inBox = (p: P, pad: number) => p.x > b.x1 - pad && p.x < b.x2 + pad && p.y > b.y1 - pad && p.y < b.y2 + pad
    for (const a of Object.values(doc.atoms)) {
      const v = atomVisual(doc, a, adj)
      const pad = v.showLabel ? (a.lonePairs || a.charge ? 16 : 10) : 3
      if (inBox(a, pad)) return true
    }
    const centre = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }, half = Math.max(b.x2 - b.x1, b.y2 - b.y1) / 2
    for (const bd of Object.values(doc.bonds)) {
      const A = doc.atoms[bd.a1], B = doc.atoms[bd.a2]
      if (A && B && distToSeg(centre, A, B) < half + 3) return true
    }
    return false
  }
  if (!blocked(t.x, t.y)) return { x: t.x, y: t.y }
  for (let k = 1; k <= 12; k++) for (const dx of [-5 * k, 5 * k]) if (!blocked(t.x + dx, t.y)) return { x: t.x + dx, y: t.y }
  for (let k = 1; k <= 8; k++) for (const dy of [-6 * k, 6 * k]) if (!blocked(t.x, t.y + dy)) return { x: t.x, y: t.y + dy }
  return { x: t.x, y: t.y }
}

/** Width of a text label, allowing for its size and boldness. */
export function labelWidth(t: TextItem): number {
  return textWidth(t.text || ' ', t.size ?? FONT) * (t.bold ? 1.08 : 1)
}

export function textBox(t: TextItem) {
  const size = t.size ?? FONT
  return { x1: t.x - 2, y1: t.y - size, x2: t.x + Math.max(labelWidth(t), 10) + 2, y2: t.y + size * 0.35 }
}

export type Hit =
  | { kind: 'atom' | 'bond' | 'curly' | 'text' | 'bracket'; id: ID }
  | { kind: 'arrow'; id: ID; end?: 1 | 2 }

export function hitTest(doc: Doc, p: P, tol: number, adj: Adjacency): Hit | null {
  let best: Hit | null = null, bestD = tol * 1.3
  for (const a of Object.values(doc.atoms)) {
    const d = dist(a, p)
    if (d < bestD) { bestD = d; best = { kind: 'atom', id: a.id } }
  }
  if (best) return best
  bestD = tol
  for (const c of Object.values(doc.curlies)) {
    const g = curlyGeometry(doc, c, adj)
    if (!g) continue
    let prev = g.p0
    for (let i = 1; i <= 16; i++) {
      const q = quadPoint(g.p0, g.ctrl, g.p1, i / 16)
      const d = distToSeg(p, prev, q)
      if (d < bestD) { bestD = d; best = { kind: 'curly', id: c.id } }
      prev = q
    }
  }
  if (best) return best
  bestD = tol
  for (const b of Object.values(doc.bonds)) {
    const A = doc.atoms[b.a1], B = doc.atoms[b.a2]
    if (!A || !B) continue
    const d = distToSeg(p, A, B)
    if (d < bestD) { bestD = d; best = { kind: 'bond', id: b.id } }
  }
  if (best) return best
  for (const r of Object.values(doc.arrows)) {
    const p1 = { x: r.x1, y: r.y1 }, p2 = { x: r.x2, y: r.y2 }
    if (dist(p, p1) < tol * 1.2) return { kind: 'arrow', id: r.id, end: 1 }
    if (dist(p, p2) < tol * 1.2) return { kind: 'arrow', id: r.id, end: 2 }
    if (distToSeg(p, p1, p2) < tol) return { kind: 'arrow', id: r.id }
    const lab = arrowLabelPositions(r)
    for (const [txt, q] of [[r.above, lab.above], [r.below, lab.below]] as const) {
      if (txt && Math.abs(p.y - (q.y - 4)) < 9 && Math.abs(p.x - q.x) < textWidth(txt, 12) / 2 + 4) return { kind: 'arrow', id: r.id }
    }
  }
  for (const k of Object.values(doc.brackets ?? {})) {
    if (bracketHit(k, p, tol)) return { kind: 'bracket', id: k.id }
  }
  for (const t of Object.values(doc.texts)) {
    const b = textBox(t)
    if (p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2) return { kind: 'text', id: t.id }
  }
  return null
}

export function arrowLabelPositions(r: Arrow) {
  const m = mid({ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y2 })
  const dir = norm({ x: r.x2 - r.x1, y: r.y2 - r.y1 })
  if (Math.abs(dir.x) < 0.5) {
    return { above: { x: m.x + 10, y: m.y + 4 }, below: { x: m.x - 10, y: m.y + 4 }, anchor: ['start', 'end'] as const }
  }
  return { above: { x: m.x, y: m.y - 9 }, below: { x: m.x, y: m.y + 20 }, anchor: ['middle', 'middle'] as const }
}

/** Which side a double bond's inner line goes: 1 = left of a1→a2, -1 = right, 0 = centred. */
/** Rings (up to 8 atoms) that contain bond `b`: one shortest ring per neighbour of b.a1. */
function ringsThroughBond(adj: Adjacency, b: Bond, maxSize = 8): ID[][] {
  const rings: ID[][] = []
  for (const start of adj.get(b.a1) ?? []) {
    if (start.other === b.a2) continue
    // shortest path start → a2 that avoids a1
    const prev = new Map<ID, ID | null>([[start.other, null]])
    let frontier = [start.other]
    for (let depth = 2; depth < maxSize && frontier.length && !prev.has(b.a2); depth++) {
      const next: ID[] = []
      for (const cur of frontier) {
        for (const nb of adj.get(cur) ?? []) {
          if (nb.other === b.a1 || prev.has(nb.other)) continue
          prev.set(nb.other, cur)
          next.push(nb.other)
        }
      }
      frontier = next
    }
    if (!prev.has(b.a2)) continue
    const path: ID[] = []
    for (let cur: ID | null = b.a2; cur; cur = prev.get(cur) ?? null) path.push(cur)
    rings.push([b.a1, ...path.reverse()])
  }
  return rings
}

function bestRing(adj: Adjacency, b: Bond): ID[] | null {
  let best: ID[] | null = null, bestScore = -Infinity
  for (const ring of ringsThroughBond(adj, b)) {
    let doubles = 0
    for (let i = 0; i < ring.length; i++) {
      const x = ring[i], y = ring[(i + 1) % ring.length]
      const nb = (adj.get(x) ?? []).find(n => n.other === y)
      if (nb && nb.bond.order === 2) doubles++
    }
    const score = doubles * 10 - ring.length
    if (score > bestScore) { bestScore = score; best = ring }
  }
  return best
}

export function doubleBondSide(doc: Doc, b: Bond, adj: Adjacency, visA: AtomVisual, visB: AtomVisual): number {
  const A = doc.atoms[b.a1], B = doc.atoms[b.a2]
  const n = perp(norm(sub(B, A)))
  let left = 0, right = 0
  const nsA = (adj.get(A.id) ?? []).filter(x => x.other !== B.id)
  const nsB = (adj.get(B.id) ?? []).filter(x => x.other !== A.id)
  if ((nsA.length === 0 && visA.showLabel) || (nsB.length === 0 && visB.showLabel)) return 0
  // In a ring, the second line goes inside it. For a bond shared by two rings, prefer the ring
  // with more double bonds (so benzene's lines stay inside benzene), then the smaller ring.
  const ring = bestRing(adj, b)
  if (ring) {
    let c: P = { x: 0, y: 0 }
    for (const id of ring) c = add(c, doc.atoms[id])
    c = mul(c, 1 / ring.length)
    const s = (c.x - A.x) * n.x + (c.y - A.y) * n.y
    if (Math.abs(s) > 0.5) return s > 0 ? 1 : -1
  }
  for (const nb of [...nsA, ...nsB]) {
    const o = doc.atoms[nb.other]
    const s = (o.x - A.x) * n.x + (o.y - A.y) * n.y
    if (s > 0.5) left++
    else if (s < -0.5) right++
  }
  if (left > right) return 1
  if (right > left) return -1
  return 0
}

/** Width of a bracket's top/bottom ticks (or the bulge of a round bracket). */
export const bracketTick = (k: Bracket) => Math.min(10, Math.abs(k.y2 - k.y1) * 0.12 + 4)

/** Is p on the left or right side of a bracket (or its label)? */
export function bracketHit(k: Bracket, p: P, tol: number): boolean {
  const x1 = Math.min(k.x1, k.x2), x2 = Math.max(k.x1, k.x2), y1 = Math.min(k.y1, k.y2), y2 = Math.max(k.y1, k.y2)
  const tick = bracketTick(k)
  const inY = p.y >= y1 - tol && p.y <= y2 + tol
  if (inY && p.x >= x1 - tol && p.x <= x1 + tick + tol) return true
  if (inY && p.x >= x2 - tick - tol && p.x <= x2 + tol) return true
  return !!k.label && p.x >= x2 && p.x <= x2 + 16 && p.y >= y1 - 16 && p.y <= y1 + 4
}
