import { memo, type ReactNode } from 'react'
import type { Arrow, Atom, Bond, Bracket, Curly, Doc, ID, TextItem } from '../model/types'
import { add, mul, norm, perp, sub, type P } from '../model/geometry'
import { adjacency, chargeLabel, components, type Adjacency } from '../chem/chem'
import { elementColor } from '../chem/elements'
import { abbrevOf, labelRuns } from '../chem/abbrev'
import {
  FONT, arrowLabelPositions, atomVisual, bracketTick, chargeDir, curlyGeometry, doubleBondSide, electronDots, labelWidth, textWidth,
  type AtomVisual,
} from './layout'
import { STYLES, type DrawStyle } from './styles'

export interface Palette {
  ink: string
  bg: string
  select: string
  hover: string
  curly: string
  /** Colour for an element label, or undefined for the ink colour. */
  element: (symbol: string) => string | undefined
  /** Font for free text labels (themes may use a handwriting face on screen). */
  notesFont?: string
  live: boolean
}

/** On screen: colours come from the theme's CSS variables. */
export const LIVE: Palette = {
  ink: 'var(--ink)', bg: 'var(--canvas)', select: 'var(--select)', hover: 'var(--hover)', curly: 'var(--curly)',
  element: s => { const c = elementColor(s); return c ? `var(--el-${s}, ${c})` : undefined },
  notesFont: 'var(--font-notes)',
  live: true,
}
/** In exports: fixed publication colours, whatever the screen theme. */
export const PRINT: Palette = {
  ink: '#1b1b1b', bg: '#ffffff', select: 'none', hover: 'none', curly: '#d0482a', element: elementColor, live: false,
}

interface Props {
  doc: Doc
  palette: Palette
  style?: DrawStyle
  /** Items to glow briefly (Claude's latest edits). `flashKey` restarts the glow. */
  flash?: Set<ID>
  flashKey?: number
}

const pts = (...ps: P[]) => ps.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

/**
 * The whole drawing. Each molecule, arrow, text and bracket is its own memoised piece, so an edit
 * re-renders only what it touched: the store keeps unchanged items as the same objects (see store.ts).
 * A molecule's look depends only on its own atoms and bonds, which is what makes that safe.
 */
export function Scene({ doc, palette: pal, style = STYLES[0], flash, flashKey = 0 }: Props) {
  const adj = adjacency(doc)
  const st = style
  const fl = (id: ID) => (flash?.has(id) ? flashKey : 0)
  const mols = components(doc, adj).map(ids => {
    const atoms = ids.map(id => doc.atoms[id])
    const bonds: Bond[] = []
    for (const id of ids) for (const n of adj.get(id) ?? []) if (n.bond.a1 === id) bonds.push(n.bond)
    const fk = flash && flashKey && (ids.some(id => flash.has(id)) || bonds.some(b => flash.has(b.id))) ? flashKey : 0
    return { key: ids.reduce((m, id) => (id < m ? id : m)), atoms, bonds, fk }
  })

  return (
    <g style={{ fontFamily: st.fontFamily }}>
      {Object.values(doc.brackets ?? {}).map(k => <BracketView key={k.id} k={k} pal={pal} st={st} fl={fl(k.id)} />)}
      {mols.map(m => <MolView key={m.key} atoms={m.atoms} bonds={m.bonds} doc={doc} adj={adj} pal={pal} st={st} fk={m.fk} flash={flash} />)}
      {Object.values(doc.arrows).map(r => <ArrowView key={r.id} r={r} pal={pal} st={st} fl={fl(r.id)} />)}
      {Object.values(doc.curlies).map(c => (
        <CurlyView key={c.id} c={c} doc={doc} adj={adj} pal={pal} scale={st.font / FONT} fl={fl(c.id)} />
      ))}
      {Object.values(doc.texts).map(t => <TextView key={t.id} t={t} pal={pal} fl={fl(t.id)} />)}
    </g>
  )
}

interface MolProps { atoms: Atom[]; bonds: Bond[]; doc: Doc; adj: Adjacency; pal: Palette; st: DrawStyle; fk: number; flash?: Set<ID> }

