export interface P { x: number; y: number }

/** Standard bond length in world units. */
export const BOND = 40

export const pt = (x: number, y: number): P => ({ x, y })
export const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k })
export const len = (a: P): number => Math.hypot(a.x, a.y)
export const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y)
export const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
export const norm = (a: P): P => {
  const l = len(a)
  return l < 1e-9 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l }
}
/** Perpendicular, rotated 90° counter-clockwise on screen (y down). */
export const perp = (a: P): P => ({ x: a.y, y: -a.x })
export const fromAngle = (ang: number): P => ({ x: Math.cos(ang), y: Math.sin(ang) })
export const angleOf = (a: P): number => Math.atan2(a.y, a.x)
export const rotate = (a: P, ang: number): P => {
  const c = Math.cos(ang), s = Math.sin(ang)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

export function distToSeg(p: P, a: P, b: P): number {
  const ab = sub(b, a)
  const l2 = ab.x * ab.x + ab.y * ab.y
  if (l2 < 1e-9) return dist(p, a)
  let t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2
  t = Math.max(0, Math.min(1, t))
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })
}

/** Smallest absolute difference between two angles. */
export function angleGap(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2)
  if (d > Math.PI) d = Math.PI * 2 - d
  return d
}

export function quadPoint(p0: P, c: P, p1: P, t: number): P {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  }
}

export interface Rect { x1: number; y1: number; x2: number; y2: number }

export const inRect = (p: P, r: Rect): boolean =>
  p.x >= Math.min(r.x1, r.x2) && p.x <= Math.max(r.x1, r.x2) &&
  p.y >= Math.min(r.y1, r.y2) && p.y <= Math.max(r.y1, r.y2)
