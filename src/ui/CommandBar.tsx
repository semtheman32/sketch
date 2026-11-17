import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icons'

export interface Command {
  id: string
  label: string
  group: string
  /** Shortcut shown on the right, like "Ctrl+Z". */
  keys?: string
  /** Extra words to match, e.g. "dark night" for a theme. */
  hint?: string
  run: () => void
}

/** Score how well `q` matches `text`: letters in order, bonus for word starts and contiguous runs. */
function score(q: string, text: string): number {
  if (!q) return 1
  const t = text.toLowerCase()
  const i0 = t.indexOf(q)
  if (i0 === 0) return 100
  if (i0 > 0) return 80 - i0 + (t[i0 - 1] === ' ' ? 10 : 0)
  let s = 0, ti = 0, run = 0
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at < 0) return 0
    run = at === ti ? run + 1 : 0
    s += 1 + run + (at === 0 || t[at - 1] === ' ' ? 3 : 0)
    ti = at + 1
  }
  return s
}

/**
 * Ctrl+K: one box for every tool, action, theme and template. Typing something that isn't a
 * command offers to add it as a molecule or ask Claude about it.
 */
export function CommandBar({ commands, extra, onClose }: {
  commands: Command[]
  /** Commands built from the typed text (add molecule, ask Claude). */
  extra: (query: string) => Command[]
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    const ranked = commands
      .map(c => ({ c, s: Math.max(score(query, c.label), score(query, `${c.group} ${c.hint ?? ''}`) * 0.6) }))
      .filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(r => r.c)
    const top = query ? ranked.slice(0, 40) : ranked
    return query ? [...top, ...extra(q.trim())] : top
  }, [q, commands, extra])

  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (c?: Command) => { if (!c) return; onClose(); c.run() }

  let lastGroup = ''
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-label="Command bar">
        <div className="palette-input">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={q}
            placeholder="Type a command, a molecule, or a question for Claude…"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(results[active]) }
              else if (e.key === 'Escape') onClose()
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <p className="palette-empty">No matches</p>}
          {results.map((c, i) => {
            const head = !q.trim() && c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            return (
              <div key={c.id}>
                {head && <div className="palette-group">{head}</div>}
                <button
                  data-i={i}
                  className={'palette-item' + (i === active ? ' on' : '')}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  <span>{c.label}</span>
                  {q.trim() && <span className="palette-tag">{c.group}</span>}
                  {c.keys && <kbd>{c.keys}</kbd>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
