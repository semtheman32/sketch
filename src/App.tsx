import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { BondOrder, Doc, ID } from './model/types'
import { emptyDoc, kindOf } from './model/types'
import { canRedo, canUndo, commit, getDoc, redo, replaceDoc, undo, useDoc } from './model/store'
import { applyBondStyle, contentBounds, growBond, removeItems, straightenTriple } from './model/ops'
import { ValenceError } from './chem/valence'
import { adjacency, components, formulaOf } from './chem/chem'
import { writeMolfile } from './chem/molfile'
import { Canvas, type EditTarget, type View } from './render/Canvas'
import { OptionsBar } from './ui/OptionsBar'
import { ClaudePanel } from './ui/ClaudePanel'
import { Icon } from './ui/Icons'
import { TOOLS, defaultOptions, type Tool, type ToolOptions } from './ui/tools'
import { addMolecule, cleanStructures, download, exportPngDataUrl, exportSvg, moleculeSummaries } from './actions'
import { startBridge, useBridge } from './bridge/client'

const LETTER_ELEMENTS: Record<string, string> = { c: 'C', n: 'N', o: 'O', s: 'S', p: 'P', f: 'F', h: 'H', i: 'I', b: 'B', l: 'Cl', r: 'Br' }
const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map(t => [t.key.toLowerCase(), t.id]))

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('chemsketch-clone:theme')
    if (t === 'light' || t === 'dark') return t
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const doc = useDoc()
  const bridge = useBridge()
  const [tool, setTool] = useState<Tool>('bond')
  const [opts, setOptsState] = useState<ToolOptions>(defaultOptions)
  const [selection, setSelection] = useState<ID[]>([])
  const [hover, setHover] = useState<ID | null>(null)
  const [view, setView] = useState<View>({ x: 400, y: 300, k: 1.4 })
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [claudeOpen, setClaudeOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [spaceDown, setSpaceDown] = useState(false)
  const [molInput, setMolInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const setOpts = useCallback((o: Partial<ToolOptions>) => setOptsState(s => ({ ...s, ...o })), [])

  useEffect(() => { startBridge() }, [])

  // Edits that would over-bond an atom are refused in commit(); explain why instead of failing silently.
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (e.error instanceof ValenceError) { e.preventDefault(); setToast(e.error.message) }
    }
    window.addEventListener('error', onError)
    return () => window.removeEventListener('error', onError)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('chemsketch-clone:theme', theme) } catch { /* ignore */ }
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Drop selection/hover ids that no longer exist (after undo, erase, Claude edits).
  useEffect(() => {
    const exists = (id: ID) => {
      const k = kindOf(id)
      return k === 'atom' ? !!doc.atoms[id] : k === 'bond' ? !!doc.bonds[id] : k === 'arrow' ? !!doc.arrows[id] : k === 'curly' ? !!doc.curlies[id] : !!doc.texts[id]
    }
    setSelection(s => (s.every(exists) ? s : s.filter(exists)))
    setHover(h => (h && !exists(h) ? null : h))
  }, [doc])

  const fit = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const b = contentBounds(getDoc())
    if (!b) { setView({ x: width / 2, y: height / 2, k: 1.4 }); return }
    const pad = 80
    const k = Math.min(2.2, Math.max(0.3, Math.min((width - pad * 2) / Math.max(b.x2 - b.x1, 1), (height - pad * 2) / Math.max(b.y2 - b.y1, 1))))
    setView({ k, x: width / 2 - ((b.x1 + b.x2) / 2) * k, y: height / 2 - ((b.y1 + b.y2) / 2) * k })
  }, [])

  useEffect(() => { fit() }, [fit])

  const flash = (msg: string) => setToast(msg)

  const submitMolecule = async () => {
    if (!molInput.trim() || busy) return
    setBusy(true)
    try {
      const res = await addMolecule(molInput)
      setSelection(res.atomIds)
      setMolInput('')
      requestAnimationFrame(fit)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const doClean = async () => {
    const atoms = selection.filter(id => kindOf(id) === 'atom')
    setBusy(true)
    try {
      const n = await cleanStructures(atoms)
      flash(n ? `Cleaned ${n} structure${n > 1 ? 's' : ''}` : 'Nothing to clean')
    } catch { flash("Couldn't load the chemistry engine") }
    finally { setBusy(false) }
  }

  const doExport = async (format: 'png' | 'svg' | 'mol' | 'smiles' | 'json') => {
    setExportOpen(false)
    const d = getDoc()
    if (!Object.keys(d.atoms).length && format !== 'json' && format !== 'png' && format !== 'svg') { flash('Draw a molecule first'); return }
    if (format === 'svg') download('drawing.svg', exportSvg(d), 'image/svg+xml')
    else if (format === 'png') {
      const url = await exportPngDataUrl(d, 3)
      download('drawing.png', await (await fetch(url)).blob())
    } else if (format === 'mol') download('drawing.mol', writeMolfile(d), 'chemical/x-mdl-molfile')
    else if (format === 'json') download('drawing.chem.json', JSON.stringify(d, null, 2), 'application/json')
    else {
      const smiles = (await moleculeSummaries(d)).map(m => m.smiles).filter(Boolean).join('.')
      try { await navigator.clipboard.writeText(smiles); flash(`Copied ${smiles}`) } catch { flash(smiles) }
    }
  }

  const openFile = async (f: File) => {
    const text = await f.text()
    try {
      if (/\.(mol|sdf)$/i.test(f.name)) await addMolecule(text.split('$$$$')[0], undefined, 'molfile')
      else replaceDoc(JSON.parse(text) as Doc)
      requestAnimationFrame(fit)
    } catch { flash(`Couldn't open ${f.name}`) }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && key === 'y') { e.preventDefault(); redo(); return }
      if (mod && key === 'a') {
        e.preventDefault()
        const d = getDoc()
        setSelection([...Object.keys(d.atoms), ...Object.keys(d.bonds), ...Object.keys(d.arrows), ...Object.keys(d.curlies), ...Object.keys(d.texts)])
        return
      }
      if (mod && key === 's') { e.preventDefault(); doExport('json'); return }
      if (mod) return
      if (e.key === ' ') { e.preventDefault(); setSpaceDown(true); return }
      if (e.key === 'Escape') { setSelection([]); setEditing(null); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = selection.length ? selection : hover ? [hover] : []
        if (ids.length) { commit(d => removeItems(d, ids)); setSelection([]) }
        return
      }
      if (hover && kindOf(hover) === 'atom') {
        const id = hover
        if (LETTER_ELEMENTS[key] && !e.altKey) {
          commit(d => { d.atoms[id].element = LETTER_ELEMENTS[key] }); return
        }
        if (e.key === '+' || e.key === '=') { commit(d => { d.atoms[id].charge++ }); return }
        if (e.key === '-') { commit(d => { d.atoms[id].charge-- }); return }
        if (['1', '2', '3'].includes(e.key)) { commit(d => { growBond(d, id, Number(e.key) as BondOrder) }); return }
      }
      if (hover && kindOf(hover) === 'bond') {
        const id = hover
        if (['1', '2', '3'].includes(e.key)) {
          commit(d => { d.bonds[id].order = Number(e.key) as BondOrder; d.bonds[id].stereo = 'none'; straightenTriple(d, id) })
          return
        }
        if (key === 'w') { commit(d => applyBondStyle(d, id, 1, 'wedge')); return }
        if (key === 'd') { commit(d => applyBondStyle(d, id, 1, 'dash')); return }
      }
      if (TOOL_KEYS[key]) { setTool(TOOL_KEYS[key]); return }
      if (/^[3-8]$/.test(e.key)) { setTool('ring'); setOpts({ ringSize: Number(e.key), ringAromatic: false }) }
    }
    const onUp = (e: KeyboardEvent) => { if (e.key === ' ') setSpaceDown(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp) }
  }, [hover, selection, setOpts])

  const status = useMemo(() => {
    const adj = adjacency(doc)
    const selAtoms = selection.filter(id => kindOf(id) === 'atom' && doc.atoms[id])
    const groups = selAtoms.length
      ? components(doc, adj).map(c => c.filter(id => selAtoms.includes(id))).filter(c => c.length)
      : components(doc, adj)
    return groups.slice(0, 4).map(g => formulaOf(doc, g, adj))
  }, [doc, selection])

  const toolInfo = TOOLS.find(t => t.id === tool)!
  const isEmpty = !Object.keys(doc.atoms).length && !Object.keys(doc.arrows).length && !Object.keys(doc.texts).length

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Icon name="flask" size={18} /><span>Sketch</span></div>
        <div className="group">
          <button className="icon-btn" onClick={() => undo()} disabled={!canUndo()} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
          <button className="icon-btn" onClick={() => redo()} disabled={!canRedo()} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo" /></button>
        </div>
        <form className="mol-input" onSubmit={e => { e.preventDefault(); submitMolecule() }}>
          <Icon name="plus" size={16} />
          <input
            value={molInput}
            onChange={e => setMolInput(e.target.value)}
            placeholder="Add a molecule: name or SMILES, like aspirin or CCO"
            disabled={busy}
          />
        </form>
        <div className="spacer" />
        <div className="group">
          <button className="icon-btn" onClick={doClean} title="Clean up structure" aria-label="Clean up"><Icon name="clean" /></button>
          <button className="icon-btn" onClick={fit} title="Fit to screen" aria-label="Fit to screen"><Icon name="fit" /></button>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Open file (.json, .mol)" aria-label="Open"><Icon name="open" /></button>
          <div className="menu-wrap">
            <button className="btn" onClick={() => setExportOpen(o => !o)}><Icon name="download" size={16} /><span className="label">Export</span></button>
            {exportOpen && (
              <div className="menu" onMouseLeave={() => setExportOpen(false)}>
                <button onClick={() => doExport('png')}>PNG image</button>
                <button onClick={() => doExport('svg')}>SVG image</button>
                <button onClick={() => doExport('mol')}>MOL file</button>
                <button onClick={() => doExport('smiles')}>Copy SMILES</button>
                <button onClick={() => doExport('json')}>Save drawing (.json)</button>
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            onClick={() => { if (confirm('Clear the canvas? You can undo this.')) replaceDoc(emptyDoc()) }}
            title="Clear canvas" aria-label="Clear canvas"
          ><Icon name="trash" /></button>
          <button className="icon-btn" onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))} title="Toggle theme" aria-label="Toggle theme">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button className={'btn claude-btn' + (claudeOpen ? ' on' : '')} onClick={() => setClaudeOpen(o => !o)}>
            <Icon name="sparkles" size={16} /><span className="label">Claude</span>
            <span className={'dot' + (bridge.connected ? ' on' : '')} />
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".json,.mol,.sdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '' }} />
      </header>

      <div className="body">
        <nav className="toolbar" aria-label="Tools">
          {TOOLS.map(t => (
            <button
              key={t.id}
              className={'tool' + (tool === t.id ? ' on' : '')}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
            ><Icon name={t.icon} /></button>
          ))}
        </nav>

        <main className="stage" ref={stageRef}>
          <OptionsBar tool={tool} opts={opts} setOpts={setOpts} />
          <Canvas
            tool={tool} opts={opts} view={view} setView={setView}
            selection={selection} setSelection={setSelection}
            hover={hover} setHover={setHover}
            onEdit={setEditing} spaceDown={spaceDown}
          />
          {isEmpty && (
            <div className="empty">
              <p className="big">Start drawing</p>
              <p>Click anywhere with the Bond tool, or type a molecule name above.</p>
            </div>
          )}
          {editing && <Editor target={editing} view={view} onDone={() => setEditing(null)} />}
          {toast && <div className="toast">{toast}</div>}
          <footer className="status">
            <span className="hint">{toolInfo.hint}</span>
            <span className="spacer" />
            {status.map((f, i) => (
              <span key={i} className="formula">{f.formula} <span className="muted">{f.mass.toFixed(2)} g/mol</span></span>
            ))}
            <span className="muted">{Math.round(view.k * 100 / 1.4)}%</span>
          </footer>
        </main>

        {claudeOpen && <ClaudePanel onClose={() => setClaudeOpen(false)} />}
      </div>
    </div>
  )
}

