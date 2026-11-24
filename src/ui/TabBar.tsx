import { useRef, useState } from 'react'
import { closeTab, getDoc, isEmptyDoc, moveTab, newTab, renameTab, switchTab, useTabs } from '../model/store'
import { Icon } from './Icons'
import { LessonMenu } from './LessonMenu'
import { PresetButton } from './PresetButton'

/** Browser-style tabs above the canvas: each tab is its own drawing with its own undo history. */
export function TabBar({ onLessonOpened }: { onLessonOpened?: () => void } = {}) {
  const tabs = useTabs()
  const [renaming, setRenaming] = useState<string | null>(null)
  const drag = useRef<string | null>(null)

  const close = (id: string) => {
    const t = tabs.find(x => x.id === id)
    if (!t) return
    const empty = t.active ? isEmptyDoc(getDoc()) : t.empty
    if (!empty && !confirm(`Close “${t.name}”? Its drawing will be gone.`)) return
    closeTab(id)
  }

  return (
    <div className="tabbar" role="tablist" aria-label="Drawings">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.active}
          className={'tab' + (t.active ? ' on' : '')}
          title={`${t.name}${i < 9 ? ` (Alt+${i + 1})` : ''}. Double-click to rename.`}
          draggable={renaming !== t.id}
          onDragStart={e => { drag.current = t.id; e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={e => { if (drag.current) e.preventDefault() }}
          onDrop={e => { e.preventDefault(); if (drag.current && drag.current !== t.id) moveTab(drag.current, i); drag.current = null }}
          onDragEnd={() => { drag.current = null }}
          onMouseDown={e => { if (e.button === 0) switchTab(t.id) }}
          onAuxClick={e => { if (e.button === 1) { e.preventDefault(); close(t.id) } }}
          onDoubleClick={() => setRenaming(t.id)}
        >
          {renaming === t.id ? (
            <input
              className="tab-name-input"
              defaultValue={t.name}
              autoFocus
              onFocus={e => e.target.select()}
              onMouseDown={e => e.stopPropagation()}
              onBlur={e => { renameTab(t.id, e.target.value); setRenaming(null) }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                else if (e.key === 'Escape') setRenaming(null)
                e.stopPropagation()
              }}
            />
          ) : (
            <span className="tab-name">{t.name}</span>
          )}
          <button
            className="tab-close"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => close(t.id)}
            title="Close tab (Alt+W)"
            aria-label={`Close ${t.name}`}
          ><Icon name="close" size={12} /></button>
        </div>
      ))}
      <button className="tab-new" onClick={() => newTab()} title="New tab (Alt+T)" aria-label="New tab"><Icon name="plus" size={15} /></button>
      <div className="tabbar-tools">
        <PresetButton onOpened={onLessonOpened} />
        <LessonMenu onOpened={onLessonOpened} />
      </div>
    </div>
  )
}
