import { useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, ID } from '../model/types'
import { kindOf } from '../model/types'
import { useBridge } from '../bridge/client'
import { newChat, sendChat, stopChat, useChat } from '../chat/chat'
import { adjacency, components, formulaOf } from '../chem/chem'
import { selectedAtoms } from '../model/ops'
import { smilesOf } from '../actions'
import { flashItems } from '../model/flash'
import { Icon } from './Icons'
import { RichText } from './RichText'
import { PracticePanel } from './PracticePanel'

export type ClaudeTab = 'chat' | 'practice'

/** Quick questions offered when something is selected. */
const ASK_SELECTION = ['What is this?', 'Name it (IUPAC)', 'How does it react?', 'Check the structure for mistakes']

const EXAMPLES = [
  'Draw the SN2 mechanism of bromoethane with hydroxide',
  'Add aspirin and clean up the structure',
  'Show the resonance structures of the acetate ion',
  'Draw the E1 mechanism of tert-butyl bromide',
]

const toolLabel = (name: string) => name.replace(/_/g, ' ')

export function ClaudePanel({ onClose, doc, selection, setSelection, tab, setTab }: {
  onClose: () => void; doc: Doc; selection: ID[]; setSelection: (ids: ID[]) => void
  tab: ClaudeTab; setTab: (t: ClaudeTab) => void
}) {
  const { connected, log } = useBridge()
  const [useSel, setUseSel] = useState(true)
  const { messages, busy, available } = useChat()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Follow the conversation as Claude writes.
  const last = messages[messages.length - 1]
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, last?.text, last?.tools.length])

  useEffect(() => { inputRef.current?.focus() }, [tab])

  // What's selected, described for Claude and summarised for the chip.
  const sel = useMemo(() => {
    const atoms = [...selectedAtoms(doc, selection)]
    const others = selection.filter(id => !['atom', 'bond'].includes(kindOf(id)))
    if (!atoms.length && !others.length) return null
    const adj = adjacency(doc)
    const mols = components(doc, adj).map(c => c.filter(id => atoms.includes(id))).filter(c => c.length)
    const formulas = mols.map(m => formulaOf(doc, m, adj).formula)
    const label = atoms.length
      ? `${formulas.slice(0, 2).join(', ')}${formulas.length > 2 ? '…' : ''} · ${atoms.length} atom${atoms.length > 1 ? 's' : ''}`
      : `${others.length} item${others.length > 1 ? 's' : ''}`
    return { atoms, others, mols, label }
  }, [doc, selection])

  useEffect(() => { setUseSel(true) }, [selection])

  const send = async (text = draft) => {
    if (!text.trim() || busy) return
    setDraft('')
    if (sel && useSel) {
      const smiles = await Promise.all(sel.mols.map(m => smilesOf(doc, m)))
      const context = `[The user has selected this on the canvas: ${sel.label}. Atom ids: ${sel.atoms.join(', ')}` +
        (sel.others.length ? `. Other items: ${sel.others.join(', ')}` : '') +
        (smiles.some(Boolean) ? `. SMILES: ${smiles.filter(Boolean).join('.')}` : '') + '. "This"/"it" means the selection.]'
      sendChat(text, context, `About the selection: ${sel.label}`)
    } else sendChat(text)
  }

  const showRef = (id: ID) => { setSelection([id]); flashItems([id]) }

  return (
    <aside className="claude">
      <header>
        <Icon name="sparkles" size={18} />
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat</button>
          <button role="tab" aria-selected={tab === 'practice'} className={tab === 'practice' ? 'on' : ''} onClick={() => setTab('practice')}>Practice</button>
        </div>
        <span
          className={'dot' + (connected ? ' on' : '')}
          title={connected ? 'Claude Code is connected too' : 'Claude Code is not connected (the chat below works without it)'}
        />
        {tab === 'chat' && messages.length > 0 && (
          <button className="text-btn" onClick={newChat} title="Start a new conversation">New chat</button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close panel"><Icon name="close" size={16} /></button>
      </header>

      {tab === 'practice' ? <PracticePanel doc={doc} setSelection={setSelection} /> : <>
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-intro">
            <p className="muted">Ask Claude to draw or explain something. It can see and edit this canvas, and every change can be undone.</p>
            <ul className="examples">
              {EXAMPLES.map(e => (
                <li key={e}><button onClick={() => send(e)} disabled={busy || !available}>{e}</button></li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="chat">
            {messages.map((m, i) => (
              <li key={i} className={'msg ' + m.role}>
                {m.role === 'assistant' && m.tools.length > 0 && (
                  <div className="msg-tools">{toolSummary(m.tools)}</div>
                )}
                {m.text && (m.role === 'assistant'
                  ? <div className="msg-text rich"><RichText text={m.text} doc={doc} onRef={showRef} /></div>
                  : <div className="msg-text">{m.text}</div>)}
                {m.note && <div className="msg-note">{m.note}</div>}
                {m.role === 'assistant' && !m.text && !m.error && busy && i === messages.length - 1 && (
                  <div className="typing" aria-label="Claude is thinking"><span /><span /><span /></div>
                )}
                {m.error && <div className="msg-error">{m.error}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {available && sel && (
        <div className="sel-context">
          <button className={'sel-chip' + (useSel ? ' on' : '')} onClick={() => setUseSel(u => !u)} title={useSel ? 'Claude will see your selection. Click to leave it out.' : 'Click to include your selection'}>
            <span className="sel-dot" />{useSel ? 'Asking about' : 'Not including'}: {sel.label}
          </button>
          {useSel && !busy && (
            <div className="quick-asks">
              {ASK_SELECTION.map(q => <button key={q} onClick={() => send(q)}>{q}</button>)}
            </div>
          )}
        </div>
      )}
      {available ? (
        <form className="composer" onSubmit={e => { e.preventDefault(); send() }}>
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            placeholder="Message Claude…"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              // Keep canvas shortcuts (N, O, Delete…) from firing while typing.
              e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
            }}
          />
          {busy ? (
            <button type="button" className="send-btn" onClick={stopChat} aria-label="Stop" title="Stop"><Icon name="stop" size={16} /></button>
          ) : (
            <button type="submit" className="send-btn" disabled={!draft.trim()} aria-label="Send" title="Send (Enter)"><Icon name="send" size={16} /></button>
          )}
        </form>
      ) : (
        <p className="muted small">The chat needs the dev server: run <code>npm run dev</code> and open the app from there.</p>
      )}

      </>}

      {log.length > 0 && (
        <details className="activity">
          <summary>Activity ({log.length})</summary>
          <ul className="log">
            {log.map((l, i) => (
              <li key={i} className={l.ok ? '' : 'err'} title={l.detail}>
                <span>{toolLabel(l.method)}</span>
                <time>{new Date(l.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  )
}

/** "add molecule ×2 · screenshot" */
function toolSummary(tools: string[]) {
  const counts = new Map<string, number>()
  for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].map(([t, n]) => (n > 1 ? `${toolLabel(t)} ×${n}` : toolLabel(t))).join(' · ')
}
