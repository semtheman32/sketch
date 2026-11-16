import { useState, type ReactNode } from 'react'
import type { ArrowKind, BondOrder, BondStereo, Doc, ID, TextStyle } from '../model/types'
import { kindOf } from '../model/types'
import { commit } from '../model/store'
import { TextStyleBar } from './TextStyleBar'
import { normaliseSymbol } from '../chem/elements'
import type { AtomMode, Tool, ToolOptions } from './tools'

interface Props {
  tool: Tool
  opts: ToolOptions
  setOpts: (o: Partial<ToolOptions>) => void
  doc: Doc
  selection: ID[]
}

function Seg<T>({ items, value, onPick }: { items: { v: T; label: string; title?: string }[]; value: T; onPick: (v: T) => void }) {
  return (
    <>
      {items.map(it => (
        <button
          key={it.label}
          className={'seg' + (it.v === value ? ' on' : '')}
          title={it.title ?? it.label}
          onClick={() => onPick(it.v)}
        >{it.label}</button>
      ))}
    </>
  )
}

const ELEMENTS = ['C', 'H', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I']

export function OptionsBar({ tool, opts, setOpts, doc, selection }: Props) {
  const [custom, setCustom] = useState('')
  let body: ReactNode = null
  const selectedTexts = (tool === 'select' || tool === 'text') ? selection.filter(id => kindOf(id) === 'text' && doc.texts[id]) : []

  if (tool === 'bond') {
    const bondKey = opts.bondStereo !== 'none' ? opts.bondStereo : String(opts.bondOrder)
    body = (
      <Seg
        value={bondKey}
        onPick={v => {
          if (v === 'wedge' || v === 'dash') setOpts({ bondStereo: v as BondStereo, bondOrder: 1 })
          else setOpts({ bondStereo: 'none', bondOrder: Number(v) as BondOrder })
        }}
        items={[
          { v: '1', label: 'Single', title: 'Single bond (1)' },
          { v: '2', label: 'Double', title: 'Double bond (2)' },
          { v: '3', label: 'Triple', title: 'Triple bond (3)' },
          { v: 'wedge', label: 'Wedge', title: 'Bond toward you' },
          { v: 'dash', label: 'Dash', title: 'Bond away from you' },
        ]}
      />
    )
  } else if (tool === 'atom') {
    const pick = (m: AtomMode, element?: string) => setOpts(element ? { atomMode: m, element } : { atomMode: m })
    body = (
      <>
        {ELEMENTS.map(el => (
          <button key={el} className={'seg el' + (opts.atomMode === 'element' && opts.element === el ? ' on' : '')} onClick={() => pick('element', el)}>{el}</button>
        ))}
        <input
          className="seg-input"
          placeholder="Other"
          value={custom}
          maxLength={2}
          onChange={e => {
            setCustom(e.target.value)
            const sym = normaliseSymbol(e.target.value)
            if (sym) pick('element', sym)
          }}
        />
        <span className="divider" />
        <Seg<AtomMode>
          value={opts.atomMode}
          onPick={m => pick(m)}
          items={[
            { v: 'plus', label: '+', title: 'Add positive charge' },
            { v: 'minus', label: '−', title: 'Add negative charge' },
            { v: 'lonepair', label: ':', title: 'Add a lone pair (click again for more)' },
            { v: 'radical', label: '•', title: 'Toggle radical' },
          ]}
        />
      </>
    )
  } else if (tool === 'ring') {
    body = (
      <Seg
        value={opts.ringSize === 6 && opts.ringAromatic ? 'benzene' : String(opts.ringSize)}
        onPick={v => setOpts(v === 'benzene' ? { ringSize: 6, ringAromatic: true } : { ringSize: Number(v), ringAromatic: false })}
        items={[
          { v: 'benzene', label: 'Benzene' },
          { v: '3', label: '3' }, { v: '4', label: '4' }, { v: '5', label: '5' },
          { v: '6', label: '6' }, { v: '7', label: '7' }, { v: '8', label: '8' },
        ]}
      />
    )
  } else if (tool === 'arrow') {
    body = (
      <Seg<ArrowKind>
        value={opts.arrowKind}
        onPick={v => setOpts({ arrowKind: v })}
        items={[
          { v: 'forward', label: '→', title: 'Reaction' },
          { v: 'equilibrium', label: '⇌', title: 'Equilibrium' },
          { v: 'resonance', label: '↔', title: 'Resonance' },
          { v: 'retro', label: '⇒', title: 'Retrosynthesis' },
        ]}
      />
    )
  } else if (selectedTexts.length) {
    // Restyle selected labels (with any tool except those that have their own options above)
    const first = doc.texts[selectedTexts[0]]
    const style: TextStyle = { color: first.color, bold: first.bold, italic: first.italic, size: first.size }
    body = (
      <>
        <span className="muted small" style={{ padding: '0 6px' }}>{selectedTexts.length === 1 ? 'Label' : `${selectedTexts.length} labels`}</span>
        <TextStyleBar style={style} onChange={s => commit(d => { for (const id of selectedTexts) Object.assign(d.texts[id], s) })} />
      </>
    )
  } else if (tool === 'text') {
    body = (
      <>
        <span className="muted small" style={{ padding: '0 6px' }}>New labels</span>
        <TextStyleBar style={opts.textStyle} onChange={s => setOpts({ textStyle: s })} />
      </>
    )
  } else if (tool === 'curly') {
    body = (
      <Seg
        value={opts.curlyHalf}
        onPick={v => setOpts({ curlyHalf: v })}
        items={[
          { v: false, label: 'Electron pair', title: 'Full arrowhead (2 electrons)' },
          { v: true, label: 'Single electron', title: 'Fishhook arrowhead (1 electron)' },
        ]}
      />
    )
  }

  if (!body) return null
  return <div className="options">{body}</div>
}
