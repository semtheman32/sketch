import type { ArrowKind, BondOrder, BondStereo } from '../model/types'

export type Tool = 'select' | 'bond' | 'atom' | 'ring' | 'arrow' | 'curly' | 'text' | 'eraser'

export type AtomMode = 'element' | 'plus' | 'minus' | 'lonepair' | 'radical'

export interface ToolOptions {
  bondOrder: BondOrder
  bondStereo: BondStereo
  element: string
  atomMode: AtomMode
  ringSize: number
  ringAromatic: boolean
  arrowKind: ArrowKind
  curlyHalf: boolean
}

export const defaultOptions: ToolOptions = {
  bondOrder: 1,
  bondStereo: 'none',
  element: 'O',
  atomMode: 'element',
  ringSize: 6,
  ringAromatic: true,
  arrowKind: 'forward',
  curlyHalf: false,
}

export interface ToolInfo { id: Tool; label: string; key: string; icon: string; hint: string }

export const TOOLS: ToolInfo[] = [
  { id: 'select', label: 'Select', key: 'V', icon: 'select', hint: 'Click a molecule to select it, drag to move. Alt+drag moves one atom. Drag on empty space to box-select.' },
  { id: 'bond', label: 'Bond', key: 'B', icon: 'bond', hint: 'Click to add a bond. Click an atom to grow a chain, or drag from it. Click a bond to change its order.' },
  { id: 'atom', label: 'Atom', key: 'A', icon: 'atom', hint: 'Click an atom to change it. Tip: hover any atom and type N, O, S, Cl (L), Br (R)…' },
  { id: 'ring', label: 'Ring', key: 'R', icon: 'ring', hint: 'Click empty space to place a ring. Click a bond to fuse, or an atom to attach.' },
  { id: 'arrow', label: 'Reaction arrow', key: 'W', icon: 'arrow', hint: 'Drag to draw a reaction arrow. Double-click it with Select to add conditions.' },
  { id: 'curly', label: 'Curly arrow', key: 'M', icon: 'curly', hint: 'Click where electrons come from (atom, lone pair or bond), then where they go. Click an arrow to flip its curve.' },
  { id: 'text', label: 'Text', key: 'T', icon: 'text', hint: 'Click to add a label. Click a label to edit it.' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser', hint: 'Click or drag over anything to delete it.' },
]
