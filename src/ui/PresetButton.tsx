import { useEffect, useRef, useState } from 'react'
import type { Doc } from '../model/types'
import { getDoc, getTabs, isEmptyDoc, newTab, renameTab, replaceDoc, switchTab, useTabs } from '../model/store'
import { Icon } from './Icons'

/** The preset: every OSY2 mechanism exercise (start materials only, no answers), in public/preset/. */
export const PRESET_TAB = 'Preset: mechanismen'
const BASE = `${import.meta.env.BASE_URL}preset/`

/** One exercise in public/preset/index.json, with its own small sheet. */
export interface PresetItem { t: string; q: string; file: string }
export interface PresetSection { title: string; color: string; items: PresetItem[] }

let cache: Promise<PresetSection[]> | null = null
function loadIndex(): Promise<PresetSection[]> {
  cache ??= fetch(BASE + 'index.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  cache.catch(() => { cache = null })
  return cache
}

/** Open a sheet in its own tab (or in the current tab when that is empty); switch to it when it is already open. */
async function openSheet(file: string, name: string) {
  const tabs = getTabs()
  const existing = tabs.find(t => t.name === name)
  if (existing) { switchTab(existing.id); return }
  const r = await fetch(BASE + file)
  if (!r.ok) throw new Error('Kon de opgave niet openen')
  const d = (await r.json()) as Doc
  const active = tabs.find(t => t.active)
  if (active && isEmptyDoc(getDoc())) { replaceDoc(d); renameTab(active.id, name) } else newTab(d, name)
}

/** All exercises on one big sheet. */
export const openPreset = () => openSheet('mechanismen.chem.json', PRESET_TAB)

/**
 * "Preset" button on the tab bar: a menu with every mechanism exercise. Each one opens on its own
 * small tab, so you draw on a sheet with only that exercise instead of scrolling through all of them.
 */
export function PresetButton({ onOpened }: { onOpened?: () => void }) {
  const tabs = useTabs()
  const [sections, setSections] = useState<PresetSection[] | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [top, setTop] = useState(92)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { loadIndex().then(setSections).catch(() => setError('Geen opgaven gevonden (public/preset/index.json).')) }, [])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', close); window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])

  const pick = async (file: string, name: string) => {
    setBusy(file)
    try { await openSheet(file, name); setOpen(false); onOpened?.() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  const isOpen = (name: string) => tabs.some(t => t.name === name)

  return (
    <div className="lesson-menu" ref={box}>
      <button className={'lesson-btn' + (open ? ' on' : '')} onClick={e => { setTop(e.currentTarget.getBoundingClientRect().bottom + 6); setOpen(o => !o) }} title="Preset: kies een mechanisme-opdracht, die opent als eigen tabblad (zonder antwoorden)" aria-expanded={open}>
        <Icon name="curly" size={15} /><span>Preset</span>
      </button>
      {open && (
        <div className="lesson-pop" role="menu" style={{ top }}>
          <div className="popover-title">Mechanismen tekenen</div>
          {error && <p className="lesson-err">{error}</p>}
          {!sections && !error && <p className="lesson-err">Laden…</p>}
          {sections?.map(sec => (
            <div key={sec.title}>
              <div className="lesson-group" style={{ color: sec.color }}>{sec.title}</div>
              <ul>
                {sec.items.map(it => (
                  <li key={it.file}>
                    <button role="menuitem" onClick={() => pick(it.file, it.t)} disabled={busy !== null} title={it.q}>
                      <span className="lesson-t">{it.t}<small>{it.q}</small></span>
                      {isOpen(it.t) && <span className="lesson-open" title="Staat al open">●</span>}
                      {busy === it.file && <span className="lesson-open">…</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {sections && (
            <ul>
              <li>
                <button role="menuitem" onClick={() => pick('mechanismen.chem.json', PRESET_TAB)} disabled={busy !== null}>
                  <span className="lesson-t">Alles op één blad<small>alle opgaven onder elkaar</small></span>
                  {isOpen(PRESET_TAB) && <span className="lesson-open" title="Staat al open">●</span>}
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
