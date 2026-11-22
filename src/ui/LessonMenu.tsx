import { useEffect, useRef, useState } from 'react'
import type { Doc } from '../model/types'
import { getDoc, isEmptyDoc, newTab, renameTab, replaceDoc, switchTab, useTabs } from '../model/store'
import { Icon } from './Icons'

/** One lesson sheet in public/lesstof/index.json. */
interface Lesson { n: number; title: string; file: string; topics?: string; label?: string }

const BASE = `${import.meta.env.BASE_URL}lesstof/`

/**
 * "Lesstof" button on the tab bar: pick a lesson and its worked sheet (mechanisms with explanations)
 * opens in its own tab. Opening a lesson that already has a tab just switches to it.
 */
export function LessonMenu({ onOpened }: { onOpened?: () => void }) {
  const tabs = useTabs()
  const [open, setOpen] = useState(false)
  const [lessons, setLessons] = useState<Lesson[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [top, setTop] = useState(92)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || lessons) return
    fetch(BASE + 'index.json').then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((l: Lesson[]) => setLessons(l)).catch(() => setError('Geen lesstof gevonden (public/lesstof/index.json).'))
  }, [open, lessons])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', close); window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])

  const tabName = (l: Lesson) => (l.label ? l.title : `Les ${l.n}: ${l.title}`)

  const openLesson = async (l: Lesson) => {
    const name = tabName(l)
    const existing = tabs.find(t => t.name === name)
    if (existing) { switchTab(existing.id); setOpen(false); onOpened?.(); return }
    setBusy(l.n)
    try {
      const r = await fetch(BASE + l.file)
      if (!r.ok) throw new Error(String(r.status))
      const d = (await r.json()) as Doc
      const active = tabs.find(t => t.active)
      if (active && isEmptyDoc(getDoc())) { replaceDoc(d); renameTab(active.id, name) } else newTab(d, name)
      setOpen(false)
      onOpened?.()
    } catch { setError(`Kon ${l.file} niet openen.`) } finally { setBusy(null) }
  }

  return (
    <div className="lesson-menu" ref={box}>
      <button className={'lesson-btn' + (open ? ' on' : '')} onClick={e => { setTop(e.currentTarget.getBoundingClientRect().bottom + 6); setOpen(o => !o) }} title="Lesstof: open een les als tabblad" aria-expanded={open}>
        <Icon name="book" size={15} /><span>Lesstof</span>
      </button>
      {open && (
        <div className="lesson-pop" role="menu" style={{ top }}>
          <div className="popover-title">Lesstof per les</div>
          {error && <p className="lesson-err">{error}</p>}
          {!lessons && !error && <p className="lesson-err">Laden…</p>}
          <ul>
            {lessons?.map(l => {
              const isOpen = tabs.some(t => t.name === tabName(l))
              return (
                <li key={l.file}>
                  <button role="menuitem" onClick={() => openLesson(l)} disabled={busy !== null}>
                    <span className="lesson-n">{l.label ?? l.n}</span>
                    <span className="lesson-t">{l.title}{l.topics && <small>{l.topics}</small>}</span>
                    {isOpen && <span className="lesson-open" title="Staat al open">●</span>}
                    {busy === l.n && <span className="lesson-open">…</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
