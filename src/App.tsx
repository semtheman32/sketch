import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import type { BondOrder, Doc, ID, TextStyle } from './model/types'
import { allIds, emptyDoc, exists, kindOf } from './model/types'
import { canRedo, canUndo, closeTab, commit, cycleTab, getDoc, isEmptyDoc, newId, newTab, redo, replaceDoc, switchTab, undo, useDoc, useTabs } from './model/store'
import { TabBar } from './ui/TabBar'
import { openLesson, lessonTabName, useLessons } from './ui/LessonMenu'
import { openPreset } from './ui/PresetButton'
import { TextStyleBar } from './ui/TextStyleBar'
import {
  applyBondStyle, contentBounds, copyItems, flipItems, growBond, pasteFragment, removeItems, rotateItems, selectionBounds, straightenTriple,
} from './model/ops'
import { ValenceError } from './chem/valence'
import { adjacency, components, formulaOf } from './chem/chem'
import { findAbbrev, isAbbrevPrefix } from './chem/abbrev'
import { Canvas, type EditTarget, type View } from './render/Canvas'
import { OptionsBar } from './ui/OptionsBar'
import { ClaudePanel, type ClaudeTab } from './ui/ClaudePanel'
import { onOpenPractice } from './bridge/client'
import { onPracticeDrawn } from './chat/practice'
import { Icon } from './ui/Icons'
import { CommandBar, type Command } from './ui/CommandBar'
import { ExportPanel } from './ui/ExportPanel'
import { TemplatesPanel, ThemeMenu } from './ui/Popovers'
import { THEMES, setTheme } from './ui/themes'
import { STYLES, setDrawStyle } from './render/styles'
import { TOOLS, defaultOptions, type Tool, type ToolOptions } from './ui/tools'
import { addMolecule, cleanStructures, copyImage, download, expandInDoc, prepareGroups } from './actions'
import { AMINO_ACIDS, MECHANISMS, RINGS, insertMechanism, insertTemplate, type MechanismTemplate, type StructureTemplate } from './templates'
import { startBridge, useBridge } from './bridge/client'
import { loadRDKit } from './chem/rdkit'
import { newChat, sendChat } from './chat/chat'

const LETTER_ELEMENTS: Record<string, string> = { c: 'C', n: 'N', o: 'O', s: 'S', p: 'P', f: 'F', h: 'H', i: 'I', b: 'B', l: 'Cl', r: 'Br' }
const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map(t => [t.key.toLowerCase(), t.id]))
const CLIP_MARK = 'sketch-clipboard'

type Popover = 'export' | 'theme' | 'templates' | null

