/*
 * In-app chat with Claude, served by the Vite dev server (`npm run dev`).
 *
 * The page talks to this plugin over Vite's own dev WebSocket (import.meta.hot), so no extra
 * port is needed. Each message runs a Claude Agent SDK turn on the Claude login this computer
 * already uses for Claude Code (no API key). Claude gets only the Sketch tools from
 * bridge/tools.mjs: no files, shell or web. Its tool calls are sent back to the same browser
 * tab, which applies each one as an undoable edit.
 *
 * Events (page -> server):  sketch-chat:send {chatId, text, sessionId?}, sketch-chat:stop {chatId},
 *                           sketch-chat:result {callId, result? | error?}
 * Events (server -> page):  sketch-chat:event {chatId, type: 'text' | 'tool' | 'done', ...},
 *                           sketch-chat:call {callId, method, params}
 *
 * Practice mode (src/chat/practice.ts) uses its own one-off turns: sketch-practice:run {runId, kind, ...}
 * and sketch-practice:stop {runId} in, sketch-practice:event {runId, type: 'tool' | 'done', result?} out.
 * Claude ends each one by calling a submit_* tool; its arguments are the result.
 */
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { INSTRUCTIONS, TOOLS, runTool } from '../bridge/tools.mjs'
import { practicePrompt, PRACTICE_SYSTEM } from './practice.mjs'

const MODEL = 'claude-opus-5-5'
const CALL_TIMEOUT_MS = 30_000

const SYSTEM_PROMPT = `${INSTRUCTIONS}

You are chatting with the user in a small panel beside the Sketch canvas. The canvas is right
next to this chat, so draw on it with your tools rather than describing structures in words.
Keep replies short: a sentence or two about what you drew or changed, or a brief answer to a
chemistry question. The panel shows **bold**, *italic*, bullet and numbered lists, and writes formulas
like C6H6 with subscripts; it does not show headings, tables or code blocks. When it helps, mention atom
ids (like a12): the user can click them to highlight that atom. A message may end with a bracketed note
saying what the user has selected on the canvas; "this" or "it" then means that selection.
Each message also ends with the current canvas in get_document's format inside <canvas>…</canvas>, or a note
that it is unchanged since your last turn or empty: don't call get_document for that. For questions that
need no drawing, just answer.
Everything you write is shown to the user, so do not write working notes, coordinates or plans
before or between tool calls: use the tools silently, then write only the short final reply.`

const log = (...a) => console.log('[sketch-chat]', ...a)

/** One line per finished turn: rounds, tokens (fresh input, cache read/written, output) and cost. */
function logUsage(what, m) {
  const u = m.usage ?? {}
  log(`${what} usage: ${m.num_turns ?? '?'} rounds, in ${u.input_tokens ?? 0} + cache read ${u.cache_read_input_tokens ?? 0} + cache write ${u.cache_creation_input_tokens ?? 0}, out ${u.output_tokens ?? 0}, $${(m.total_cost_usd ?? 0).toFixed(3)}`)
}

/** Turn an SDK error into something the user can act on. */
function friendlyError(code, fallback) {
  switch (code) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
      return 'Claude Code is not signed in on this computer. Open a terminal, run `claude`, type /login and sign in, then send your message again.'
    case 'rate_limit': return 'You have hit your Claude usage limit for now. Try again later.'
    case 'billing_error': return 'Claude could not run because of a billing problem on your account.'
    case 'overloaded':
    case 'server_error': return 'Claude is busy right now. Try again in a moment.'
    default: return fallback || 'Something went wrong talking to Claude.'
  }
}

/** An error result or thrown error (the SDK does either) -> message for the user. */
function failure(detail = '', status) {
  const signedOut = status === 401 || /authenticat|oauth|not logged in|\/login/i.test(detail)
  return friendlyError(signedOut ? 'authentication_failed' : undefined, detail)
}

