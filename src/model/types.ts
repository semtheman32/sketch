export type ID = string

export interface Atom {
  id: ID
  x: number
  y: number
  element: string
  charge: number
  lonePairs: number
  radical: boolean
}

export type BondOrder = 1 | 2 | 3
export type BondStereo = 'none' | 'wedge' | 'dash'

export interface Bond {
  id: ID
  a1: ID
  a2: ID
  order: BondOrder
  stereo: BondStereo
}

export type ArrowKind = 'forward' | 'equilibrium' | 'resonance' | 'retro'

export interface Arrow {
  id: ID
  kind: ArrowKind
  x1: number
  y1: number
  x2: number
  y2: number
  above: string
  below: string
}

/** A curly (mechanism) arrow. `from`/`to` are atom ids ("a…") or bond ids ("b…"). */
export interface Curly {
  id: ID
  from: ID
  to: ID
  half: boolean
  /** Signed curvature. 1 bends to the left of the from→to direction, -1 to the right. */
  bend: number
}

export interface TextItem {
  id: ID
  x: number
  y: number
  text: string
  /** Hex colour; empty or missing means the normal ink colour. */
  color?: string
  bold?: boolean
  italic?: boolean
  /** Font size in canvas units (default 14). */
  size?: number
}

/**
 * Square or round brackets around part of a scheme (an intermediate, a transition state),
 * with an optional label such as ‡ at the top right.
 */
export interface Bracket {
  id: ID
  x1: number
  y1: number
  x2: number
  y2: number
  /** 'box' is a rounded frame with a light tint, for grouping parts of a sheet (lesstof, notes). */
  shape: 'square' | 'round' | 'box'
  label: string
  /** Hex colour of a box frame and its tint; brackets ignore it. */
  color?: string
}

export type TextStyle = Pick<TextItem, 'color' | 'bold' | 'italic' | 'size'>

export interface Doc {
  atoms: Record<ID, Atom>
  bonds: Record<ID, Bond>
  arrows: Record<ID, Arrow>
  curlies: Record<ID, Curly>
  texts: Record<ID, TextItem>
  brackets: Record<ID, Bracket>
}

export const emptyDoc = (): Doc => ({ atoms: {}, bonds: {}, arrows: {}, curlies: {}, texts: {}, brackets: {} })

export type ItemKind = 'atom' | 'bond' | 'arrow' | 'curly' | 'text' | 'bracket'

/** Every item id in a document. */
export function allIds(d: Doc): ID[] {
  return [d.atoms, d.bonds, d.arrows, d.curlies, d.texts, d.brackets].flatMap(g => Object.keys(g ?? {}))
}

/** Whether an item with this id exists. */
export function exists(d: Doc, id: ID): boolean {
  switch (kindOf(id)) {
    case 'atom': return !!d.atoms[id]
    case 'bond': return !!d.bonds[id]
    case 'arrow': return !!d.arrows[id]
    case 'curly': return !!d.curlies[id]
    case 'bracket': return !!d.brackets?.[id]
    default: return !!d.texts[id]
  }
}

export function kindOf(id: ID): ItemKind {
  switch (id[0]) {
    case 'a': return 'atom'
    case 'b': return 'bond'
    case 'r': return 'arrow'
    case 'c': return 'curly'
    case 'k': return 'bracket'
    default: return 'text'
  }
}
