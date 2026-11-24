import { useState } from 'react'
import type { Doc } from '../model/types'
import { getDoc, getTabs, isEmptyDoc, newTab, renameTab, replaceDoc, switchTab, useTabs } from '../model/store'
import { Icon } from './Icons'

/** The preset sheet: every OSY2 mechanism exercise (start materials only, no answers), in public/preset/. */
export const PRESET_TAB = 'Preset: mechanismen'
const FILE = `${import.meta.env.BASE_URL}preset/mechanismen.chem.json`

/** Open the preset sheet in its own tab, or switch to that tab when it is already open. */
export async function openPreset() {
  const tabs = getTabs()
  const existing = tabs.find(t => t.name === PRESET_TAB)
  if (existing) { switchTab(existing.id); return }
  const r = await fetch(FILE)
  if (!r.ok) throw new Error('Kon de preset niet openen')
  const d = (await r.json()) as Doc
  const active = tabs.find(t => t.active)
  if (active && isEmptyDoc(getDoc())) { replaceDoc(d); renameTab(active.id, PRESET_TAB) } else newTab(d, PRESET_TAB)
}

/** "Preset" button on the tab bar: opens the mechanism exercises as a tab to draw in. */
export function PresetButton({ onOpened }: { onOpened?: () => void }) {
  const tabs = useTabs()
  const [busy, setBusy] = useState(false)
  const isOpen = tabs.some(t => t.name === PRESET_TAB)
  const click = async () => {
    setBusy(true)
    try { await openPreset(); onOpened?.() } catch { /* file missing: nothing to open */ } finally { setBusy(false) }
  }
  return (
    <button className="lesson-btn" onClick={click} disabled={busy} title="Preset: alle mechanisme-tekenopdrachten van OSY2 als tabblad (zonder antwoorden)">
      <Icon name="curly" size={15} /><span>Preset</span>{isOpen && <span className="lesson-open" title="Staat al open">●</span>}
    </button>
  )
}
