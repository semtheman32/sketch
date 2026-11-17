import { findAbbrev } from './abbrev'

export interface ElementInfo {
  mass: number
  /** Allowed neutral valences, smallest first. Empty for metals (no implicit H). */
  valence: number[]
  color?: string
}

export const ELEMENTS: Record<string, ElementInfo> = {
  H: { mass: 1.008, valence: [1] },
  He: { mass: 4.003, valence: [0] },
  Li: { mass: 6.94, valence: [] , color: '#8a5cc2' },
  Be: { mass: 9.012, valence: [] },
  B: { mass: 10.81, valence: [3], color: '#c27c4a' },
  C: { mass: 12.011, valence: [4] },
  N: { mass: 14.007, valence: [3, 5], color: '#3b6fd4' },
  O: { mass: 15.999, valence: [2], color: '#d64545' },
  F: { mass: 18.998, valence: [1], color: '#2e9e5b' },
  Ne: { mass: 20.18, valence: [0] },
  Na: { mass: 22.99, valence: [], color: '#8a5cc2' },
  Mg: { mass: 24.305, valence: [], color: '#2e8a4a' },
  Al: { mass: 26.982, valence: [] },
  Si: { mass: 28.085, valence: [4], color: '#b08a3a' },
  P: { mass: 30.974, valence: [3, 5], color: '#e07b22' },
  S: { mass: 32.06, valence: [2, 4, 6], color: '#c9a227' },
  Cl: { mass: 35.45, valence: [1], color: '#2e9e5b' },
  Ar: { mass: 39.95, valence: [0] },
  K: { mass: 39.098, valence: [], color: '#8a5cc2' },
  Ca: { mass: 40.078, valence: [], color: '#2e8a4a' },
  Mn: { mass: 54.938, valence: [] },
  Fe: { mass: 55.845, valence: [], color: '#c26a3a' },
  Co: { mass: 58.933, valence: [] },
  Ni: { mass: 58.693, valence: [] },
  Cu: { mass: 63.546, valence: [], color: '#c26a3a' },
  Zn: { mass: 65.38, valence: [] },
  Se: { mass: 78.971, valence: [2, 4, 6], color: '#c9a227' },
  Br: { mass: 79.904, valence: [1], color: '#a33b3b' },
  Pd: { mass: 106.42, valence: [] },
  Ag: { mass: 107.87, valence: [] },
  Sn: { mass: 118.71, valence: [4] },
  I: { mass: 126.904, valence: [1], color: '#7b4fc9' },
  Pt: { mass: 195.08, valence: [] },
  Au: { mass: 196.97, valence: [] },
  Hg: { mass: 200.59, valence: [] },
  Pb: { mass: 207.2, valence: [] },
}

export const isElement = (sym: string): boolean => sym in ELEMENTS

/** Normalise user input like "cl" or "BR" to "Cl"/"Br". */
export function normaliseSymbol(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const sym = s[0].toUpperCase() + s.slice(1).toLowerCase()
  return isElement(sym) ? sym : null
}

/** Normalise an atom label the user typed: an element ("cl" → "Cl") or a group ("boc" → "Boc"). */
export function normaliseLabel(input: string): string | null {
  return normaliseSymbol(input) ?? findAbbrev(input)?.label ?? null
}

export const elementColor = (sym: string): string | undefined => ELEMENTS[sym]?.color

/** Groups 15–17 gain valence with positive charge (NH4+, H3O+); B/C/Si lose it. */
const ELECTRON_RICH = new Set(['N', 'P', 'O', 'S', 'Se', 'F', 'Cl', 'Br', 'I'])

export function implicitHydrogens(element: string, bondOrderSum: number, charge: number, radical: boolean): number {
  const info = ELEMENTS[element]
  if (!info || info.valence.length === 0) return 0
  const shift = ELECTRON_RICH.has(element) ? charge : -Math.abs(charge)
  for (const v of info.valence) {
    const val = v + shift - (radical ? 1 : 0)
    if (val >= bondOrderSum) return Math.max(0, val - bondOrderSum)
  }
  return 0
}
