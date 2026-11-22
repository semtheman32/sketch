import { useEffect, useState } from 'react'
import type { Doc } from '../model/types'
import { getDoc, isEmptyDoc, newTab, renameTab, replaceDoc, switchTab, useTabs, getActiveTabId } from '../model/store'
import { Icon } from './Icons'

/** One entry of public/lesstof/index.json (made by scripts/build-lesstof.mjs). */
interface Lesson { n: number; name: string; title: string; theme: string; file: string; drawings?: number; extra?: boolean }

const BASE = import.meta.env.BASE_URL + 'lesstof/'

/**
 * Lesstof: pick a lesson and its course drawing (every mechanism and structure from the lesson
 * overview, with the explanations) opens in its own tab. A lesson that is already open is switched to.
 */
export function LessonPanel({ onClose, onOpened, flash }: { onClose: () => void; onOpened: () => void; flash: (m: string) => void }) {
  const tabs = useTabs()
  const [list, setList] = useState<Lesson[] | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    fetch(BASE + 'index.json').then(r => r.ok ? r.json() : Promise.reject()).then(setList).catch(() => setError(true))
  }, [])

  const open = async (l: Lesson) => {
    const existing = tabs.find(t => t.name === l.name)
    if (existing) { switchTab(existing.id); onClose(); onOpened(); return }
    setLoading(l.file)
    try {
      const r = await fetch(BASE + l.file)
      if (!r.ok) throw new Error()
      const d = await r.json() as Doc
      if (isEmptyDoc(getDoc())) { replaceDoc(d); renameTab(getActiveTabId(), l.name) }
      else newTab(d, l.name)
      onClose()
      onOpened()
      flash(`Opened ${l.name}`)
    } catch { flash(`Couldn't open ${l.name}`) }
    setLoading(null)
  }

  const themes = list ? [...new Set(list.map(l => l.theme))] : []
  return (
    <div className="popover lesson-menu" role="dialog" aria-label="Lesstof">
      <div className="popover-title">Lesstof per les</div>
      {error && <p className="muted small">De lesstof is niet gevonden (public/lesstof/index.json).</p>}
      {!list && !error && <p className="muted small">Laden…</p>}
      {themes.map(th => (
        <div key={th} className="lesson-group">
          <div className="lesson-theme">{th}</div>
          {list!.filter(l => l.theme === th).map(l => {
            const isOpen = tabs.some(t => t.name === l.name)
            return (
              <button key={l.file} className={'style-item lesson-item' + (isOpen ? ' on' : '')} onClick={() => open(l)} disabled={loading !== null} title={l.title}>
                <span className="style-name">{l.name}</span>
                <span className="muted small">{loading === l.file ? 'laden…' : isOpen ? 'open' : l.drawings ? `${l.drawings} tekeningen` : 'mechanismen'}</span>
              </button>
            )
          })}
        </div>
      ))}
      <p className="muted small popover-foot">Elke les opent in een eigen tabblad. Staat hij al open, dan ga je naar dat tabblad.</p>
      <button className="icon-btn popover-close" onClick={onClose} aria-label="Close lesstof"><Icon name="close" size={14} /></button>
    </div>
  )
}