function Editor({ target, view, onDone }: { target: EditTarget; view: View; onDone: () => void }) {
  const doc = getDoc()
  const screen = (x: number, y: number) => ({ left: x * view.k + view.x, top: y * view.k + view.y })

  if (target.kind === 'text') {
    const t = doc.texts[target.id]
    if (!t) return null
    const finish = (value: string) => {
      commit(d => { if (value.trim()) d.texts[t.id].text = value; else delete d.texts[t.id] })
      onDone()
    }
    const pos = screen(t.x, t.y)
    return (
      <input
        className="editor" autoFocus defaultValue={t.text} placeholder="Label"
        style={{ left: pos.left - 6, top: pos.top - 22 }}
        onBlur={e => finish(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { if (target.isNew) finish(''); else onDone() } }}
      />
    )
  }

  if (target.kind === 'atom') {
    const a = doc.atoms[target.id]
    if (!a) return null
    const pos = screen(a.x, a.y)
    const finish = (value: string) => {
      const sym = value.trim()
      if (sym) {
        const norm = sym[0].toUpperCase() + sym.slice(1).toLowerCase()
        commit(d => { d.atoms[a.id].element = norm })
      }
      onDone()
    }
    return (
      <input
        className="editor small" autoFocus defaultValue={a.element} maxLength={3}
        style={{ left: pos.left - 20, top: pos.top - 14 }}
        onFocus={e => e.target.select()}
        onBlur={e => finish(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') onDone() }}
      />
    )
  }

  const r = doc.arrows[target.id]
  if (!r) return null
  const pos = screen((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2)
  let above = r.above, below = r.below
  const save = () => { commit(d => { d.arrows[r.id].above = above.trim(); d.arrows[r.id].below = below.trim() }); onDone() }
  return (
    <div
      className="arrow-editor" style={{ left: pos.left, top: pos.top }}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onDone() }}
    >
      <input autoFocus defaultValue={r.above} placeholder="Above the arrow, like H₂SO₄" onChange={e => { above = e.target.value }} />
      <input defaultValue={r.below} placeholder="Below the arrow, like heat" onChange={e => { below = e.target.value }} />
      <div className="row"><button className="btn" onClick={onDone}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </div>
  )
}