/** One molecule: its bonds, then its atoms on top. */
const MolView = memo(function MolView({ atoms, bonds, doc, adj, pal, st, fk, flash }: MolProps) {
  const scale = st.font / FONT
  const vis = new Map<ID, AtomVisual>()
  for (const a of atoms) vis.set(a.id, atomVisual(doc, a, adj, st.font, st.margin))
  const fl = (id: ID) => (fk && flash?.has(id) ? fk : 0)
  return (
    <>
      {bonds.map(b => <BondView key={b.id} b={b} doc={doc} adj={adj} vis={vis} pal={pal} st={st} fl={fl(b.id)} />)}
      {atoms.map(a => <AtomView key={a.id} a={a} doc={doc} adj={adj} v={vis.get(a.id)!} pal={pal} st={st} scale={scale} fl={fl(a.id)} />)}
    </>
  )
}, (p, n) => p.pal === n.pal && p.st === n.st && p.fk === n.fk && same(p.atoms, n.atoms) && same(p.bonds, n.bonds))

const same = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The drawing, re-rendered only when the document, style or flash changes: not on every mouse
 * move. Hover and selection glows are drawn separately by <Highlights> underneath it.
 */
export const MemoScene = memo(Scene)

/** Selection and hover glows, drawn behind the scene. Cheap: only the highlighted items are visited. */
export function Highlights({ doc, selected, hover, palette: pal, style = STYLES[0] }: {
  doc: Doc; selected: ID[]; hover: ID | null; palette: Palette; style?: DrawStyle
}) {
  const ids = hover && !selected.includes(hover) ? [...selected, hover] : selected
  if (!ids.length) return null
  const scale = style.font / FONT
  let adj: Adjacency | null = null
  const getAdj = () => (adj ??= adjacency(doc))
  const out: ReactNode[] = []
  for (const id of ids) {
    const fill = id === hover && !selected.includes(id) ? pal.hover : pal.select
    const kind = id[0]
    if (kind === 'a' && doc.atoms[id]) {
      const a = doc.atoms[id]
      const v = atomVisual(doc, a, getAdj(), style.font, style.margin)
      out.push(<circle key={id} cx={a.x} cy={a.y} r={v.showLabel ? 12 * scale : 6} fill={fill} />)
    } else if (kind === 'b' && doc.bonds[id]) {
      const A = doc.atoms[doc.bonds[id].a1], B = doc.atoms[doc.bonds[id].a2]
      if (A && B) out.push(<line key={id} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={fill} strokeWidth={12} strokeLinecap="round" />)
    } else if (kind === 'r' && doc.arrows[id]) {
      const r = doc.arrows[id]
      out.push(<line key={id} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke={fill} strokeWidth={14} strokeLinecap="round" />)
    } else if (kind === 'c' && doc.curlies[id]) {
      const g = curlyGeometry(doc, doc.curlies[id], getAdj(), scale)
      if (g) out.push(<path key={id} d={`M ${g.p0.x} ${g.p0.y} Q ${g.ctrl.x} ${g.ctrl.y} ${g.p1.x} ${g.p1.y}`} stroke={fill} strokeWidth={10} fill="none" strokeLinecap="round" />)
    } else if (kind === 'k' && doc.brackets?.[id]) {
      const k = doc.brackets[id]
      const x1 = Math.min(k.x1, k.x2), x2 = Math.max(k.x1, k.x2), y1 = Math.min(k.y1, k.y2), y2 = Math.max(k.y1, k.y2)
      out.push(<rect key={id} x={x1 - 4} y={y1 - 4} width={x2 - x1 + 8} height={y2 - y1 + 8} rx={6} fill={fill} />)
    } else if (kind === 't' && doc.texts[id]) {
      const tx = doc.texts[id]
      const size = tx.size ?? FONT
      out.push(<rect key={id} x={tx.x - 3} y={tx.y - size} width={labelWidth(tx) + 6} height={size * 1.4} rx={3} fill={fill} />)
    }
  }
  return <g pointerEvents="none">{out}</g>
}

/** A soft glow that fades out; keyed so a new flash restarts it. */
function Flash({ k, children }: { k: number; children: ReactNode }) {
  if (!k) return null
  return <g key={k} className="flash-halo" pointerEvents="none">{children}</g>
}

