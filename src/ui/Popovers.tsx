import { useState } from 'react'
import { THEMES, setTheme, useTheme } from './themes'
import { STYLES, setDrawStyle, useDrawStyle } from '../render/styles'
import { AMINO_ACIDS, MECHANISMS, RINGS, type MechanismTemplate, type StructureTemplate } from '../templates'
import { ABBREVIATIONS } from '../chem/abbrev'
import { Icon } from './Icons'

/** Theme and drawing-style picker. */
export function ThemeMenu({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  const style = useDrawStyle()
  return (
    <div className="popover theme-menu" role="dialog" aria-label="Appearance">
      <div className="popover-title">Theme</div>
      <div className="theme-grid">
        {THEMES.map(t => (
          <button key={t.id} className={'theme-card' + (theme === t.id ? ' on' : '')} onClick={() => setTheme(t.id)} aria-pressed={theme === t.id}>
            <span className="theme-swatch" style={{ background: t.swatch[0] }}>
              <svg viewBox="0 0 40 24" aria-hidden="true">
                <path d="M8 16 L14 12 L20 16 L26 12" fill="none" stroke={t.swatch[1]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="32" cy="9" r="3" fill={t.swatch[2]} />
              </svg>
            </span>
            <span className="theme-name">{t.name}</span>
            <span className="theme-note">{t.note}</span>
          </button>
        ))}
      </div>
      <div className="popover-title">Drawing style</div>
      <div className="style-list">
        {STYLES.map(s => (
          <button key={s.id} className={'style-item' + (style.id === s.id ? ' on' : '')} onClick={() => setDrawStyle(s.id)}>
            <span className="style-name">{s.name}</span>
            <span className="muted small">{s.note}</span>
          </button>
        ))}
      </div>
      <p className="muted small popover-foot">The theme only changes the screen. Exports always use white paper and the drawing style.</p>
      <button className="icon-btn popover-close" onClick={onClose} aria-label="Close appearance"><Icon name="close" size={14} /></button>
    </div>
  )
}

type Tab = 'rings' | 'amino' | 'groups' | 'mechanisms'

/** Rings, amino acids, group abbreviations and mechanism templates. */
export function TemplatesPanel({ onClose, onStructure, onMechanism, onGroup }: {
  onClose: () => void
  onStructure: (t: StructureTemplate) => void
  onMechanism: (t: MechanismTemplate) => void
  onGroup: (label: string) => void
}) {
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('chemsketch-clone:templates-tab') as Tab) || 'rings' } catch { return 'rings' }
  })
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('chemsketch-clone:templates-tab', t) } catch { /* ignore */ } }
  return (
    <div className="popover templates" role="dialog" aria-label="Templates">
      <div className="seg-row tabs">
        <button className={'seg' + (tab === 'rings' ? ' on' : '')} onClick={() => pick('rings')}>Rings</button>
        <button className={'seg' + (tab === 'amino' ? ' on' : '')} onClick={() => pick('amino')}>Amino acids</button>
        <button className={'seg' + (tab === 'groups' ? ' on' : '')} onClick={() => pick('groups')}>Groups</button>
        <button className={'seg' + (tab === 'mechanisms' ? ' on' : '')} onClick={() => pick('mechanisms')}>Mechanisms</button>
      </div>
      {tab === 'rings' && <div className="tpl-grid">{RINGS.map(t => <button key={t.name} className="tpl" onClick={() => onStructure(t)}>{t.name}</button>)}</div>}
      {tab === 'amino' && <div className="tpl-grid">{AMINO_ACIDS.map(t => <button key={t.name} className="tpl" onClick={() => onStructure(t)}>{t.name}</button>)}</div>}
      {tab === 'groups' && (
        <>
          <p className="muted small tpl-help">Pick a group, then click atoms to replace them. You can also hover an atom and type the name (Ph, Boc, OMe…).</p>
          <div className="tpl-grid groups">
            {ABBREVIATIONS.map(a => (
              <button key={a.label} className="tpl group" title={a.name} onClick={() => onGroup(a.label)}>
                <b>{a.label.replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[+d])}</b><span>{a.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {tab === 'mechanisms' && (
        <div className="tpl-list">
          {MECHANISMS.map(m => (
            <button key={m.name} className="tpl wide" onClick={() => onMechanism(m)}>
              <b>{m.name}</b><span>{m.note}</span>
            </button>
          ))}
        </div>
      )}
      <button className="icon-btn popover-close" onClick={onClose} aria-label="Close templates"><Icon name="close" size={14} /></button>
    </div>
  )
}
