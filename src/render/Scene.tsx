import type { ReactNode } from 'react'
import type { Arrow, Atom, Bond, Curly, Doc, ID, TextItem } from '../model/types'
import { add, mul, norm, perp, sub, type P } from '../model/geometry'
import { adjacency, chargeLabel, type Adjacency } from '../chem/chem'
import { elementColor } from '../chem/elements'
import {
  FONT, arrowLabelPositions, atomVisual, curlyGeometry, doubleBondSide, electronDots, labelWidth, textWidth,
  type AtomVisual,
} from './layout'

export interface Palette { ink: string; bg: string; select: string; hover: string; curly: string }

export const LIVE: Palette = {
  ink: 'var(--ink)', bg: 'var(--canvas)', select: 'var(--select)', hover: 'var(--hover)', curly: 'var(--curly)',
}
export const PRINT: Palette = { ink: '#1b1b1b', bg: '#ffffff', select: 'none', hover: 'none', curly: '#d0482a' }

interface Props {
  doc: Doc
  palette: Palette
  selected?: Set<ID>
  hover?: ID | null
}

const pts = (...ps: P[]) => ps.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

export function Scene({ doc, palette: pal, selected, hover }: Props) {
  const adj = adjacency(doc)
  const vis = new Map<ID, AtomVisual>()
  for (const a of Object.values(doc.atoms)) vis.set(a.id, atomVisual(doc, a, adj))
  const sel = selected ?? new Set<ID>()
  const highlight = (id: ID) => (sel.has(id) ? pal.select : hover === id ? pal.hover : null)

  return (
    <g fontFamily="Inter, 'Segoe UI', Arial, sans-serif">
      {Object.values(doc.bonds).map(b => (
        <BondView key={b.id} b={b} doc={doc} adj={adj} vis={vis} pal={pal} hl={highlight(b.id)} />
      ))}
      {Object.values(doc.atoms).map(a => (
        <AtomView key={a.id} a={a} doc={doc} adj={adj} v={vis.get(a.id)!} pal={pal} hl={highlight(a.id)} />
      ))}
      {Object.values(doc.arrows).map(r => <ArrowView key={r.id} r={r} pal={pal} hl={highlight(r.id)} />)}
      {Object.values(doc.curlies).map(c => (
        <CurlyView key={c.id} c={c} doc={doc} adj={adj} pal={pal} hl={highlight(c.id)} />
      ))}
      {Object.values(doc.texts).map(t => <TextView key={t.id} t={t} pal={pal} hl={highlight(t.id)} />)}
    </g>
  )
}

function BondView({ b, doc, adj, vis, pal, hl }: {
  b: Bond; doc: Doc; adj: Adjacency; vis: Map<ID, AtomVisual>; pal: Palette; hl: string | null
}) {
  const A = doc.atoms[b.a1], B = doc.atoms[b.a2]
  if (!A || !B) return null
  const vA = vis.get(A.id)!, vB = vis.get(B.id)!
  const dir = norm(sub(B, A))
  const n = perp(dir)
  const p1 = add(A, mul(dir, vA.trim)), p2 = sub(B, mul(dir, vB.trim))
  const line = (a: P, c: P, key: string | number) => (
    <line key={key} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke={pal.ink} strokeWidth={1.6} strokeLinecap="round" />
  )
  const parts: ReactNode[] = []
  if (b.stereo === 'wedge') {
    parts.push(<polygon key="w" points={pts(p1, add(p2, mul(n, 3.8)), sub(p2, mul(n, 3.8)))} fill={pal.ink} />)
  } else if (b.stereo === 'dash') {
    const count = 7
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1)
      const q = add(p1, mul(sub(p2, p1), t))
      const w = 0.6 + 3.4 * t
      parts.push(line(add(q, mul(n, w)), sub(q, mul(n, w)), i))
    }
  } else if (b.order === 1) {
    parts.push(line(p1, p2, 0))
  } else if (b.order === 2) {
    const side = doubleBondSide(doc, b, adj, vA, vB)
    if (side === 0) {
      parts.push(line(add(p1, mul(n, 2.8)), add(p2, mul(n, 2.8)), 0))
      parts.push(line(sub(p1, mul(n, 2.8)), sub(p2, mul(n, 2.8)), 1))
    } else {
      const off = mul(n, 6 * side)
      const s1 = vA.showLabel ? 0 : 6, s2 = vB.showLabel ? 0 : 6
      parts.push(line(p1, p2, 0))
      parts.push(line(add(add(p1, off), mul(dir, s1)), sub(add(p2, off), mul(dir, s2)), 1))
    }
  } else {
    parts.push(line(p1, p2, 0))
    parts.push(line(add(p1, mul(n, 4.5)), add(p2, mul(n, 4.5)), 1))
    parts.push(line(sub(p1, mul(n, 4.5)), sub(p2, mul(n, 4.5)), 2))
  }
  return (
    <g>
      {hl && <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={hl} strokeWidth={12} strokeLinecap="round" />}
      {parts}
    </g>
  )
}

