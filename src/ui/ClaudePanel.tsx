import { useBridge } from '../bridge/client'
import { Icon } from './Icons'

const EXAMPLES = [
  'Draw the SN2 mechanism of bromoethane with hydroxide',
  'Add aspirin and clean up the structure',
  'Show the resonance structures of the acetate ion',
  'Draw the E1 mechanism of tert-butyl bromide',
]

export function ClaudePanel({ onClose }: { onClose: () => void }) {
  const { connected, log } = useBridge()
  return (
    <aside className="claude">
      <header>
        <Icon name="sparkles" size={18} />
        <span className="title">Claude</span>
        <span className={'dot' + (connected ? ' on' : '')} title={connected ? 'Connected' : 'Not connected'} />
        <button className="icon-btn" onClick={onClose} aria-label="Close panel"><Icon name="close" size={16} /></button>
      </header>

      {connected ? (
        <p className="muted">Claude is connected and can draw on this canvas. Ask it in Claude Code, for example:</p>
      ) : (
        <div className="muted">
          <p>Claude isn't connected yet. Open Claude Code in this project folder. It starts the bridge automatically from <code>.mcp.json</code>.</p>
          <p>Then ask it something like:</p>
        </div>
      )}
      <ul className="examples">
        {EXAMPLES.map(e => <li key={e}>“{e}”</li>)}
      </ul>

      <h4>Activity</h4>
      {log.length === 0 ? (
        <p className="muted small">Nothing yet. Claude's edits show up here, and each one can be undone.</p>
      ) : (
        <ul className="log">
          {log.map((l, i) => (
            <li key={i} className={l.ok ? '' : 'err'} title={l.detail}>
              <span>{l.method.replace(/_/g, ' ')}</span>
              <time>{new Date(l.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