export default function App() {
  const doc = useDoc()
  const bridge = useBridge()
  const [tool, setTool] = useState<Tool>('bond')
  const [opts, setOptsState] = useState<ToolOptions>(defaultOptions)
  const [selection, setSelection] = useState<ID[]>([])
  /** What the pointer is over. Kept by the canvas, so hovering doesn't re-render the whole app. */
  const hoverRef = useRef<ID | null>(null)
  const [view, setView] = useState<View>({ x: 400, y: 300, k: 1.4 })
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [claudeOpen, setClaudeOpen] = useState(false)
  const [claudeTab, setClaudeTab] = useState<ClaudeTab>(() => { try { return localStorage.getItem('sketch-claude-tab') === 'practice' ? 'practice' : 'chat' } catch { return 'chat' } })
  const chooseTab = useCallback((t: ClaudeTab) => { setClaudeTab(t); try { localStorage.setItem('sketch-claude-tab', t) } catch { /* ignore */ } }, [])
  const [spaceDown, setSpaceDown] = useState(false)
  const [molInput, setMolInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ msg: string; n: number } | null>(null)
  const [popover, setPopover] = useState<Popover>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /** What Ctrl+C copied, and how many times it has been pasted (each paste shifts a bit further). */
  const clip = useRef<{ frag: Doc; pastes: number } | null>(null)
  /** Letters typed over an atom, to recognise group names like "Boc" or "OMe". */
  const typed = useRef<{ text: string; at: number; atom: ID; timer?: number }>({ text: '', at: 0, atom: '' })
  /** Set on Ctrl+V; cleared by the paste event. If no paste event comes, we paste our own copy. */
  const pendingPaste = useRef<number | undefined>(undefined)

  const setOpts = useCallback((o: Partial<ToolOptions>) => setOptsState(s => ({ ...s, ...o })), [])
  const flash = useCallback((msg: string) => setToast(t => ({ msg, n: (t?.n ?? 0) + 1 })), [])
  const toggle = (p: Exclude<Popover, null>) => setPopover(cur => (cur === p ? null : p))

  useEffect(() => { startBridge() }, [])

  // Load the chemistry engine (a few MB of WebAssembly) while the app is idle, so the first
  // molecule, clean-up or SMILES isn't slow.
  useEffect(() => {
    const start = () => { loadRDKit().catch(() => { /* retried on first real use */ }) }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(start, { timeout: 2500 })
    else setTimeout(start, 800)
  }, [])

  // Edits that would over-bond an atom are refused in commit(); explain why instead of failing silently.
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (e.error instanceof ValenceError) { e.preventDefault(); flash(e.error.message) }
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof ValenceError) { e.preventDefault(); flash(e.reason.message) }
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection) }
  }, [flash])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Drop selection/hover ids that no longer exist (after undo, erase, Claude edits).
  useEffect(() => {
    setSelection(s => (s.every(id => exists(doc, id)) ? s : s.filter(id => exists(doc, id))))
  }, [doc])

  const fit = useCallback((maxK = 2.2) => {
    const el = stageRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const b = contentBounds(getDoc())
    if (!b) { setView({ x: width / 2, y: height / 2, k: 1.4 }); return }
    const pad = 80
    const k = Math.min(maxK, Math.max(0.3, Math.min((width - pad * 2) / Math.max(b.x2 - b.x1, 1), (height - pad * 2) / Math.max(b.y2 - b.y1, 1))))
    setView({ k, x: width / 2 - ((b.x1 + b.x2) / 2) * k, y: height / 2 - ((b.y1 + b.y2) / 2) * k })
  }, [])
  /** Show the top of a tall sheet (a lesson) at a readable zoom: fit its width, but never below 0.6. */
  const fitTop = useCallback(() => {
    const el = stageRef.current
    const b = contentBounds(getDoc())
    if (!el || !b) return
    const { width } = el.getBoundingClientRect()
    const pad = 60
    const k = Math.min(1.2, Math.max(0.6, (width - pad * 2) / Math.max(b.x2 - b.x1, 1)))
    const x = (b.x2 - b.x1) * k <= width - pad * 2 ? width / 2 - ((b.x1 + b.x2) / 2) * k : pad - b.x1 * k
    setView({ k, x, y: pad - b.y1 * k })
  }, [])
  useEffect(() => {
    onOpenPractice(() => { setClaudeOpen(true); chooseTab('practice') })
    // A new exercise is drawn: show all of it, at a zoom that leaves room to draw the mechanism.
    onPracticeDrawn(() => requestAnimationFrame(() => fit(1.3)))
  }, [chooseTab, fit])

  useEffect(() => { fit() }, [fit])

  // Tabs: each tab remembers where you were looking. Switching clears the selection (ids repeat across drawings).
  const tabs = useTabs()
  const activeTab = tabs.find(t => t.active)?.id ?? ''
  const viewRef = useRef(view)
  viewRef.current = view
  const tabViews = useRef(new Map<string, View>())
  const shownTab = useRef(activeTab)
  useEffect(() => {
    if (shownTab.current === activeTab) return
    tabViews.current.set(shownTab.current, viewRef.current)
    shownTab.current = activeTab
    setSelection([])
    setEditing(null)
    const v = tabViews.current.get(activeTab)
    if (v) setView(v)
    else requestAnimationFrame(() => fit())
  }, [activeTab, fit])

  // Open a drawing passed in the URL: #doc=<base64url of the .chem.json>&name=<label>.
  // Used by the lesson-overview app ("Openen in Sketch"). Replaces the canvas (undoable).
  useEffect(() => {
    const load = () => {
      const params = new URLSearchParams(location.hash.slice(1))
      const data = params.get('doc')
      if (!data) return
      try {
        const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        const d = JSON.parse(new TextDecoder().decode(bytes)) as Doc
        const name = params.get('name')
        // A drawing from a link opens in its own tab, unless the current tab is still empty.
        if (isEmptyDoc(getDoc())) replaceDoc(d)
        else newTab(d, name ?? undefined)
        // Fit once the canvas has its size (on a fresh page load that can take a moment).
        requestAnimationFrame(() => fit())
        setTimeout(() => fit(), 400)
        flash(name ? `Opened ${name}` : 'Drawing opened')
      } catch { flash("Couldn't open the drawing from the link") }
      history.replaceState(null, '', location.pathname + location.search)
    }
    load()
    window.addEventListener('hashchange', load)
    return () => window.removeEventListener('hashchange', load)
  }, [fit, flash])

  /** Run an async action with the busy state and a friendly error. */
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { flash(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false) }
  }, [flash])

  /** A free spot in the part of the drawing you are looking at, so a new molecule lands in view. */
  const spotInView = useCallback((): { x: number; y: number } | undefined => {
    const el = stageRef.current
    const d = getDoc()
    if (!el || !Object.keys(d.atoms).length) return undefined
    const { width, height } = el.getBoundingClientRect()
    const v = viewRef.current
    const c = { x: (width / 2 - v.x) / v.k, y: (height / 2 - v.y) / v.k }
    const atoms = Object.values(d.atoms)
    const crowded = (p: { x: number; y: number }) => atoms.some(a => Math.abs(a.x - p.x) < 90 && Math.abs(a.y - p.y) < 60)
    // Walk outward from the middle of the screen until there is room.
    for (let r = 0; r < 12; r++) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1]]) {
      const p = { x: c.x + dx * r * 70, y: c.y + dy * r * 50 }
      if (!crowded(p)) return p
    }
    return c
  }, [])

  const addByName = useCallback((text: string) => run(async () => {
    const wasEmpty = isEmptyDoc(getDoc())
    const res = await addMolecule(text, spotInView())
    setSelection(res.atomIds)
    // Only zoom on an empty canvas; on a big sheet keep looking where you were.
    if (wasEmpty) requestAnimationFrame(() => fit())
  }), [run, fit, spotInView])

  const submitMolecule = async () => {
    if (!molInput.trim() || busy) return
    const text = molInput
    await addByName(text)
    setMolInput('')
    // Leave the box so keyboard shortcuts (hover + N, O, Boc…) work on the new molecule right away.
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const doClean = () => run(async () => {
    const { structures: n, texts: t } = await cleanStructures(selection.filter(id => kindOf(id) === 'atom'))
    const parts = [n && `cleaned ${n} structure${n > 1 ? 's' : ''}`, t && `moved ${t} label${t > 1 ? 's' : ''} off structures`].filter(Boolean)
    flash(parts.length ? parts.join(', ').replace(/^./, c => c.toUpperCase()) : 'Nothing to clean')
  })

  const addStructure = (t: StructureTemplate) => run(async () => {
    const ids = await insertTemplate(t)
    setSelection(ids)
    requestAnimationFrame(fit)
  })

  const addMechanism = (t: MechanismTemplate) => run(async () => {
    const ids = await insertMechanism(t)
    setSelection(ids)
    setTool('select')
    requestAnimationFrame(fit)
    flash(`${t.name} added. Undo removes it in one step.`)
  })

  const useGroup = (label: string) => {
    setTool('atom')
    setOpts({ atomMode: 'element', element: label })
    setPopover(null)
    flash(`Click atoms to make them ${label}`)
  }

  const expandGroups = (ids: ID[]) => run(async () => {
    await prepareGroups(getDoc(), ids)
    const atoms = commit(d => expandInDoc(d, ids))
    // Select the whole expanded molecule, so the formula and any next action cover the new atoms too.
    const d = getDoc()
    const mol = new Set(components(d).filter(c => c.some(a => atoms.includes(a))).flat())
    setSelection([...mol, ...Object.values(d.bonds).filter(b => mol.has(b.a1) && mol.has(b.a2)).map(b => b.id)])
  })

  // ------------------------------------------------------------ clipboard

  const copySelection = useCallback((cut = false) => {
    if (!selection.length) return false
    const frag = copyItems(getDoc(), selection)
    clip.current = { frag, pastes: 0 }
    navigator.clipboard?.writeText(JSON.stringify({ [CLIP_MARK]: 1, doc: frag })).catch(() => { /* internal copy still works */ })
    if (cut) { commit(d => removeItems(d, selection)); setSelection([]) }
    const n = Object.keys(frag.atoms).length
    flash(`${cut ? 'Cut' : 'Copied'} ${n ? `${n} atom${n > 1 ? 's' : ''}` : `${selection.length} item${selection.length > 1 ? 's' : ''}`}`)
    return true
  }, [selection, flash])

  const pasteFrag = useCallback((frag: Doc) => {
    const c = clip.current && clip.current.frag === frag ? clip.current : null
    const step = 24 * ((c?.pastes ?? 0) + 1)
    if (c) c.pastes++
    // Copied in another tab (or far away on a big sheet): paste in the middle of what you see, not off-screen.
    let dx = step, dy = step
    const b = contentBounds(frag), el = stageRef.current
    if (b && el) {
      const { width, height } = el.getBoundingClientRect()
      const v = viewRef.current
      const vx1 = -v.x / v.k, vy1 = -v.y / v.k, vx2 = (width - v.x) / v.k, vy2 = (height - v.y) / v.k
      const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2
      if (cx < vx1 || cx > vx2 || cy < vy1 || cy > vy2) { const spot = spotInView() ?? { x: (vx1 + vx2) / 2, y: (vy1 + vy2) / 2 }; dx = spot.x - cx; dy = spot.y - cy }
    }
    const ids = commit(d => pasteFragment(d, frag, dx, dy))
    setSelection(ids)
    setTool('select')
  }, [spotInView])

  const duplicate = useCallback(() => {
    if (!selection.length) return
    const frag = copyItems(getDoc(), selection)
    const ids = commit(d => pasteFragment(d, frag, 24, 24))
    setSelection(ids)
  }, [selection])

  // Paste: our own items, a SMILES, a molfile, or a name.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      clearTimeout(pendingPaste.current); pendingPaste.current = undefined
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      const text = e.clipboardData?.getData('text/plain')?.trim() ?? ''
      e.preventDefault()
      try {
        const data = JSON.parse(text)
        if (data?.[CLIP_MARK] && data.doc) {
          const frag = { ...emptyDoc(), ...data.doc } as Doc
          if (clip.current && JSON.stringify(clip.current.frag) === JSON.stringify(frag)) pasteFrag(clip.current.frag)
          else { clip.current = { frag, pastes: 0 }; pasteFrag(frag) }
          return
        }
      } catch { /* not ours */ }
      if (text) { addByName(text); return }
      if (clip.current) pasteFrag(clip.current.frag)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [pasteFrag, addByName])

  const copyAsImage = useCallback(async () => {
    try {
      await copyImage(getDoc(), { ids: selection.length ? selection : undefined, style: STYLES.find(s => s.id === localStorage.getItem('chemsketch-clone:style')) })
      flash(selection.length ? 'Selection copied as an image' : 'Drawing copied as an image')
    } catch { flash("Couldn't copy an image here. Use Export → Download instead.") }
  }, [selection, flash])

  const arrange = useCallback((fn: (d: Doc, ids: ID[]) => void) => {
    const ids = selection.length ? selection : allIds(getDoc())
    if (!ids.length) return
    commit(d => fn(d, ids))
  }, [selection])
  const rotateBy = useCallback((deg: number) => arrange((d, ids) => {
    const r = selectionBounds(d, ids)
    if (r) rotateItems(d, ids, { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 }, (deg * Math.PI) / 180)
  }), [arrange])

  const askClaude = useCallback((text: string) => {
    setClaudeOpen(true)
    sendChat(text)
  }, [])

  const saveJson = useCallback(() => {
    download('drawing.chem.json', JSON.stringify(getDoc(), null, 2), 'application/json')
    flash('Saved drawing.chem.json')
  }, [flash])

  const openFile = async (f: File) => {
    const text = await f.text()
    try {
      if (/\.(mol|sdf)$/i.test(f.name)) await addMolecule(text.split('$$$$')[0], undefined, 'molfile')
      else replaceDoc(JSON.parse(text) as Doc)
      requestAnimationFrame(fit)
    } catch { flash(`Couldn't open ${f.name}`) }
  }

  const selectAll = useCallback(() => setSelection(allIds(getDoc())), [])

  // ------------------------------------------------------------ commands (Ctrl+K)

  const { lessons } = useLessons()
  const commands = useMemo<Command[]>(() => [
    { id: 'preset-mechanismen', group: 'Lesstof', label: 'Preset: mechanismen tekenen', hint: 'alle OSY2-opdrachten, zonder antwoorden', run: () => { openPreset().then(() => { requestAnimationFrame(() => fitTop()); setTimeout(() => fitTop(), 300) }).catch(() => {}) } },
    ...(lessons ?? []).map(l => ({ id: `lesstof-${l.file}`, group: 'Lesstof', label: `Lesstof: ${lessonTabName(l)}`, hint: l.group ?? '', run: () => { openLesson(l).then(() => { requestAnimationFrame(() => fitTop()); setTimeout(() => fitTop(), 300) }).catch(() => {}) } })),
    ...TOOLS.map(t => ({ id: `tool-${t.id}`, group: 'Tools', label: `${t.label} tool`, keys: t.key, run: () => setTool(t.id) })),
    { id: 'undo', group: 'Edit', label: 'Undo', keys: 'Ctrl+Z', run: () => undo() },
    { id: 'redo', group: 'Edit', label: 'Redo', keys: 'Ctrl+Y', run: () => redo() },
    { id: 'all', group: 'Edit', label: 'Select all', keys: 'Ctrl+A', run: selectAll },
    { id: 'copy', group: 'Edit', label: 'Copy selection', keys: 'Ctrl+C', run: () => copySelection() },
    { id: 'dup', group: 'Edit', label: 'Duplicate selection', keys: 'Ctrl+D', run: duplicate },
    { id: 'del', group: 'Edit', label: 'Delete selection', keys: 'Del', run: () => { commit(d => removeItems(d, selection)); setSelection([]) } },
    { id: 'new-tab', group: 'Tabs', label: 'New tab', hint: 'Alt+T', run: () => { newTab() } },
    { id: 'next-tab', group: 'Tabs', label: 'Next tab', hint: 'Alt+→', run: () => cycleTab(1) },
    { id: 'prev-tab', group: 'Tabs', label: 'Previous tab', hint: 'Alt+←', run: () => cycleTab(-1) },
    { id: 'clear', group: 'Edit', label: 'Clear the canvas', hint: 'new empty', run: () => replaceDoc(emptyDoc()) },
    { id: 'rotl', group: 'Arrange', label: 'Rotate left 15°', hint: 'turn', run: () => rotateBy(-15) },
    { id: 'rotr', group: 'Arrange', label: 'Rotate right 15°', hint: 'turn', run: () => rotateBy(15) },
    { id: 'rot90', group: 'Arrange', label: 'Rotate 90°', hint: 'turn', run: () => rotateBy(90) },
    { id: 'fliph', group: 'Arrange', label: 'Flip left to right', hint: 'mirror horizontal', run: () => arrange((d, ids) => flipItems(d, ids, 'h')) },
    { id: 'flipv', group: 'Arrange', label: 'Flip top to bottom', hint: 'mirror vertical', run: () => arrange((d, ids) => flipItems(d, ids, 'v')) },
    { id: 'clean', group: 'Arrange', label: 'Clean up structure', hint: 'tidy layout', run: doClean },
    { id: 'fit', group: 'View', label: 'Fit to screen', hint: 'zoom', run: () => fit() },
    { id: 'theme-menu', group: 'View', label: 'Change theme…', hint: 'appearance colours', run: () => setPopover('theme') },
    ...THEMES.map(t => ({ id: `theme-${t.id}`, group: 'Theme', label: `Theme: ${t.name}`, hint: `${t.note} ${t.dark ? 'dark' : 'light'}`, run: () => setTheme(t.id) })),
    ...STYLES.map(s => ({ id: `style-${s.id}`, group: 'Drawing style', label: `Drawing style: ${s.name}`, hint: s.note, run: () => setDrawStyle(s.id) })),
    { id: 'export', group: 'Export', label: 'Export…', keys: 'Ctrl+E', hint: 'png svg mol smiles download', run: () => setPopover('export') },
    { id: 'copyimg', group: 'Export', label: 'Copy as image', keys: 'Ctrl+Shift+C', hint: 'clipboard png word powerpoint', run: copyAsImage },
    { id: 'save', group: 'Export', label: 'Save drawing (.json)', keys: 'Ctrl+S', run: saveJson },
    { id: 'open', group: 'Export', label: 'Open a file…', hint: 'json mol sdf', run: () => fileRef.current?.click() },
    { id: 'templates', group: 'Templates', label: 'Templates…', keys: 'Ctrl+T', hint: 'rings amino acids mechanisms groups', run: () => setPopover('templates') },
    ...MECHANISMS.map(m => ({ id: `mech-${m.name}`, group: 'Templates', label: `Mechanism: ${m.name}`, hint: m.note, run: () => addMechanism(m) })),
    ...RINGS.map(r => ({ id: `ring-${r.name}`, group: 'Templates', label: `Ring: ${r.name}`, run: () => addStructure(r) })),
    ...AMINO_ACIDS.map(a => ({ id: `aa-${a.name}`, group: 'Templates', label: `Amino acid: ${a.name}`, run: () => addStructure(a) })),
    { id: 'claude', group: 'Claude', label: claudeOpen ? 'Hide Claude' : 'Chat with Claude', hint: 'ai assistant', run: () => setClaudeOpen(o => !o) },
    { id: 'practice', group: 'Claude', label: 'Practice mechanisms', hint: 'exercises quiz oefenen check', run: () => { setClaudeOpen(true); chooseTab('practice') } },
    { id: 'newchat', group: 'Claude', label: 'New conversation with Claude', run: () => { newChat(); setClaudeOpen(true) } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selection, claudeOpen, chooseTab, copySelection, duplicate, rotateBy, arrange, fit, copyAsImage, saveJson, selectAll, lessons, fitTop])

  const extraCommands = useCallback((q: string): Command[] => [
    { id: 'add-mol', group: 'Add', label: `Add molecule “${q}”`, hint: 'name or SMILES', run: () => addByName(q) },
    { id: 'ask', group: 'Claude', label: `Ask Claude: “${q}”`, run: () => askClaude(q) },
  ], [addByName, askClaude])

  // ------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      // Ctrl+K works everywhere, even while typing in a box.
      if (mod && key === 'k') { e.preventDefault(); setPaletteOpen(o => !o); return }
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      // Tabs: Alt+T new, Alt+W close, Alt+1..9 jump, Alt+←/→ previous/next (Ctrl+T/W/Tab belong to the browser).
      if (e.altKey && !mod) {
        if (key === 't') { e.preventDefault(); newTab(); return }
        if (key === 'w') {
          e.preventDefault()
          const cur = tabs.find(x => x.active)
          if (cur && (isEmptyDoc(getDoc()) || confirm(`Close “${cur.name}”? Its drawing will be gone.`))) closeTab(cur.id)
          return
        }
        if (/^[1-9]$/.test(e.key)) { e.preventDefault(); const tab = e.key === '9' ? tabs[tabs.length - 1] : tabs[Number(e.key) - 1]; if (tab) switchTab(tab.id); return }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cycleTab(e.key === 'ArrowLeft' ? -1 : 1); return }
      }
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && key === 'y') { e.preventDefault(); redo(); return }
      if (mod && key === 'a') { e.preventDefault(); selectAll(); return }
      if (mod && key === 's') { e.preventDefault(); saveJson(); return }
      if (mod && key === 'e') { e.preventDefault(); toggle('export'); return }
      if (mod && key === 't') { e.preventDefault(); toggle('templates'); return }
      if (mod && key === 'd') { e.preventDefault(); duplicate(); return }
      if (mod && e.shiftKey && key === 'c') { e.preventDefault(); copyAsImage(); return }
      if (mod && key === 'c') { if (copySelection()) e.preventDefault(); return }
      if (mod && key === 'x') { if (copySelection(true)) e.preventDefault(); return }
      if (mod && key === 'v') {
        // The paste listener handles it; if the browser sends no paste event, paste our own copy.
        clearTimeout(pendingPaste.current)
        pendingPaste.current = window.setTimeout(() => { pendingPaste.current = undefined; if (clip.current) pasteFrag(clip.current.frag) }, 150)
        return
      }
      if (mod) return
      if (e.key === ' ') { e.preventDefault(); setSpaceDown(true); return }
      if (e.key === 'Escape') { setSelection([]); setEditing(null); setPopover(null); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const hover = hoverRef.current && exists(getDoc(), hoverRef.current) ? hoverRef.current : null
        const ids = selection.length ? selection : hover ? [hover] : []
        if (ids.length) { commit(d => removeItems(d, ids)); setSelection([]) }
        return
      }
      const hover = hoverRef.current && exists(getDoc(), hoverRef.current) ? hoverRef.current : null
      if (hover && kindOf(hover) === 'atom' && !e.altKey) {
        const id = hover
        // Collect letters (and digits after letters) to recognise group names: "Boc", "OMe", "NO2".
        const now = Date.now()
        const tp = typed.current
        const isChar = /^[a-z0-9]$/i.test(e.key)
        const continuing = tp.atom === id && now - tp.at < 900 && tp.text.length > 0
        if (isChar && (/[a-z]/i.test(e.key) || continuing)) {
          const buf = (continuing ? tp.text : '') + e.key
          const ab = buf.length > 1 ? findAbbrev(buf) : undefined
          const prefix = isAbbrevPrefix(buf)
          if (ab || prefix || buf.length > 1) {
            clearTimeout(tp.timer)
            typed.current = { text: prefix ? buf : '', at: now, atom: id }
            if (ab) { commit(d => { d.atoms[id].element = ab.label }); return }
            if (buf.length === 1) {
              // first letter: an element shortcut applies now; otherwise wait for more letters,
              // then fall back to the tool shortcut (T, M, E, A…) if nothing followed.
              if (LETTER_ELEMENTS[key]) { commit(d => { d.atoms[id].element = LETTER_ELEMENTS[key] }); return }
              const toolKey = TOOL_KEYS[key]
              if (toolKey) typed.current.timer = window.setTimeout(() => { if (typed.current.text === e.key) { typed.current.text = ''; setTool(toolKey) } }, 700)
              return
            }
            if (prefix) return
            // not a group: treat this key on its own below
            typed.current = { text: '', at: 0, atom: '' }
          }
        }
        if (LETTER_ELEMENTS[key]) { commit(d => { d.atoms[id].element = LETTER_ELEMENTS[key] }); return }
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
  }, [selection, tabs, setOpts, selectAll, saveJson, duplicate, copyAsImage, copySelection, pasteFrag])

  const toolInfo = TOOLS.find(t => t.id === tool)!
  const isEmpty = !Object.keys(doc.atoms).length && !Object.keys(doc.arrows).length && !Object.keys(doc.texts).length && !Object.keys(doc.brackets ?? {}).length
  const stageVars = { '--vx': view.x, '--vy': view.y, '--k': view.k } as CSSProperties

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Icon name="flask" size={18} /><span>Sketch</span></div>
        <div className="group">
          <button className="icon-btn" onClick={() => undo()} disabled={!canUndo()} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
          <button className="icon-btn" onClick={() => redo()} disabled={!canRedo()} title="Redo (Ctrl+Y)" aria-label="Redo"><Icon name="redo" /></button>
        </div>
        <form className="mol-input" onSubmit={e => { e.preventDefault(); submitMolecule() }}>
          {busy ? <span className="spinner" aria-label="Working" /> : <Icon name="plus" size={16} />}
          <input
            value={molInput}
            onChange={e => setMolInput(e.target.value)}
            placeholder="Add a molecule: name or SMILES, like aspirin or CCO"
            disabled={busy}
          />
        </form>
        <button className="kbd-btn" onClick={() => setPaletteOpen(true)} title="Search every command (Ctrl+K)">
          <Icon name="search" size={14} /><span className="label">Commands</span><kbd>Ctrl K</kbd>
        </button>
        <div className="spacer" />
        <div className="group">
          <button className={'icon-btn' + (popover === 'templates' ? ' on' : '')} onClick={() => toggle('templates')} title="Templates: rings, amino acids, groups, mechanisms (Ctrl+T)" aria-label="Templates"><Icon name="shapes" /></button>
          <button className="icon-btn" onClick={doClean} title="Clean up structure" aria-label="Clean up"><Icon name="clean" /></button>
          <button className="icon-btn" onClick={() => fit()} title="Fit to screen" aria-label="Fit to screen"><Icon name="fit" /></button>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Open file (.json, .mol)" aria-label="Open"><Icon name="open" /></button>
          <button className={'btn' + (popover === 'export' ? ' on' : '')} onClick={() => toggle('export')} title="Export (Ctrl+E)">
            <Icon name="download" size={16} /><span className="label">Export</span>
          </button>
          <button
            className="icon-btn"
            onClick={() => { if (confirm('Clear the canvas? You can undo this.')) replaceDoc(emptyDoc()) }}
            title="Clear canvas" aria-label="Clear canvas"
          ><Icon name="trash" /></button>
          <button className={'icon-btn' + (popover === 'theme' ? ' on' : '')} onClick={() => toggle('theme')} title="Theme and drawing style" aria-label="Theme"><Icon name="palette" /></button>
          <button className={'btn claude-btn' + (claudeOpen ? ' on' : '')} onClick={() => setClaudeOpen(o => !o)}>
            <Icon name="sparkles" size={16} /><span className="label">Claude</span>
            <span className={'dot' + (bridge.connected ? ' on' : '')} />
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".json,.mol,.sdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '' }} />
        {popover === 'theme' && <ThemeMenu onClose={() => setPopover(null)} />}
        {popover === 'export' && <ExportPanel doc={doc} selection={selection} onClose={() => setPopover(null)} flash={flash} />}
        {popover === 'templates' && (
          <TemplatesPanel onClose={() => setPopover(null)} onStructure={addStructure} onMechanism={t => { setPopover(null); addMechanism(t) }} onGroup={useGroup} />
        )}
      </header>

      <TabBar onLessonOpened={() => { requestAnimationFrame(() => fitTop()); setTimeout(() => fitTop(), 300) }} />

      <div className="body">
        <nav className="toolbar" aria-label="Tools">
          {TOOLS.map(t => (
            <button
              key={t.id}
              className={'tool' + (tool === t.id ? ' on' : '')}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={tool === t.id}
            ><Icon name={t.icon} /></button>
          ))}
        </nav>

        <main className="stage" ref={stageRef} onMouseDown={() => setPopover(null)}>
          <div className="stage-grid" style={stageVars} />
          {!editing && (
            <OptionsBar
              key={tool} tool={tool} opts={opts} setOpts={setOpts} doc={doc}
              selection={selection} setSelection={setSelection} onExpand={expandGroups}
            />
          )}
          <Canvas
            tool={tool} opts={opts} view={view} setView={setView}
            selection={selection} setSelection={setSelection}
            hoverRef={hoverRef}
            onEdit={setEditing} spaceDown={spaceDown}
          />
          {isEmpty && (
            <div className="empty">
              <p className="big">Start drawing</p>
              <p>Click anywhere with the Bond tool, or try one of these:</p>
              <div className="starters">
                <button onClick={() => addByName('caffeine')}><Icon name="plus" size={15} />Add caffeine</button>
                <button onClick={() => addMechanism(MECHANISMS[0])}><Icon name="curly" size={15} />Draw an SN2 mechanism</button>
                <button onClick={() => { setClaudeOpen(true) }}><Icon name="sparkles" size={15} />Ask Claude to draw</button>
              </div>
              <p className="small">Press <kbd>Ctrl K</kbd> for every command.</p>
            </div>
          )}
          {editing && (
            <Editor
              key={editing.kind === 'newText' ? `new-${editing.x}-${editing.y}` : editing.id}
              target={editing} view={view} newTextStyle={opts.textStyle} onDone={() => setEditing(null)}
            />
          )}
          {toast && <div className="toast" key={toast.n} role="status">{toast.msg}</div>}
          <footer className="status">
            <span className="hint">{toolInfo.hint}</span>
            <span className="spacer" />
            <Formulas doc={doc} selection={selection} />
            <span className="muted tabular">{Math.round(view.k * 100 / 1.4)}%</span>
          </footer>
        </main>

        {claudeOpen && <ClaudePanel onClose={() => setClaudeOpen(false)} doc={doc} selection={selection} setSelection={setSelection} tab={claudeTab} setTab={chooseTab} />}
      </div>

      {paletteOpen && <CommandBar commands={commands} extra={extraCommands} onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}