function AtomView({ a, doc, adj, v, pal, hl }: {
  a: Atom; doc: Doc; adj: Adjacency; v: AtomVisual; pal: Palette; hl: string | null
}) {
  const color = elementColor(a.element) ?? pal.ink
  const w = textWidth(a.element)
  const charge = chargeLabel(a.charge)
  const dots = electronDots(doc, a, adj, v)
  const hText = v.h > 0 ? 'H' : ''
  const hSub = v.h > 1 ? String(v.h) : ''
  const hWidth = hText ? textWidth('H') + (hSub ? textWidth(hSub, 10) : 0) : 0
  const by = a.y + FONT * 0.36
  return (
    <g>
      {hl && <circle cx={a.x} cy={a.y} r={v.showLabel ? 12 : 6} fill={hl} />}
      {v.showLabel && (
        <>
          <text x={a.x} y={by} textAnchor="middle" fontSize={FONT} fill={color}>{a.element}</text>
          {hText && (
            <text
              x={v.hSide === 'right' ? a.x + w / 2 + 0.5 : a.x - w / 2 - 0.5}
              y={by}
              textAnchor={v.hSide === 'right' ? 'start' : 'end'}
              fontSize={FONT}
              fill={color}
            >
              H{hSub && <tspan fontSize={10} dy={4}>{hSub}</tspan>}
            </text>
          )}
        </>
      )}
      {charge && (
        <text
          x={v.showLabel ? a.x + w / 2 + (v.hSide === 'right' ? hWidth : 0) + (dots.pairs.length ? 5 : 1.5) : a.x + 6}
          y={v.showLabel ? a.y - (dots.pairs.length ? 9 : 6) : a.y - 6}
          fontSize={11}
          fill={pal.ink}
        >{charge}</text>
      )}
      {dots.pairs.map((pair, i) => pair.map((p, j) => <circle key={`${i}-${j}`} cx={p.x} cy={p.y} r={1.6} fill={pal.ink} />))}
      {dots.radical && <circle cx={dots.radical.x} cy={dots.radical.y} r={2} fill={pal.ink} />}
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

function ArrowView({ r, pal, hl }: { r: Arrow; pal: Palette; hl: string | null }) {
  const p1 = { x: r.x1, y: r.y1 }, p2 = { x: r.x2, y: r.y2 }
  const dir = norm(sub(p2, p1))
  const n = perp(dir)
  const stroke = { stroke: pal.ink, strokeWidth: 1.6, strokeLinecap: 'round' as const }
  const parts: ReactNode[] = []
  if (r.kind === 'forward' || r.kind === 'resonance') {
    const s = r.kind === 'resonance' ? add(p1, mul(dir, 8)) : p1
    parts.push(<line key="l" x1={s.x} y1={s.y} x2={p2.x - dir.x * 8} y2={p2.y - dir.y * 8} {...stroke} />)
    parts.push(<polygon key="h" points={head(p2, dir)} fill={pal.ink} />)
    if (r.kind === 'resonance') parts.push(<polygon key="h2" points={head(p1, mul(dir, -1))} fill={pal.ink} />)
  } else if (r.kind === 'equilibrium') {
    const o = mul(n, 3)
    const a1 = add(p1, o), a2 = add(p2, o), b1 = sub(p1, o), b2 = sub(p2, o)
    parts.push(<line key="t" x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} {...stroke} />)
    parts.push(<polygon key="th" points={halfHead(a2, dir, n)} fill={pal.ink} />)
    parts.push(<line key="b" x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} {...stroke} />)
    parts.push(<polygon key="bh" points={halfHead(b1, mul(dir, -1), mul(n, -1))} fill={pal.ink} />)
  } else {
    const end = sub(p2, mul(dir, 5))
    for (const s of [1, -1]) {
      const o = mul(n, 3 * s)
      parts.push(<line key={`l${s}`} x1={p1.x + o.x} y1={p1.y + o.y} x2={end.x + o.x} y2={end.y + o.y} {...stroke} />)
    }
    const back = sub(p2, mul(dir, 10))
    parts.push(<polyline key="c" points={pts(add(back, mul(n, 8)), p2, sub(back, mul(n, 8)))} fill="none" {...stroke} />)
  }
  const lab = arrowLabelPositions(r)
  return (
    <g>
      {hl && <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={hl} strokeWidth={14} strokeLinecap="round" />}
      {parts}
      {r.above && <text x={lab.above.x} y={lab.above.y} textAnchor={lab.anchor[0]} fontSize={12} fill={pal.ink}>{r.above}</text>}
      {r.below && <text x={lab.below.x} y={lab.below.y} textAnchor={lab.anchor[1]} fontSize={12} fill={pal.ink}>{r.below}</text>}
    </g>
  )
}