/** @returns {import('vite').Plugin} */
export function sketchChat() {
  return {
    name: 'sketch-chat',
    apply: 'serve',
    configureServer(server) {
      const ws = server.ws
      /** callId -> {resolve, reject, timer} */
      const pending = new Map()
      /** browser tab -> its running turn */
      const running = new Map()
      let nextCall = 1

      /** Ask one browser tab to run a canvas method; resolves with its result. */
      function callTab(client, method, params) {
        const callId = nextCall++
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(callId)
            reject(new Error(`${method} timed out. Is the Sketch tab still open?`))
          }, CALL_TIMEOUT_MS)
          pending.set(callId, { resolve, reject, timer })
          client.send('sketch-chat:call', { callId, method, params })
        })
      }

      ws.on('sketch-chat:result', msg => {
        const p = pending.get(msg?.callId)
        if (!p) return
        pending.delete(msg.callId)
        clearTimeout(p.timer)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.result)
      })

      ws.on('sketch-chat:stop', (msg, client) => {
        const turn = running.get(client)
        if (turn && turn.chatId === msg?.chatId) turn.abort.abort()
      })

      /** Practice turns: one per button press, no shared conversation. */
      const practiceRuns = new Map()
      ws.on('sketch-practice:stop', (msg, client) => {
        const r = practiceRuns.get(client)
        if (r && r.runId === msg?.runId) r.abort.abort()
      })
      ws.on('sketch-practice:run', async (msg, client) => {
        const runId = msg?.runId
        const emit = data => client.send('sketch-practice:event', { runId, ...data })
        if (practiceRuns.has(client)) { emit({ type: 'done', error: 'Claude is still working on the last request.' }); return }
        let spec
        try { spec = practicePrompt(msg) } catch (err) { emit({ type: 'done', error: err.message }); return }
        const abort = new AbortController()
        practiceRuns.set(client, { runId, abort })
        log(`practice ${msg.kind} started`)
        const onClose = () => abort.abort()
        client.socket?.once?.('close', onClose)

        let result
        const submit = tool(spec.submit.name, spec.submit.description, spec.submit.shape, async args => {
          result ??= args
          return { content: [{ type: 'text', text: 'Received. You are done: end your turn now without writing anything else.' }] }
        })
        const canvasTools = TOOLS.filter(t => spec.tools === 'all' || spec.tools.includes(t.name))
        const sketch = createSdkMcpServer({
          name: 'sketch', version: '1.0.0', alwaysLoad: true,
          tools: [submit, ...canvasTools.map(def => tool(def.name, def.description, def.shape,
            args => runTool(def, args, (method, params) => callTab(client, method, params))))],
        })
        let error
        try {
          const turn = query({
            prompt: spec.prompt,
            options: {
              model: MODEL,
              systemPrompt: PRACTICE_SYSTEM + (spec.tools === 'all' || spec.tools.includes('draw_mechanism') ? '\n\n' + INSTRUCTIONS : ''),
              tools: [],
              mcpServers: { sketch },
              allowedTools: [spec.submit.name, ...canvasTools.map(t => t.name)].map(n => `mcp__sketch__${n}`),
              permissionMode: 'dontAsk',
              settingSources: [],
              strictMcpConfig: true,
              includePartialMessages: true,
              cwd: server.config.root,
              abortController: abort,
            },
          })
          for await (const m of turn) {
            if (m.type === 'stream_event' && !m.parent_tool_use_id) {
              const ev = m.event
              if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
                const name = ev.content_block.name.replace(/^mcp__sketch__/, '')
                log(`practice ${msg.kind}: ${name}`)
                emit({ type: 'tool', name })
              }
            } else if (m.type === 'assistant' && m.error) {
              error = friendlyError(m.error)
            } else if (m.type === 'result') {
              logUsage(`practice ${msg.kind}`, m)
              if ((m.subtype !== 'success' || m.is_error) && !result) error ??= failure(m.result || m.errors?.join('\n'), m.api_error_status)
            }
          }
        } catch (err) {
          if (!abort.signal.aborted) { log('practice turn failed:', err); error ??= failure(err?.message) }
        } finally {
          practiceRuns.delete(client)
          client.socket?.off?.('close', onClose)
        }
        log(`practice ${msg.kind} done:`, result ? 'submitted' : error ?? 'no result')
        emit({ type: 'done', result, error: result ? undefined : error, stopped: abort.signal.aborted || undefined })
      })

      ws.on('sketch-chat:send', async (msg, client) => {
        const chatId = msg?.chatId
        const text = String(msg?.text ?? '').trim()
        const emit = data => client.send('sketch-chat:event', { chatId, ...data })
        if (!text) return
        if (running.has(client)) {
          emit({ type: 'done', error: 'Claude is still answering your last message.' })
          return
        }

        const abort = new AbortController()
        running.set(client, { chatId, abort })
        // Stop the turn if the tab closes or reloads mid-answer.
        const onClose = () => abort.abort()
        client.socket?.once?.('close', onClose)

        // Tools are bound to this tab, so Claude only ever draws where you are chatting.
        const sketch = createSdkMcpServer({
          name: 'sketch',
          version: '1.0.0',
          alwaysLoad: true,
          tools: TOOLS.map(def => tool(def.name, def.description, def.shape,
            args => runTool(def, args, (method, params) => callTab(client, method, params)))),
        })

        let sessionId = msg.sessionId || undefined
        let error
        let wroteText = false
        let pending = '' // text of the message being streamed, shown once it ends without a tool call
        try {
          const turn = query({
            prompt: text,
            options: {
              model: MODEL,
              systemPrompt: SYSTEM_PROMPT,
              tools: [], // no built-in tools (files, shell, web)
              mcpServers: { sketch },
              allowedTools: TOOLS.map(t => `mcp__sketch__${t.name}`),
              permissionMode: 'dontAsk', // anything not allowed above is refused, never prompted
              settingSources: [], // ignore .mcp.json and settings files: the bridge must not start twice
              strictMcpConfig: true,
              includePartialMessages: true,
              resume: sessionId,
              cwd: server.config.root,
              abortController: abort,
            },
          })

          for await (const m of turn) {
            if (m.type === 'system' && m.subtype === 'init') {
              sessionId = m.session_id
            } else if (m.type === 'stream_event' && !m.parent_tool_use_id) {
              // Text written before a tool call in the same message is a working note ("Need the bond id…"),
              // not the reply, so hold each message's text until we know no tool call follows it.
              const ev = m.event
              if (ev.type === 'message_start') {
                pending = ''
              } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
                pending = ''
                emit({ type: 'tool', name: ev.content_block.name.replace(/^mcp__sketch__/, '') })
              } else if (ev.type === 'content_block_start' && ev.content_block.type === 'text' && pending) {
                pending += '\n\n'
              } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
                pending += ev.delta.text
              } else if (ev.type === 'message_stop' && pending.trim()) {
                emit({ type: 'text', delta: (wroteText ? '\n\n' : '') + pending.trim() })
                wroteText = true
                pending = ''
              }
            } else if (m.type === 'assistant' && m.error) {
              error = friendlyError(m.error)
            } else if (m.type === 'result') {
              logUsage('chat', m)
              sessionId = m.session_id ?? sessionId
              if (m.subtype !== 'success' || m.is_error) {
                error ??= failure(m.result || m.errors?.join('\n'), m.api_error_status)
              }
            }
          }
        } catch (err) {
          if (abort.signal.aborted) error = undefined
          else {
            log('turn failed:', err)
            error ??= failure(err?.message)
          }
        } finally {
          running.delete(client)
          client.socket?.off?.('close', onClose)
        }
        emit({ type: 'done', sessionId, error, stopped: abort.signal.aborted || undefined })
      })
    },
  }
}
