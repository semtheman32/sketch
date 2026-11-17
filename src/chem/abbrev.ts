/*
 * Group abbreviations (Me, Ph, Boc, CO2Me…). On the canvas an abbreviation is one atom whose
 * `element` is the label; it bonds once, counts as its full formula, and is expanded to real
 * atoms whenever RDKit needs the structure (SMILES, MOL export) or when the user asks.
 */
import { ELEMENTS } from './elements'

export interface Abbrev {
  label: string
  /** SMILES of the group; the FIRST atom is the one bonded to the rest of the molecule. */
  smiles: string
  /** Formula of the group as a substituent (R in R–X). */
  formula: Record<string, number>
  /** How it reads when the bond comes in from the right, e.g. OMe → MeO. */
  left?: string
  /** Other spellings people type. */
  aliases?: string[]
  name: string
}

export const ABBREVIATIONS: Abbrev[] = [
  { label: 'Me', name: 'methyl', smiles: 'C', formula: { C: 1, H: 3 } },
  { label: 'Et', name: 'ethyl', smiles: 'CC', formula: { C: 2, H: 5 } },
  { label: 'Pr', name: 'propyl', smiles: 'CCC', formula: { C: 3, H: 7 }, aliases: ['nPr'] },
  { label: 'iPr', name: 'isopropyl', smiles: 'C(C)C', formula: { C: 3, H: 7 } },
  { label: 'Bu', name: 'butyl', smiles: 'CCCC', formula: { C: 4, H: 9 }, aliases: ['nBu'] },
  { label: 'tBu', name: 'tert-butyl', smiles: 'C(C)(C)C', formula: { C: 4, H: 9 } },
  { label: 'Ph', name: 'phenyl', smiles: 'c1ccccc1', formula: { C: 6, H: 5 } },
  { label: 'Bn', name: 'benzyl', smiles: 'Cc1ccccc1', formula: { C: 7, H: 7 } },
  { label: 'Ac', name: 'acetyl', smiles: 'C(C)=O', formula: { C: 2, H: 3, O: 1 } },
  { label: 'Bz', name: 'benzoyl', smiles: 'C(=O)c1ccccc1', formula: { C: 7, H: 5, O: 1 } },
  { label: 'Piv', name: 'pivaloyl', smiles: 'C(=O)C(C)(C)C', formula: { C: 5, H: 9, O: 1 } },
  { label: 'Boc', name: 'tert-butoxycarbonyl', smiles: 'C(=O)OC(C)(C)C', formula: { C: 5, H: 9, O: 2 } },
  { label: 'Cbz', name: 'benzyloxycarbonyl', smiles: 'C(=O)OCc1ccccc1', formula: { C: 8, H: 7, O: 2 }, aliases: ['Z'] },
  { label: 'Fmoc', name: 'fluorenylmethoxycarbonyl', smiles: 'C(=O)OCC1c2ccccc2-c2ccccc21', formula: { C: 15, H: 11, O: 2 } },
  { label: 'PMB', name: 'p-methoxybenzyl', smiles: 'Cc1ccc(OC)cc1', formula: { C: 8, H: 9, O: 1 } },
  { label: 'THP', name: 'tetrahydropyranyl', smiles: 'C1CCCCO1', formula: { C: 5, H: 9, O: 1 } },
  { label: 'Ts', name: 'tosyl', smiles: 'S(=O)(=O)c1ccc(C)cc1', formula: { C: 7, H: 7, O: 2, S: 1 } },
  { label: 'Ms', name: 'mesyl', smiles: 'S(C)(=O)=O', formula: { C: 1, H: 3, O: 2, S: 1 } },
  { label: 'Tf', name: 'triflyl', smiles: 'S(=O)(=O)C(F)(F)F', formula: { C: 1, F: 3, O: 2, S: 1 } },
  { label: 'TMS', name: 'trimethylsilyl', smiles: '[Si](C)(C)C', formula: { C: 3, H: 9, Si: 1 } },
  { label: 'TBS', name: 'tert-butyldimethylsilyl', smiles: '[Si](C)(C)C(C)(C)C', formula: { C: 6, H: 15, Si: 1 }, aliases: ['TBDMS'] },
  { label: 'TIPS', name: 'triisopropylsilyl', smiles: '[Si](C(C)C)(C(C)C)C(C)C', formula: { C: 9, H: 21, Si: 1 } },
  { label: 'OMe', left: 'MeO', name: 'methoxy', smiles: 'OC', formula: { C: 1, H: 3, O: 1 } },
  { label: 'OEt', left: 'EtO', name: 'ethoxy', smiles: 'OCC', formula: { C: 2, H: 5, O: 1 } },
  { label: 'OBn', left: 'BnO', name: 'benzyloxy', smiles: 'OCc1ccccc1', formula: { C: 7, H: 7, O: 1 } },
  { label: 'OAc', left: 'AcO', name: 'acetoxy', smiles: 'OC(C)=O', formula: { C: 2, H: 3, O: 2 } },
  { label: 'OTs', left: 'TsO', name: 'tosylate', smiles: 'OS(=O)(=O)c1ccc(C)cc1', formula: { C: 7, H: 7, O: 3, S: 1 } },
  { label: 'OTf', left: 'TfO', name: 'triflate', smiles: 'OS(=O)(=O)C(F)(F)F', formula: { C: 1, F: 3, O: 3, S: 1 } },
  { label: 'CO2Me', left: 'MeO2C', name: 'methyl ester', smiles: 'C(=O)OC', formula: { C: 2, H: 3, O: 2 } },
  { label: 'CO2Et', left: 'EtO2C', name: 'ethyl ester', smiles: 'C(=O)OCC', formula: { C: 3, H: 5, O: 2 } },
  { label: 'CO2H', left: 'HO2C', name: 'carboxylic acid', smiles: 'C(=O)O', formula: { C: 1, H: 1, O: 2 }, aliases: ['COOH'] },
  { label: 'CHO', left: 'OHC', name: 'aldehyde', smiles: 'C=O', formula: { C: 1, H: 1, O: 1 } },
  { label: 'CN', left: 'NC', name: 'nitrile', smiles: 'C#N', formula: { C: 1, N: 1 } },
  { label: 'NO2', left: 'O2N', name: 'nitro', smiles: '[N+](=O)[O-]', formula: { N: 1, O: 2 } },
  { label: 'CF3', left: 'F3C', name: 'trifluoromethyl', smiles: 'C(F)(F)F', formula: { C: 1, F: 3 } },
  { label: 'N3', name: 'azide', smiles: 'N=[N+]=[N-]', formula: { N: 3 } },
  { label: 'SO3H', left: 'HO3S', name: 'sulfonic acid', smiles: 'S(=O)(=O)O', formula: { H: 1, O: 3, S: 1 } },
]