function BondView({ b, doc, adj, vis, pal, st, fl }: {
  b: Bond; doc: Doc; adj: Adjacency; vis: Map<ID, AtomVisual>; pal: Palette; st: DrawStyle; fl: number
}) {
  const A = doc.atoms[b.a1], B = doc.atoms[b.a2]
  if (!A || !B) return null
  const vA = vis.get(A.id)!, vB = vis.get(B.id)!
  const dir = norm(sub(B, A))
  const n = perp(dir)
  const p1 = add(A, mul(dir, vA.trim)), p2 = sub(B, mul(dir, vB.trim))
  const line = (a: P, c: P, key: string | number, w = st.line) => (
    <line key={key} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke={pal.ink} strokeWidth={w} strokeLinecap="round" />
  )
  const parts: ReactNode[] = []
  const half = st.wedge / 2
  if (b.stereo === 'wedge') {
    parts.push(<polygon key="w" points={pts(p1, add(p2, mul(n, half)), sub(p2, mul(n, half)))} fill={pal.ink} />)
  } else if (b.stereo === 'dash') {
    const L = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const count = Math.max(4, Math.round(L / st.hash) + 1)
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1)
      const q = add(p1, mul(sub(p2, p1), t))
      const w = 0.6 + (half - 0.6) * t
      parts.push(line(add(q, mul(n, w)), sub(q, mul(n, w)), i, st.line * 0.85))
    }
  } else if (b.order === 1) {
    parts.push(line(p1, p2, 0))
  } else if (b.order === 2) {
    const side = doubleBondSide(doc, b, adj, vA, vB)
    if (side === 0) {
      parts.push(line(add(p1, mul(n, st.double / 2)), add(p2, mul(n, st.double / 2)), 0))
      parts.push(line(sub(p1, mul(n, st.double / 2)), sub(p2, mul(n, st.double / 2)), 1))
    } else {
      const off = mul(n, st.double * side)
      const s1 = vA.showLabel ? 0 : st.double, s2 = vB.showLabel ? 0 : st.double
      parts.push(line(p1, p2, 0))
      parts.push(line(add(add(p1, off), mul(dir, s1)), sub(add(p2, off), mul(dir, s2)), 1))
    }
  } else {
    const o = st.double * 0.75
    parts.push(line(p1, p2, 0))
    parts.push(line(add(p1, mul(n, o)), add(p2, mul(n, o)), 1))
    parts.push(line(sub(p1, mul(n, o)), sub(p2, mul(n, o)), 2))
  }
  return (
    <g>
      <Flash k={fl}><line x1={A.x} y1={A.y} x2={B.x} y2={B.y} strokeWidth={14} strokeLinecap="round" /></Flash>
      {parts}
    </g>
  )
}

function AtomView({ a, doc, adj, v, pal, st, scale, fl }: {
  a: Atom; doc: Doc; adj: Adjacency; v: AtomVisual; pal: Palette; st: DrawStyle; scale: number; fl: number
}) {
  const font = st.font
  const ab = abbrevOf(a.element)
  const color = ab ? pal.ink : pal.element(a.element) ?? pal.ink
  const charge = chargeLabel(a.charge)
  const dots = electronDots(doc, a, adj, v, scale)
  const by = a.y + font * 0.36
  const textProps = { fontSize: font, fill: color, fontWeight: st.fontWeight }

  let label: ReactNode = null
  let rightEdge = a.x, leftEdge = a.x // where a charge goes
  if (v.showLabel && ab) {
    // Group label: the first letter sits on the atom; it reads away from the bond.
    const reversed = v.hSide === 'left'
    const text = reversed && ab.left ? ab.left : ab.label
    const runs = labelRuns(text)
    const firstW = textWidth(reversed ? text.slice(-1) : text[0], font)
    const x = reversed ? a.x + firstW / 2 : a.x - firstW / 2
    label = (
      <text x={x} y={by} textAnchor={reversed ? 'end' : 'start'} {...textProps}>
        {runs.map((r, i) => r.sub
          ? <tspan key={i} fontSize={font * 0.72} dy={font * 0.28}>{r.text}</tspan>
          : <tspan key={i} dy={i > 0 && runs[i - 1].sub ? -font * 0.28 : 0}>{r.text}</tspan>)}
      </text>
    )
    rightEdge = reversed ? a.x + firstW / 2 : x + textWidth(text, font)
    leftEdge = reversed ? a.x + firstW / 2 - textWidth(text, font) : x
  } else if (v.showLabel) {
    const w = textWidth(a.element, font)
    const hText = v.h > 0 ? 'H' : ''
    const hSub = v.h > 1 ? String(v.h) : ''
    const hWidth = hText ? textWidth('H', font) + (hSub ? textWidth(hSub, font * 0.72) : 0) : 0
    label = (
      <>
        <text x={a.x} y={by} textAnchor="middle" {...textProps}>{a.element}</text>
        {hText && (
          <text
            x={v.hSide === 'right' ? a.x + w / 2 + 0.5 * scale : a.x - w / 2 - 0.5 * scale}
            y={by}
            textAnchor={v.hSide === 'right' ? 'start' : 'end'}
            {...textProps}
          >
            H{hSub && <tspan fontSize={font * 0.72} dy={font * 0.28}>{hSub}</tspan>}
          </text>
        )}
      </>
    )
    rightEdge = a.x + w / 2 + (v.hSide === 'right' ? hWidth : 0)
    leftEdge = a.x - w / 2 - (v.hSide === 'left' ? hWidth : 0)
  }
  const corner = charge ? chargeDir(doc, a, adj, v) : null
  return (
    <g>
      <Flash k={fl}><circle cx={a.x} cy={a.y} r={v.showLabel ? 14 * scale : 9} /></Flash>
      {label}
      {charge && corner && (() => {
        const gap = 1.5 * scale // lone pairs keep out of the charge's corner, so it can sit right by the label
        const x = corner.x === 0 ? a.x
          : v.showLabel ? (corner.x > 0 ? rightEdge + gap : leftEdge - gap) : a.x + corner.x * 6
        const y = corner.y < 0
          ? (v.showLabel ? a.y - (corner.x === 0 ? 11 : 6) * scale : a.y - 6)
          : corner.y > 0 ? (v.showLabel ? a.y + (corner.x === 0 ? 19 : 14) * scale : a.y + 13)
          : a.y + 4 * scale
        return <text x={x} y={y} textAnchor={corner.x > 0 ? 'start' : corner.x < 0 ? 'end' : 'middle'} fontSize={11 * scale} fill={pal.ink}>{charge}</text>
      })()}
      {dots.pairs.map((pair, i) => pair.map((p, j) => <circle key={`${i}-${j}`} cx={p.x} cy={p.y} r={1.6 * Math.max(1, scale * 0.8)} fill={pal.ink} />))}
      {dots.radical && <circle cx={dots.radical.x} cy={dots.radical.y} r={2 * Math.max(1, scale * 0.8)} fill={pal.ink} />}
    </g>
  )
}

