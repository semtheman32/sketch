/*
 * Mechanism reagents: short, arrow-ready forms of common reagents for the add-molecule box.
 * Typing "H2SO4" gives H–OSO3H (one H you can point an arrow at, the rest as a group label)
 * instead of the full PubChem structure. Atoms that give or take electrons get their lone pairs and charges.
 */
import { BOND } from '../model/geometry'

export interface ReagentAtom {
  element: string
  /** Position in bond lengths, relative to the first atom. */
  x: number
  y: number
  charge?: number
  lonePairs?: number
}
export interface Reagent {
  name: string
  /** What people type (compared without spaces, subscripts or charge signs' style). */
  keys: string[]
  atoms: ReagentAtom[]
  /** [i, j, order] */
  bonds: [number, number, 1 | 2 | 3][]
}

const R = (name: string, keys: string[], atoms: ReagentAtom[], bonds: [number, number, 1 | 2 | 3][] = []): Reagent => ({ name, keys, atoms, bonds })
const H = (x: number, y = 0): ReagentAtom => ({ element: 'H', x, y })

export const REAGENTS: Reagent[] = [
  // acids: the H that leaves is drawn, so a curly arrow can point at it
  R('zwavelzuur', ['H2SO4', 'zwavelzuur', 'sulfuric acid', 'sulphuric acid'], [H(0), { element: 'OSO3H', x: 1, y: 0 }], [[0, 1, 1]]),
  R('fosforzuur', ['H3PO4', 'fosforzuur', 'phosphoric acid'], [H(0), { element: 'OPO3H2', x: 1, y: 0 }], [[0, 1, 1]]),
  R('waterstofbromide', ['HBr', 'waterstofbromide', 'hydrogen bromide'], [H(0), { element: 'Br', x: 1, y: 0, lonePairs: 3 }], [[0, 1, 1]]),
  R('waterstofchloride', ['HCl', 'zoutzuur', 'waterstofchloride', 'hydrochloric acid', 'hydrogen chloride'], [H(0), { element: 'Cl', x: 1, y: 0, lonePairs: 3 }], [[0, 1, 1]]),
  R('waterstofjodide', ['HI', 'waterstofjodide', 'hydrogen iodide'], [H(0), { element: 'I', x: 1, y: 0, lonePairs: 3 }], [[0, 1, 1]]),
  R('hydronium', ['H3O+', 'H3O', 'hydronium', 'oxonium'], [H(0), { element: 'O', x: 1, y: 0, charge: 1, lonePairs: 1 }], [[0, 1, 1]]),
  R('proton', ['H+', 'proton'], [{ element: 'H', x: 0, y: 0, charge: 1 }]),
  R('azijnzuur', ['AcOH', 'CH3COOH', 'azijnzuur', 'acetic acid'], [H(0), { element: 'O', x: 1, y: 0, lonePairs: 2 }, { element: 'Ac', x: 2, y: 0 }], [[0, 1, 1], [1, 2, 1]]),
  R('tosylzuur', ['TsOH', 'p-tolueensulfonzuur', 'tosic acid', 'pTsOH'], [H(0), { element: 'OTs', x: 1, y: 0 }], [[0, 1, 1]]),
  R('hypochlorigzuur', ['HOCl', 'HClO', 'hypochlorigzuur', 'hypochlorous acid'], [H(0), { element: 'O', x: 1, y: 0, lonePairs: 2 }, { element: 'Cl', x: 2, y: 0, lonePairs: 3 }], [[0, 1, 1], [1, 2, 1]]),
  R('hypobromigzuur', ['HOBr', 'HBrO', 'hypobromigzuur'], [H(0), { element: 'O', x: 1, y: 0, lonePairs: 2 }, { element: 'Br', x: 2, y: 0, lonePairs: 3 }], [[0, 1, 1], [1, 2, 1]]),
  // neutral nucleophiles / solvents
  R('water', ['H2O', 'water'], [H(0), { element: 'O', x: 1, y: 0, lonePairs: 2 }], [[0, 1, 1]]),
  R('methanol', ['CH3OH', 'MeOH', 'methanol'], [H(0), { element: 'O', x: 1, y: 0, lonePairs: 2 }, { element: 'Me', x: 2, y: 0 }], [[0, 1, 1], [1, 2, 1]]),
  R('ethanol', ['C2H5OH', 'EtOH', 'ethanol'], [H(0), { element: 'O', x: 1, y: 0, lonePairs: 2 }, { element: 'Et', x: 2, y: 0 }], [[0, 1, 1], [1, 2, 1]]),
  R('ammoniak', ['NH3', 'ammoniak', 'ammonia'], [{ element: 'N', x: 0, y: 0, lonePairs: 1 }]),
  R('dibroom', ['Br2', 'dibroom', 'broom', 'bromine'], [{ element: 'Br', x: 0, y: 0, lonePairs: 3 }, { element: 'Br', x: 1, y: 0, lonePairs: 3 }], [[0, 1, 1]]),
  R('dichloor', ['Cl2', 'dichloor', 'chloor', 'chlorine'], [{ element: 'Cl', x: 0, y: 0, lonePairs: 3 }, { element: 'Cl', x: 1, y: 0, lonePairs: 3 }], [[0, 1, 1]]),
  R('boraan', ['BH3', 'boraan', 'borane', 'BH3.THF', 'BH3·THF'], [{ element: 'B', x: 0, y: 0 }, H(1)], [[0, 1, 1]]),
  // anions and bases
  R('hydroxide', ['OH-', 'HO-', 'hydroxide', 'NaOH', 'KOH'], [{ element: 'O', x: 0, y: 0, charge: -1, lonePairs: 3 }]),
  R('methoxide', ['CH3O-', 'MeO-', 'methoxide', 'NaOMe', 'NaOCH3'], [{ element: 'O', x: 0, y: 0, charge: -1, lonePairs: 3 }, { element: 'Me', x: 1, y: 0 }], [[0, 1, 1]]),
  R('ethoxide', ['C2H5O-', 'EtO-', 'ethoxide', 'NaOEt', 'NaOCH2CH3'], [{ element: 'O', x: 0, y: 0, charge: -1, lonePairs: 3 }, { element: 'Et', x: 1, y: 0 }], [[0, 1, 1]]),
  R('tert-butoxide', ['tBuO-', 'KOtBu', 'tert-butoxide', 'KOC(CH3)3'], [{ element: 'O', x: 0, y: 0, charge: -1, lonePairs: 3 }, { element: 'tBu', x: 1, y: 0 }], [[0, 1, 1]]),
  R('waterstofsulfaat', ['HSO4-', 'waterstofsulfaat', 'bisulfaat', 'hydrogen sulfate'], [{ element: 'OSO3H', x: 0, y: 0, charge: -1 }]),
  R('cyanide', ['CN-', 'NaCN', 'KCN', 'cyanide'], [{ element: 'C', x: 0, y: 0, charge: -1, lonePairs: 1 }, { element: 'N', x: 1, y: 0, lonePairs: 1 }], [[0, 1, 3]]),
  R('bromide', ['Br-', 'bromide', 'NaBr', 'KBr'], [{ element: 'Br', x: 0, y: 0, charge: -1, lonePairs: 4 }]),
  R('chloride', ['Cl-', 'chloride', 'NaCl'], [{ element: 'Cl', x: 0, y: 0, charge: -1, lonePairs: 4 }]),
  R('jodide', ['I-', 'jodide', 'iodide', 'NaI', 'KI'], [{ element: 'I', x: 0, y: 0, charge: -1, lonePairs: 4 }]),
  R('hydride', ['H-', 'hydride'], [{ element: 'H', x: 0, y: 0, charge: -1, lonePairs: 1 }]),
]

/** Normalise what was typed: no spaces, subscripts and ⁺/⁻ become plain characters, case-insensitive. */
const norm = (s: string) => s.trim().toLowerCase()
  .replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080))
  .replace(/⁺/g, '+').replace(/[⁻−–]/g, '-')
  .replace(/\s+/g, '')

const BY_KEY = new Map<string, Reagent>()
for (const r of REAGENTS) for (const k of r.keys) BY_KEY.set(norm(k), r)

export function findReagent(text: string): Reagent | undefined {
  return BY_KEY.get(norm(text))
}

/** Atom positions in canvas units, centred on (0,0). */
export function reagentLayout(r: Reagent) {
  const n = r.atoms.length
  const cx = r.atoms.reduce((s, a) => s + a.x, 0) / n
  const cy = r.atoms.reduce((s, a) => s + a.y, 0) / n
  return r.atoms.map(a => ({ ...a, x: (a.x - cx) * BOND, y: (a.y - cy) * BOND }))
}
