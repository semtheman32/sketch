import type { TextStyle } from '../model/types'

export const TEXT_COLORS: { v: string; label: string }[] = [
  { v: '', label: 'Default' },
  { v: '#d64545', label: 'Red' },
  { v: '#e07b22', label: 'Orange' },
  { v: '#2e9e5b', label: 'Green' },
  { v: '#3b6fd4', label: 'Blue' },
  { v: '#7b4fc9', label: 'Purple' },
]

export const TEXT_SIZES: { v: number; label: string }[] = [
  { v: 11, label: 'S' }, { v: 14, label: 'M' }, { v: 18, label: 'L' }, { v: 24, label: 'XL' },
]

/**
 * Bold / italic / size / colour controls for text labels.
 * Buttons don't take focus, so an open text box keeps its cursor while you style it.
 */
export function TextStyleBar({ style, onChange }: { style: TextStyle; onChange: (s: TextStyle) => void }) {
  const keep = (e: React.MouseEvent) => e.preventDefault()
  const size = style.size ?? 14
  return (
    <>
      <button className={'seg' + (style.bold ? ' on' : '')} title="Bold (Ctrl+B)" onMouseDown={keep}
        onClick={() => onChange({ ...style, bold: !style.bold })}><b>B</b></button>
      <button className={'seg' + (style.italic ? ' on' : '')} title="Italic (Ctrl+I)" onMouseDown={keep}
        onClick={() => onChange({ ...style, italic: !style.italic })}><i>I</i></button>
      <span className="divider" />
      {TEXT_SIZES.map(s => (
        <button key={s.v} className={'seg' + (size === s.v ? ' on' : '')} title={`Size ${s.v}`} onMouseDown={keep}
          onClick={() => onChange({ ...style, size: s.v })}>{s.label}</button>
      ))}
      <span className="divider" />
      {TEXT_COLORS.map(c => (
        <button
          key={c.label}
          className={'swatch' + ((style.color ?? '') === c.v ? ' on' : '')}
          title={c.label}
          aria-label={`${c.label} colour`}
          onMouseDown={keep}
          onClick={() => onChange({ ...style, color: c.v })}
        ><span style={{ background: c.v || 'var(--ink)' }} /></button>
      ))}
    </>
  )
}