function head(tip: P, dir: P, length = 10, width = 4): string {
  const back = sub(tip, mul(dir, length))
  const n = perp(dir)
  return pts(tip, add(back, mul(n, width)), sub(back, mul(n, width)))
}

function halfHead(tip: P, dir: P, side: P, length = 10, width = 4.5): string {
  return pts(tip, add(sub(tip, mul(dir, length)), mul(side, width)), sub(tip, mul(dir, length * 0.7)))
}

const ArrowView = memo(function ArrowView({ r, pal, st, fl }: { r: Arrow; pal: Palette; st: DrawStyle; fl: number }) {
  const p1 = { x: r.x1, y: r.y1 }, p2 = { x: r.x2, y: r.y2 }
  const dir = norm(sub(p2, p1))
  const n = perp(dir)
  const stroke = { stroke: pal.ink, strokeWidth: st.line, strokeLinecap: 'round' as const }
  const hs = Math.max(1, st.line / 1.6) // heads grow with heavier lines
  const parts: ReactNode[] = []
  if (r.kind === 'forward' || r.kind === 'resonance') {
    const s = r.kind === 'resonance' ? add(p1, mul(dir, 8 * hs)) : p1
    parts.push(<line key="l" x1={s.x} y1={s.y} x2={p2.x - dir.x * 8 * hs} y2={p2.y - dir.y * 8 * hs} {...stroke} />)
    parts.push(<polygon key="h" points={head(p2, dir, 10 * hs, 4 * hs)} fill={pal.ink} />)
    if (r.kind === 'resonance') parts.push(<polygon key="h2" points={head(p1, mul(dir, -1), 10 * hs, 4 * hs)} fill={pal.ink} />)
  } else if (r.kind === 'equilibrium') {
    const o = mul(n, 3 * hs)
    const a1 = add(p1, o), a2 = add(p2, o), b1 = sub(p1, o), b2 = sub(p2, o)
    parts.push(<line key="t" x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} {...stroke} />)
    parts.push(<polygon key="th" points={halfHead(a2, dir, n, 10 * hs, 4.5 * hs)} fill={pal.ink} />)
    parts.push(<line key="b" x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} {...stroke} />)
    parts.push(<polygon key="bh" points={halfHead(b1, mul(dir, -1), mul(n, -1), 10 * hs, 4.5 * hs)} fill={pal.ink} />)
  } else {
    const end = sub(p2, mul(dir, 5))
    for (const s of [1, -1]) {
      const o = mul(n, 3 * s * hs)
      parts.push(<line key={`l${s}`} x1={p1.x + o.x} y1={p1.y + o.y} x2={end.x + o.x} y2={end.y + o.y} {...stroke} />)
    }
    const back = sub(p2, mul(dir, 10 * hs))
    parts.push(<polyline key="c" points={pts(add(back, mul(n, 8 * hs)), p2, sub(back, mul(n, 8 * hs)))} fill="none" {...stroke} />)
  }
  const lab = arrowLabelPositions(r)
  const fs = Math.max(12, st.font * 0.86)
  return (
    <g>
      <Flash k={fl}><line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} strokeWidth={14} strokeLinecap="round" /></Flash>
      {parts}
      {r.above && <text x={lab.above.x} y={lab.above.y} textAnchor={lab.anchor[0]} fontSize={fs} fill={pal.ink}>{r.above}</text>}
      {r.below && <text x={lab.below.x} y={lab.below.y + (fs - 12)} textAnchor={lab.anchor[1]} fontSize={fs} fill={pal.ink}>{r.below}</text>}
    </g>
  )
})

