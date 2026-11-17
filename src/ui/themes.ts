/* The app's themes. Their colours live in src/index.css under :root[data-theme='…']. */
import { useSyncExternalStore } from 'react'

export interface ThemeInfo {
  id: string
  name: string
  note: string
  dark: boolean
  /** Background, ink, accent: for the little preview in the theme menu. */
  swatch: [string, string, string]
}

export const THEMES: ThemeInfo[] = [
  { id: 'light', name: 'Refined Lab', note: 'Calm and neutral', dark: false, swatch: ['#ffffff', '#1c2230', '#2f6fe0'] },
  { id: 'dark', name: 'Refined Lab, dark', note: 'The same, at night', dark: true, swatch: ['#1b1d21', '#eceef2', '#6f9ff4'] },
  { id: 'cyanotype', name: 'Cyanotype', note: 'Blueprint paper and chalk lines', dark: true, swatch: ['#16407a', '#edf4ff', '#ffd36b'] },
  { id: 'notebook', name: 'Lab Notebook', note: 'Graph paper, ink and handwriting', dark: false, swatch: ['#f2f7ee', '#1d2c5b', '#c4302b'] },
  { id: 'fumehood', name: 'Fume Hood', note: 'Frosted glass over steel', dark: false, swatch: ['#e9eef1', '#1d282f', '#0d8587'] },
  { id: 'cpk', name: 'CPK', note: 'The atom colours you know', dark: false, swatch: ['#ffffff', '#ff2a1a', '#3050f8'] },
  { id: 'spectrometer', name: 'Spectrometer', note: 'Amber glow on charcoal', dark: true, swatch: ['#0f0d0b', '#ffb547', '#ff6b4a'] },
]

const KEY = 'chemsketch-clone:theme'

function initial(): string {
  try {
    const t = localStorage.getItem(KEY)
    if (t && THEMES.some(x => x.id === t)) return t
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let current = initial()
document.documentElement.dataset.theme = current
const listeners = new Set<() => void>()

export function setTheme(id: string) {
  if (!THEMES.some(t => t.id === id)) return
  current = id
  document.documentElement.dataset.theme = id
  try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export const useTheme = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => current)
export const themeInfo = (id: string) => THEMES.find(t => t.id === id) ?? THEMES[0]
