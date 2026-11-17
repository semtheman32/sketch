import { useEffect, useMemo, useState } from 'react'
import type { Doc, ID } from '../model/types'
import { STYLES, styleById, useDrawStyle } from '../render/styles'
import { copyImage, download, exportDoc, exportMolfile, exportPngBlob, exportSvg, moleculeSummaries } from '../actions'
import { Icon } from './Icons'

type Format = 'png' | 'svg' | 'mol' | 'smiles' | 'json'

const FORMATS: { v: Format; label: string; note: string }[] = [
  { v: 'png', label: 'PNG', note: 'Image for documents and slides' },
  { v: 'svg', label: 'SVG', note: 'Sharp at any size, editable in Illustrator' },
  { v: 'mol', label: 'MOL', note: 'Structure file for other chemistry software' },
  { v: 'smiles', label: 'SMILES', note: 'One line of text per molecule' },
  { v: 'json', label: 'Sketch', note: 'The whole drawing, to open here again' },
]

/** Export with a live preview: format, drawing style, background, size, selection only. */
export function ExportPanel({ doc, selection, onClose, flash }: {
  doc: Doc; selection: ID[]; onClose: () => void; flash: (msg: string) => void
}) {
  const current = useDrawStyle()
  const [format, setFormat] = useState<Format>('png')
  const [styleId, setStyleId] = useState(current.id)
  const [transparent, setTransparent] = useState(false)
  const [scale, setScale] = useState(3)
  const [onlySel, setOnlySel] = useState(selection.length > 0)
  const [text, setText] = useState('')

  const ids = onlySel && selection.length ? selection : undefined
  const style = styleById(styleId)
  const isImage = format === 'png' || format === 'svg'
  const empty = !Object.keys(exportDoc(doc, ids).atoms).length && !Object.keys(exportDoc(doc, ids).arrows).length && !Object.keys(exportDoc(doc, ids).texts).length

  const svg = useMemo(() => exportSvg(doc, { style, transparent, ids }), [doc, style, transparent, ids])
  const size = useMemo(() => {
    const m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg)
    return m ? { w: Math.ceil(parseFloat(m[1]) * scale), h: Math.ceil(parseFloat(m[2]) * scale) } : null
  }, [svg, scale])

  // Text formats preview their content.
  useEffect(() => {
    let live = true
    if (format === 'mol') exportMolfile(doc, ids).then(t => { if (live) setText(t) })
    else if (format === 'smiles') moleculeSummaries(exportDoc(doc, ids)).then(ms => { if (live) setText(ms.map(m => m.smiles).filter(Boolean).join('.')) })
    else if (format === 'json') setText(JSON.stringify(exportDoc(doc, ids), null, 2).slice(0, 2000))
    return () => { live = false }
  }, [format, doc, ids])

  const save = async () => {
    try {
      if (format === 'png') download('drawing.png', await exportPngBlob(doc, scale, { style, transparent, ids }))
      else if (format === 'svg') download('drawing.svg', svg, 'image/svg+xml')
      else if (format === 'mol') download('drawing.mol', await exportMolfile(doc, ids), 'chemical/x-mdl-molfile')
      else if (format === 'json') download('drawing.chem.json', JSON.stringify(exportDoc(doc, ids), null, 2), 'application/json')
      else {
        await navigator.clipboard.writeText(text)
        flash(`Copied ${text}`)
      }
      if (format !== 'smiles') { flash('Downloaded'); onClose() }
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Export failed')
    }
  }

  const copyImg = async () => {
    try { await copyImage(doc, { style, transparent, ids }); flash('Image copied. Paste it into Word, PowerPoint or Docs'); onClose() }
    catch { flash("Your browser didn't allow copying an image. Use Download instead.") }
  }

  return (
    <div className="popover export-panel" role="dialog" aria-label="Export">
      <div className="export-preview" data-checker={transparent && isImage ? '' : undefined}>
        {empty ? <p className="muted">Nothing to export yet</p>
          : isImage ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="Export preview" />
            : <pre>{text || '…'}</pre>}
      </div>
      <div className="export-controls">
        <label className="field-label" htmlFor="export-format">Format</label>
        <div className="seg-row" id="export-format">
          {FORMATS.map(f => (
            <button key={f.v} className={'seg' + (format === f.v ? ' on' : '')} title={f.note} onClick={() => setFormat(f.v)}>{f.label}</button>
          ))}
        </div>
        <p className="muted small">{FORMATS.find(f => f.v === format)!.note}</p>

        {isImage && (
          <>
            <label className="field-label">Style</label>
            <div className="seg-row">
              {STYLES.map(s => (
                <button key={s.id} className={'seg' + (styleId === s.id ? ' on' : '')} title={s.note} onClick={() => setStyleId(s.id)}>{s.name}</button>
              ))}
            </div>
            <div className="export-row">
              <label className="check"><input type="checkbox" checked={transparent} onChange={e => setTransparent(e.target.checked)} /> Transparent background</label>
            </div>
            {format === 'png' && (
              <div className="export-row">
                <span className="field-label inline">Size</span>
                {[1, 2, 3, 4].map(k => (
                  <button key={k} className={'seg' + (scale === k ? ' on' : '')} onClick={() => setScale(k)}>{k}×</button>
                ))}
                {size && <span className="muted small tabular">{size.w} × {size.h} px</span>}
              </div>
            )}
          </>
        )}
        {selection.length > 0 && (
          <label className="check"><input type="checkbox" checked={onlySel} onChange={e => setOnlySel(e.target.checked)} /> Selection only</label>
        )}
        <div className="export-actions">
          {isImage && <button className="btn" onClick={copyImg} disabled={empty}><Icon name="copy" size={15} />Copy image</button>}
          <button className="btn primary" onClick={save} disabled={empty}>
            <Icon name="download" size={15} />{format === 'smiles' ? 'Copy SMILES' : 'Download'}
          </button>
        </div>
      </div>
      <button className="icon-btn popover-close" onClick={onClose} aria-label="Close export"><Icon name="close" size={14} /></button>
    </div>
  )
}