function CurlyView({ c, doc, adj, pal, scale, fl }: { c: Curly; doc: Doc; adj: Adjacency; pal: Palette; scale: number; fl: number }) {
  const g = curlyGeometry(doc, c, adj, scale)
  if (!g) return null
  const dir = norm(sub(g.p1, g.ctrl))
  const tipBack = sub(g.p1, mul(dir, 6))
  const d = `M ${g.p0.x} ${g.p0.y} Q ${g.ctrl.x} ${g.ctrl.y} ${tipBack.x} ${tipBack.y}`
  const chordMid = { x: (g.p0.x + g.p1.x) / 2, y: (g.p0.y + g.p1.y) / 2 }
  let side = perp(dir)
  if ((g.ctrl.x - chordMid.x) * side.x + (g.ctrl.y - chordMid.y) * side.y < 0) side = mul(side, -1)
  return (
    <g>
      <Flash k={fl}><path d={d} strokeWidth={12} fill="none" strokeLinecap="round" /></Flash>
      <path d={d} stroke={pal.curly} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <polygon points={c.half ? halfHead(g.p1, dir, side, 10, 5) : head(g.p1, dir, 9, 4)} fill={pal.curly} />
    </g>
  )
}

const BracketView = memo(function BracketView({ k, pal, st, fl }: { k: Bracket; pal: Palette; st: DrawStyle; fl: number }) {
  const x1 = Math.min(k.x1, k.x2), x2 = Math.max(k.x1, k.x2), y1 = Math.min(k.y1, k.y2), y2 = Math.max(k.y1, k.y2)
  const t = bracketTick(k)
  const stroke = { stroke: pal.ink, strokeWidth: st.line, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const left = k.shape === 'round'
    ? <path d={`M ${x1 + t} ${y1} Q ${x1 - t * 0.6} ${(y1 + y2) / 2} ${x1 + t} ${y2}`} {...stroke} />
    : <polyline points={pts({ x: x1 + t, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y2 }, { x: x1 + t, y: y2 })} {...stroke} />
  const right = k.shape === 'round'
    ? <path d={`M ${x2 - t} ${y1} Q ${x2 + t * 0.6} ${(y1 + y2) / 2} ${x2 - t} ${y2}`} {...stroke} />
    : <polyline points={pts({ x: x2 - t, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x2 - t, y: y2 })} {...stroke} />
  return (
    <g>
      <Flash k={fl}><rect x={x1 - 4} y={y1 - 4} width={x2 - x1 + 8} height={y2 - y1 + 8} rx={6} /></Flash>
      {left}{right}
      {k.label && <text x={x2 + 3} y={y1 + 4} fontSize={Math.max(14, st.font)} fill={pal.ink}>{k.label}</text>}
    </g>
  )
})

const TextView = memo(function TextView({ t, pal, fl }: { t: TextItem; pal: Palette; fl: number }) {
  const w = labelWidth(t)
  const size = t.size ?? FONT
  return (
    <g>
      <Flash k={fl}><rect x={t.x - 3} y={t.y - size} width={w + 6} height={size * 1.4} rx={3} /></Flash>
      <text
        x={t.x} y={t.y} fontSize={size} fill={t.color || pal.ink}
        fontWeight={t.bold ? 700 : undefined} fontStyle={t.italic ? 'italic' : undefined}
        style={{ whiteSpace: 'pre', fontFamily: pal.notesFont }}
      >{t.text}</text>
    </g>
  )
})