const BY_KEY = new Map<string, Abbrev>()
for (const a of ABBREVIATIONS) {
  BY_KEY.set(a.label.toLowerCase(), a)
  for (const al of a.aliases ?? []) BY_KEY.set(al.toLowerCase(), a)
}

/** Find an abbreviation by label or alias, ignoring case ("boc", "COOH"). */
export function findAbbrev(text: string): Abbrev | undefined {
  return BY_KEY.get(text.trim().toLowerCase())
}

export const isAbbrev = (element: string): boolean => !(element in ELEMENTS) && BY_KEY.has(element.toLowerCase())
export const abbrevOf = (element: string): Abbrev | undefined => (isAbbrev(element) ? BY_KEY.get(element.toLowerCase()) : undefined)

/** True when `text` is the start of some abbreviation (used to collect typed letters over an atom). */
export function isAbbrevPrefix(text: string): boolean {
  const t = text.toLowerCase()
  for (const k of BY_KEY.keys()) if (k.startsWith(t) && k !== t) return true
  return false
}

export function abbrevMass(a: Abbrev): number {
  let m = 0
  for (const [el, n] of Object.entries(a.formula)) m += (ELEMENTS[el]?.mass ?? 0) * n
  return m
}

/** Label text split into runs, digits as subscripts: "CO2Me" → C O ₂ Me. */
export function labelRuns(label: string): { text: string; sub: boolean }[] {
  const runs: { text: string; sub: boolean }[] = []
  for (const ch of label) {
    const sub = /\d/.test(ch)
    const last = runs[runs.length - 1]
    if (last && last.sub === sub) last.text += ch
    else runs.push({ text: ch, sub })
  }
  return runs
}
