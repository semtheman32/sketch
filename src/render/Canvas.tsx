import { useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { Doc, ID } from '../model/types'
import { kindOf } from '../model/types'
import { BOND, add, angleOf, dist, fromAngle, inRect, len, mid, mul, norm, perp, sub, type P, type Rect } from '../model/geometry'
import { commit, finishLive, getDoc, newId, setLive, useDoc } from '../model/store'
import {
  addAtom, addBond, addRing, applyBondStyle, atomNear, bondBetween, growBond, moveItems, removeItems,
} from '../model/ops'
import { adjacency, components } from '../chem/chem'
import { anchorPoint, hitTest, type Hit } from './layout'
import { LIVE, Scene } from './Scene'
import type { Tool, ToolOptions } from '../ui/tools'

export interface View { x: number; y: number; k: number }

export type EditTarget =
  | { kind: 'text' | 'arrow' | 'atom'; id: ID }
  | { kind: 'newText'; x: number; y: number }

interface Props {
  tool: Tool
  opts: ToolOptions
  view: View
  setView: (v: View | ((v: View) => View)) => void
  selection: ID[]
  setSelection: (ids: ID[]) => void
  hover: ID | null
  setHover: (id: ID | null) => void
  onEdit: (t: EditTarget) => void
  spaceDown: boolean
}

type Mode =
  | { m: 'none' }
  | { m: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { m: 'move'; base: Doc; ids: ID[]; start: P; moved: boolean }
  | { m: 'arrowEnd'; base: Doc; id: ID; end: 1 | 2 }
  | { m: 'bend'; base: Doc; id: ID }
  | { m: 'marquee'; start: P; add: boolean }
  | { m: 'bond'; from: ID | null; start: P; sx: number; sy: number; chain: P[]; dirs: number[] }
  | { m: 'arrow'; start: P }
  | { m: 'curly'; from: ID; sx: number; sy: number }
  | { m: 'erase'; base: Doc }
  | { m: 'text'; target: EditTarget }

const SNAP = Math.PI / 6

export function Canvas(p: Props) {
  const doc = useDoc()
  const svgRef = useRef<SVGSVGElement>(null)
  const mode = useRef<Mode>({ m: 'none' })
  const [pointer, setPointer] = useState<P | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [curlyFrom, setCurlyFrom] = useState<ID | null>(null)
  const [, force] = useState(0)

  useEffect(() => { if (p.tool !== 'curly') setCurlyFrom(null) }, [p.tool])

  // Wheel zoom around the cursor (non-passive so the page doesn't scroll).
  const viewRef = useRef(p.view)
  viewRef.current = p.view
  useEffect(() => {
    const el = svgRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      if (e.ctrlKey || !e.shiftKey) {
        p.setView(v => {
          const k = Math.min(5, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.0015)))
          return { k, x: sx - ((sx - v.x) / v.k) * k, y: sy - ((sy - v.y) / v.k) * k }
        })
      } else {
        p.setView(v => ({ ...v, x: v.x - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [p.setView])

  const toWorld = (e: { clientX: number; clientY: number }): P => {
    const r = svgRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k }
  }
  const tol = () => 8 / viewRef.current.k

  const hitAt = (w: P): Hit | null => {
    const d = getDoc()
    return hitTest(d, w, tol(), adjacency(d))
  }

  /** Atoms and bonds of every molecule touched by `ids`. */
  const expandMolecules = (d: Doc, ids: ID[]): ID[] => {
    const atoms = new Set<ID>()
    for (const id of ids) {
      if (kindOf(id) === 'atom') atoms.add(id)
      if (kindOf(id) === 'bond' && d.bonds[id]) { atoms.add(d.bonds[id].a1); atoms.add(d.bonds[id].a2) }
    }
    const out = new Set(ids)
    for (const comp of components(d)) {
      if (comp.some(a => atoms.has(a))) comp.forEach(a => out.add(a))
    }
    for (const b of Object.values(d.bonds)) if (out.has(b.a1) && out.has(b.a2)) out.add(b.id)
    return [...out]
  }

  const snapEnd = (from: P, w: P, fromAtom: ID | null): { p: P; atom: ID | null } => {
    const d = getDoc()
    const over = atomNear(d, w, tol() * 1.5, fromAtom ?? undefined)
    if (over) return { p: d.atoms[over], atom: over }
    const ang = Math.round(angleOf(sub(w, from)) / SNAP) * SNAP
    const end = add(from, mul(fromAngle(ang), BOND))
    const existing = atomNear(d, end, BOND * 0.2, fromAtom ?? undefined)
    return existing ? { p: d.atoms[existing], atom: existing } : { p: end, atom: null }
  }

  /**
   * Drag-to-draw chain: grows a zigzag skeleton that follows the pointer.
   * Each new bond turns ±60° from the previous one, whichever points closer to the pointer,
   * so a straight drag gives a zigzag and a curved drag bends with it. Moving back removes bonds.
   */
  const followChain = (md: Extract<Mode, { m: 'bond' }>, w: P) => {
    const { chain, dirs } = md
    for (let guard = 0; guard < 50; guard++) {
      const n = chain.length
      if (n >= 2 && dist(w, chain[n - 2]) < BOND * 0.5) { chain.pop(); dirs.pop(); continue }
      const last = chain[n - 1]
      if (dist(w, last) < BOND * 0.85) return
      const want = angleOf(sub(w, last))
      let ang: number
      if (!dirs.length) {
        ang = Math.round(want / SNAP) * SNAP - SNAP
      } else {
        const prev = dirs[dirs.length - 1]
        const turn = Math.PI / 3
        const diff = (a: number) => Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want)))
        ang = diff(prev + turn) <= diff(prev - turn) ? prev + turn : prev - turn
      }
      chain.push(add(last, mul(fromAngle(ang), BOND)))
      dirs.push(ang)
    }
  }

  const createCurly = (from: ID, to: ID) => {
    commit(d => {
      const id = newId('c')
      d.curlies[id] = { id, from, to, half: p.opts.curlyHalf, bend: 1 }
    })
    setCurlyFrom(null)
  }

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    svgRef.current!.setPointerCapture(e.pointerId)
    const w = toWorld(e)
    if (e.button === 1 || e.button === 2 || p.spaceDown) {
      mode.current = { m: 'pan', sx: e.clientX, sy: e.clientY, vx: p.view.x, vy: p.view.y }
      return
    }
    if (e.button !== 0) return
    const hit = hitAt(w)
    const d = getDoc()
    const o = p.opts

    switch (p.tool) {
      case 'select': {
        if (!hit) {
          mode.current = { m: 'marquee', start: w, add: e.shiftKey }
          if (!e.shiftKey) p.setSelection([])
          setMarquee({ x1: w.x, y1: w.y, x2: w.x, y2: w.y })
          return
        }
        if (hit.kind === 'arrow' && hit.end) {
          p.setSelection([hit.id])
          mode.current = { m: 'arrowEnd', base: d, id: hit.id, end: hit.end }
          return
        }
        if (hit.kind === 'curly') {
          p.setSelection([hit.id])
          mode.current = { m: 'bend', base: d, id: hit.id }
          return
        }
        let sel = p.selection
        if (e.shiftKey) {
          const group = e.altKey ? [hit.id] : expandMolecules(d, [hit.id])
          sel = sel.includes(hit.id) ? sel.filter(id => !group.includes(id)) : [...new Set([...sel, ...group])]
        } else if (e.altKey && hit.kind === 'atom') {
          sel = [hit.id]
        } else if (!sel.includes(hit.id)) {
          sel = expandMolecules(d, [hit.id])
        }
        p.setSelection(sel)
        mode.current = { m: 'move', base: d, ids: sel, start: w, moved: false }
        return
      }
      case 'bond': {
        if (hit?.kind === 'bond') { commit(dd => applyBondStyle(dd, hit.id, o.bondOrder, o.bondStereo)); return }
        const from = hit?.kind === 'atom' ? hit.id : null
        const start = from ? d.atoms[from] : w
        mode.current = { m: 'bond', from, start, sx: e.clientX, sy: e.clientY, chain: [start], dirs: [] }
        setPointer(w)
        return
      }
      case 'atom': {
        if (hit?.kind === 'atom') {
          commit(dd => {
            const a = dd.atoms[hit.id]
            if (o.atomMode === 'element') a.element = o.element
            else if (o.atomMode === 'plus') a.charge = Math.min(a.charge + 1, 4)
            else if (o.atomMode === 'minus') a.charge = Math.max(a.charge - 1, -4)
            else if (o.atomMode === 'lonepair') a.lonePairs = (a.lonePairs + 1) % 5
            else a.radical = !a.radical
          })
        } else if (!hit && o.atomMode === 'element') {
          commit(dd => addAtom(dd, w.x, w.y, o.element))
        }
        return
      }
      case 'ring': {
        commit(dd => addRing(dd, o.ringSize, o.ringAromatic && o.ringSize === 6,
          hit?.kind === 'atom' ? { kind: 'atom', id: hit.id }
            : hit?.kind === 'bond' ? { kind: 'bond', id: hit.id }
              : { kind: 'point', p: w }))
        return
      }
      case 'arrow': {
        mode.current = { m: 'arrow', start: w }
        setPointer(w)
        return
      }
      case 'curly': {
        if (hit?.kind === 'curly' && !curlyFrom) {
          commit(dd => { dd.curlies[hit.id].bend *= -1 })
          return
        }
        const anchor = hit && (hit.kind === 'atom' || hit.kind === 'bond') ? hit.id : null
        if (curlyFrom) {
          if (anchor && anchor !== curlyFrom) createCurly(curlyFrom, anchor)
          else setCurlyFrom(null)
          return
        }
        if (anchor) {
          setCurlyFrom(anchor)
          mode.current = { m: 'curly', from: anchor, sx: e.clientX, sy: e.clientY }
          setPointer(w)
        }
        return
      }
      case 'text': {
        // Open the editor on pointer-up: opening it now would lose focus to this same click.
        mode.current = {
          m: 'text',
          target: hit?.kind === 'text' ? { kind: 'text', id: hit.id } : { kind: 'newText', x: w.x, y: w.y + 5 },
        }
        return
      }
      case 'eraser': {
        mode.current = { m: 'erase', base: d }
        if (hit) { const nd = structuredClone(d); removeItems(nd, [hit.id]); setLive(nd) }
        return
      }
    }
  }

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const w = toWorld(e)
    const md = mode.current
    switch (md.m) {
      case 'none': {
        const h = hitAt(w)
        const id = h?.id ?? null
        if (id !== p.hover) p.setHover(id)
        if (curlyFrom) setPointer(w)
        return
      }
      case 'pan':
        p.setView(v => ({ ...v, x: md.vx + e.clientX - md.sx, y: md.vy + e.clientY - md.sy }))
        return
      case 'move': {
        const nd = structuredClone(md.base)
        moveItems(nd, md.ids, w.x - md.start.x, w.y - md.start.y)
        md.moved = true
        setLive(nd)
        return
      }
      case 'arrowEnd': {
        const nd = structuredClone(md.base)
        const r = nd.arrows[md.id]
        const other = md.end === 1 ? { x: r.x2, y: r.y2 } : { x: r.x1, y: r.y1 }
        const q = e.shiftKey ? w : snapAngle(other, w, Math.PI / 12)
        if (md.end === 1) { r.x1 = q.x; r.y1 = q.y } else { r.x2 = q.x; r.y2 = q.y }
        setLive(nd)
        return
      }
      case 'bend': {
        const nd = structuredClone(md.base)
        const c = nd.curlies[md.id]
        const s = anchorPoint(nd, c.from), t = anchorPoint(nd, c.to)
        if (s && t) {
          const L = Math.max(dist(s, t), 1)
          const n = perp(norm(sub(t, s)))
          const off = (w.x - mid(s, t).x) * n.x + (w.y - mid(s, t).y) * n.y
          // the curve's peak sits halfway to the control point
          c.bend = Math.max(-3, Math.min(3, (off * 2) / Math.max(L * 0.45, 16)))
          if (Math.abs(c.bend) < 0.15) c.bend = 0.15 * Math.sign(c.bend || 1)
        }
        setLive(nd)
        return
      }
      case 'marquee':
        setMarquee({ x1: md.start.x, y1: md.start.y, x2: w.x, y2: w.y })
        return
      case 'bond':
        followChain(md, w)
        setPointer(w)
        return
      case 'arrow': case 'curly':
        setPointer(w)
        return
      case 'erase': {
        const h = hitAt(w)
        if (h) { const nd = structuredClone(getDoc()); removeItems(nd, [h.id]); setLive(nd) }
        return
      }
    }
  }

  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    const w = toWorld(e)
    const md = mode.current
    mode.current = { m: 'none' }
    switch (md.m) {
      case 'move': case 'arrowEnd': case 'bend': case 'erase':
        finishLive(md.base)
        break
      case 'text': {
        const target = md.target
        setTimeout(() => p.onEdit(target), 0)
        break
      }
      case 'marquee': {
        const r = { x1: md.start.x, y1: md.start.y, x2: w.x, y2: w.y }
        setMarquee(null)
        if (Math.abs(r.x2 - r.x1) < 2 && Math.abs(r.y2 - r.y1) < 2) break
        const d = getDoc()
        const ids: ID[] = []
        for (const a of Object.values(d.atoms)) if (inRect(a, r)) ids.push(a.id)
        const inside = new Set(ids)
        for (const b of Object.values(d.bonds)) if (inside.has(b.a1) && inside.has(b.a2)) ids.push(b.id)
        for (const a of Object.values(d.arrows)) if (inRect(mid({ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }), r)) ids.push(a.id)
        for (const t of Object.values(d.texts)) if (inRect(t, r)) ids.push(t.id)
        for (const c of Object.values(d.curlies)) if (inRect(anchorPoint(d, c.from) ?? { x: NaN, y: NaN }, r)) ids.push(c.id)
        p.setSelection(md.add ? [...new Set([...p.selection, ...ids])] : ids)
        break
      }
      case 'bond': {
        const o = p.opts
        const clicked = Math.hypot(e.clientX - md.sx, e.clientY - md.sy) < 6
        setPointer(null)
        if (!clicked && md.chain.length > 2) {
          commit(d => {
            let prev = md.from ?? (atomNear(d, md.start, tol()) || addAtom(d, md.start.x, md.start.y))
            md.chain.slice(1).forEach((pt, i) => {
              const isLast = i === md.chain.length - 2
              const near = atomNear(d, pt, isLast ? tol() * 1.5 : BOND * 0.2, prev)
              const next = near ?? addAtom(d, pt.x, pt.y)
              if (next !== prev && !bondBetween(d, prev, next)) addBond(d, prev, next, 1, 'none')
              prev = next
            })
          })
          break
        }
        commit(d => {
          if (clicked) {
            if (md.from) growBond(d, md.from, o.bondOrder, o.bondStereo)
            else {
              const a = addAtom(d, md.start.x, md.start.y)
              growBond(d, a, o.bondOrder, o.bondStereo)
            }
            return
          }
          const from = md.from ?? addAtom(d, md.start.x, md.start.y)
          const snap = snapEnd(d.atoms[from], w, from)
          const to = snap.atom ?? addAtom(d, snap.p.x, snap.p.y)
          if (to !== from) addBond(d, from, to, o.bondOrder, o.bondStereo)
        })
        break
      }
      case 'arrow': {
        setPointer(null)
        let end = w
        if (len(sub(w, md.start)) < 15) end = add(md.start, { x: BOND * 2, y: 0 })
        else if (!e.shiftKey) end = snapAngle(md.start, w, Math.PI / 12)
        commit(d => {
          const id = newId('r')
          d.arrows[id] = { id, kind: p.opts.arrowKind, x1: md.start.x, y1: md.start.y, x2: end.x, y2: end.y, above: '', below: '' }
        })
        break
      }
      case 'curly': {
        const dragged = Math.hypot(e.clientX - md.sx, e.clientY - md.sy) > 6
        if (dragged) {
          const h = hitAt(w)
          if (h && (h.kind === 'atom' || h.kind === 'bond') && h.id !== md.from) createCurly(md.from, h.id)
        }
        break
      }
    }
    force(x => x + 1)
  }

  const onDouble = (e: RMouseEvent) => {
    if (p.tool !== 'select') return
    const h = hitAt(toWorld(e))
    if (h?.kind === 'text') p.onEdit({ kind: 'text', id: h.id })
    else if (h?.kind === 'arrow') p.onEdit({ kind: 'arrow', id: h.id })
    else if (h?.kind === 'atom') p.onEdit({ kind: 'atom', id: h.id })
  }

  const md = mode.current
  const k = p.view.k
  let preview: ReactNode = null
  if (md.m === 'bond' && pointer) {
    const moved = dist(pointer, md.start) * k > 6
    if (md.chain.length > 2) {
      preview = (
        <g>
          <polyline points={md.chain.map(q => `${q.x},${q.y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
          {md.chain.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={2.5} fill="var(--accent)" />)}
          <text x={pointer.x + 12} y={pointer.y - 10} fontSize={12} fill="var(--accent)">{md.chain.length - 1}</text>
        </g>
      )
    } else if (moved) {
      const s = snapEnd(md.start, pointer, md.from)
      preview = <line x1={md.start.x} y1={md.start.y} x2={s.p.x} y2={s.p.y} stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 3" />
    }
  } else if (md.m === 'arrow' && pointer) {
    const end = snapAngle(md.start, pointer, Math.PI / 12)
    preview = <line x1={md.start.x} y1={md.start.y} x2={end.x} y2={end.y} stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 3" />
  }
  if (curlyFrom && pointer) {
    const s = anchorPoint(doc, curlyFrom)
    if (s) {
      const c = add(mid(s, pointer), mul(perp(norm(sub(pointer, s))), Math.max(dist(s, pointer) * 0.45, 16)))
      preview = (
        <g>
          <circle cx={s.x} cy={s.y} r={10} fill="var(--hover)" />
          <path d={`M ${s.x} ${s.y} Q ${c.x} ${c.y} ${pointer.x} ${pointer.y}`} stroke="var(--curly)" strokeWidth={1.5} fill="none" strokeDasharray="4 3" />
        </g>
      )
    }
  }

  const cursor = p.spaceDown || md.m === 'pan' ? 'grabbing'
    : p.tool === 'select' ? (p.hover ? 'move' : 'default')
      : p.tool === 'text' ? 'text' : 'crosshair'

  return (
    <svg
      ref={svgRef}
      className="canvas"
      style={{ cursor }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => { if (mode.current.m === 'none') p.setHover(null) }}
      onDoubleClick={onDouble}
      onContextMenu={e => e.preventDefault()}
    >
      <g transform={`translate(${p.view.x} ${p.view.y}) scale(${k})`}>
        <Scene doc={doc} palette={LIVE} selected={new Set(p.selection)} hover={p.hover} />
        {preview}
        {marquee && (
          <rect
            x={Math.min(marquee.x1, marquee.x2)} y={Math.min(marquee.y1, marquee.y2)}
            width={Math.abs(marquee.x2 - marquee.x1)} height={Math.abs(marquee.y2 - marquee.y1)}
            fill="var(--select)" stroke="var(--accent)" strokeWidth={1 / k} strokeDasharray={`${4 / k} ${3 / k}`}
          />
        )}
      </g>
    </svg>
  )
}

function snapAngle(from: P, to: P, step: number): P {
  const v = sub(to, from)
  const ang = Math.round(angleOf(v) / step) * step
  return add(from, mul(fromAngle(ang), len(v)))
}