function CurlyView({ c, doc, adj, pal, hl }: { c: Curly; doc: Doc; adj: Adjacency; pal: Palette; hl: string | null }) {
  const g = curlyGeometry(doc, c, adj)
  if (!g) return null
  const dir = norm(sub(g.p1, g.ctrl))
  const tipBack = sub(g.p1, mul(dir, 6))
  const d = `M ${g.p0.x} ${g.p0.y} Q ${g.ctrl.x} ${g.ctrl.y} ${tipBack.x} ${tipBack.y}`
  const chordMid = { x: (g.p0.x + g.p1.x) / 2, y: (g.p0.y + g.p1.y) / 2 }
  let side = perp(dir)
  if ((g.ctrl.x - chordMid.x) * side.x + (g.ctrl.y - chordMid.y) * side.y < 0) side = mul(side, -1)
  return (
    <g>
      {hl && <path d={d} stroke={hl} strokeWidth={10} fill="none" strokeLinecap="round" />}
      <path d={d} stroke={pal.curly} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <polygon points={c.half ? halfHead(g.p1, dir, side, 10, 5) : head(g.p1, dir, 9, 4)} fill={pal.curly} />
    </g>
  )
}

function TextView({ t, pal, hl }: { t: TextItem; pal: Palette; hl: string | null }) {
  const w = labelWidth(t)
  const size = t.size ?? FONT
  return (
    <g>
      {hl && <rect x={t.x - 3} y={t.y - size} width={w + 6} height={size * 1.4} rx={3} fill={hl} />}
      <text
        x={t.x} y={t.y} fontSize={size} fill={t.color || pal.ink}
        fontWeight={t.bold ? 700 : undefined} fontStyle={t.italic ? 'italic' : undefined}
        style={{ whiteSpace: 'pre' }}
      >{t.text}</text>
    </g>
  )
}