/**
 * Formula and mass of each molecule (or of the selection). It may lag a frame behind while you drag,
 * so drawing stays smooth; only this small part re-renders for it.
 */
const Formulas = memo(function Formulas(p: { doc: Doc; selection: ID[] }) {
  const doc = useDeferredValue(p.doc)
  const selection = useDeferredValue(p.selection)
  const status = useMemo(() => {
    const adj = adjacency(doc)
    const selAtoms = new Set(selection.filter(id => kindOf(id) === 'atom' && doc.atoms[id]))
    const groups = selAtoms.size
      ? components(doc, adj).map(c => c.filter(id => selAtoms.has(id))).filter(c => c.length)
      : components(doc, adj)
    return groups.slice(0, 4).map(g => formulaOf(doc, g, adj))
  }, [doc, selection])
  return <>{status.map((f, i) => (
    <span key={i} className="formula">{f.formula} <span className="muted">{f.mass.toFixed(2)} g/mol</span></span>
  ))}</>
})

/** Typing box for a new or existing label, with its style controls above it. */
function TextEditor({ target, view, newTextStyle, onDone }: {
  target: { kind: 'text'; id: ID } | { kind: 'newText'; x: number; y: number }; view: View; newTextStyle: TextStyle; onDone: () => void
}) {
  const existing = target.kind === 'text' ? getDoc().texts[target.id] : null
  const [style, setStyle] = useState<TextStyle>(() =>
    existing ? { color: existing.color, bold: existing.bold, italic: existing.italic, size: existing.size } : { ...newTextStyle })
  const done = useRef(false)
  if (target.kind === 'text' && !existing) return null
  const x = existing ? existing.x : (target as { x: number }).x
  const y = existing ? existing.y : (target as { y: number }).y

  const finish = (value: string, save: boolean) => {
    if (done.current) return
    done.current = true
    if (save) {
      const text = value.replace(/\s+$/, '')
      commit(d => {
        if (existing) {
          if (text.trim()) Object.assign(d.texts[existing.id], { text }, style)
          else delete d.texts[existing.id]
        } else if (text.trim()) {
          const id = newId('t')
          d.texts[id] = { id, x, y, text, ...style }
        }
      })
    }
    onDone()
  }

  const size = (style.size ?? 14) * view.k
  return (
    <div className="text-editor" style={{ left: x * view.k + view.x - 8, top: y * view.k + view.y - size - 10 }}>
      <div className="options text-style"><TextStyleBar style={style} onChange={setStyle} /></div>
      <input
        autoFocus defaultValue={existing?.text ?? ''} placeholder="Type a label, then Enter"
        style={{
          fontSize: Math.max(12, size), fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? 'italic' : 'normal',
          color: style.color || 'var(--text)',
        }}
        onBlur={e => finish(e.target.value, true)}
        onKeyDown={e => {
          if (e.key === 'Enter') finish(e.currentTarget.value, true)
          else if (e.key === 'Escape') finish('', false)
          else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setStyle(s => ({ ...s, bold: !s.bold })) }
          else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); setStyle(s => ({ ...s, italic: !s.italic })) }
        }}
      />
    </div>
  )
}

function Editor({ target, view, newTextStyle, onDone }: { target: EditTarget; view: View; newTextStyle: TextStyle; onDone: () => void }) {
  const doc = getDoc()
  const screen = (x: number, y: number) => ({ left: x * view.k + view.x, top: y * view.k + view.y })

  if (target.kind === 'newText') return <TextEditor target={target} view={view} newTextStyle={newTextStyle} onDone={onDone} />
  if (target.kind === 'text') return <TextEditor target={{ kind: 'text', id: target.id }} view={view} newTextStyle={newTextStyle} onDone={onDone} />

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
