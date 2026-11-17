/*
 * Drawing styles: how bonds and labels are drawn, on the canvas and in exports.
 * All sizes are in canvas units, where a bond is 40 units long (BOND).
 *
 * ACS 1996 follows the ACS Document 1996 settings: bond length 14.4 pt, line width 0.6 pt,
 * bold (wedge) width 2.0 pt, double-bond spacing 18% of bond length, hash spacing 2.5 pt,
 * margin 1.6 pt, Arial 10 pt. Scaled so 14.4 pt = 40 units (×2.78).
 */
import { useSyncExternalStore } from 'react'

export interface DrawStyle {
  id: string
  name: string
  note: string
  /** Stroke width of bonds and arrows. */
  line: number
  /** Distance between the two lines of a double bond. */
  double: number
  /** Width of the wide end of a wedge. */
  wedge: number
  /** Spacing between the hashes of a dashed (hashed) wedge. */
  hash: number
  /** Atom label font size. */
  font: number
  fontFamily: string
  fontWeight: number
  /** Gap between a bond end and the edge of a label. */
  margin: number
}

const PT = 40 / 14.4

export const STYLES: DrawStyle[] = [
  {
    id: 'sketch', name: 'Sketch', note: 'Clean default for the screen',
    line: 1.6, double: 6, wedge: 7.6, hash: 5.6, font: 14, fontFamily: "Inter, 'Segoe UI', Arial, sans-serif", fontWeight: 400, margin: 4,
  },
  {
    id: 'acs', name: 'ACS 1996', note: 'Journal standard: thin lines, Arial labels',
    line: 0.6 * PT, double: 0.18 * 40, wedge: 2 * PT, hash: 2.5 * PT, font: 10 * PT, fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: 400, margin: 1.6 * PT,
  },
  {
    id: 'present', name: 'Presentation', note: 'Bold lines and large labels for slides',
    line: 2.8, double: 7.5, wedge: 10, hash: 6, font: 19, fontFamily: "Arial, Helvetica, sans-serif", fontWeight: 600, margin: 4.5,
  },
]

export const styleById = (id: string): DrawStyle => STYLES.find(s => s.id === id) ?? STYLES[0]

const KEY = 'chemsketch-clone:style'
let current: DrawStyle = (() => {
  try { return styleById(localStorage.getItem(KEY) ?? 'sketch') } catch { return STYLES[0] }
})()
const listeners = new Set<() => void>()

export function setDrawStyle(id: string) {
  current = styleById(id)
  try { localStorage.setItem(KEY, current.id) } catch { /* ignore */ }
  listeners.forEach(l => l())
}
export const getDrawStyle = () => current
export const useDrawStyle = () =>
  useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => current)
