/*
 * The in-app chat with Claude. Messages go to chat/plugin.mjs over Vite's dev WebSocket;
 * Claude's tool calls come back the same way and run on this tab's canvas.
 * Only available under `npm run dev` (the plugin lives in the dev server).
 */
import { useSyncExternalStore } from 'react'
import { runMethod } from '../bridge/client'
import { getDoc } from '../model/store'
import type { Doc } from '../model/types'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  tools: string[] // tool names Claude used while writing this reply
  error?: string
  /** Short note under a user message, like "About: 6 selected atoms". */
  note?: string
}

interface ChatState { messages: ChatMessage[]; busy: boolean; available: boolean }

const STORAGE_KEY = 'sketch-chat'
const hot = import.meta.hot

let sessionId: string | undefined
let chatId = 0 // which send the current events belong to (ignores late events after Stop / New chat)
let state: ChatState = { messages: [], busy: false, available: !!hot }

// Keep the conversation across reloads (Claude resumes it by session id).
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  if (saved?.messages) { state = { ...state, messages: saved.messages }; sessionId = saved.sessionId }
} catch { /* storage unavailable: start fresh */ }

const listeners = new Set<() => void>()
function set(s: Partial<ChatState>) {
  state = { ...state, ...s }
  listeners.forEach(l => l())
  if (!state.busy) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: state.messages, sessionId })) } catch { /* ignore */ }
  }
}
export const useChat = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)

/** Apply a change to the last (assistant) message. */
function updateLast(fn: (m: ChatMessage) => ChatMessage) {
  const msgs = state.messages.slice()
  msgs[msgs.length - 1] = fn(msgs[msgs.length - 1])
  set({ messages: msgs })
}

/**
 * Send a message. `context` (what's selected on the canvas) goes to Claude but isn't shown
 * in the transcript; `contextLabel` is a short note shown under the message instead.
 */
/** The canvas as Claude last saw it (end of its last turn, or the last message sent). */
let seenDoc: Doc | null = null
/** Past this size the canvas isn't sent along; Claude calls get_document when it needs it. */
const MAX_CANVAS_CHARS = 6000

/**
 * The canvas for Claude, sent with each message so it doesn't spend a round on get_document first.
 * When nothing changed since Claude last saw it, a one-line note is enough.
 */
async function canvasNote(): Promise<string> {
  const doc = getDoc()
  if (seenDoc === doc && sessionId) return '[Canvas unchanged since your last turn.]'
  seenDoc = doc
  if (!Object.keys(doc.atoms).length && !Object.keys(doc.arrows).length && !Object.keys(doc.texts).length) return '[Canvas is empty.]'
  const res = await runMethod('get_document', {})
  const text = 'result' in res && typeof res.result === 'string' ? res.result : ''
  if (!text || text.length > MAX_CANVAS_CHARS) return '[The canvas has a large drawing: call get_document if you need it.]'
  return `<canvas>
${text}
</canvas>`
}

export async function sendChat(text: string, context?: string, contextLabel?: string) {
  text = text.trim()
  if (!text || state.busy || !hot) return
  chatId++
  const id = chatId
  set({
    busy: true,
    messages: [...state.messages, { role: 'user', text, tools: [], note: contextLabel }, { role: 'assistant', text: '', tools: [] }],
  })
  const canvas = await canvasNote().catch(() => '')
  if (id !== chatId) return // stopped or new chat meanwhile
  hot.send('sketch-chat:send', { chatId, text: [text, context, canvas].filter(Boolean).join('\n\n'), sessionId })
}

export function stopChat() {
  if (state.busy) hot?.send('sketch-chat:stop', { chatId })
}

export function newChat() {
  stopChat()
  chatId++
  sessionId = undefined
  seenDoc = null
  set({ messages: [], busy: false })
}

type ChatEvent =
  | { chatId: number; type: 'text'; delta: string }
  | { chatId: number; type: 'tool'; name: string }
  | { chatId: number; type: 'done'; sessionId?: string; error?: string; stopped?: boolean }

if (hot) {
  hot.on('sketch-chat:event', (ev: ChatEvent) => {
    if (ev.chatId !== chatId || !state.busy) return
    if (ev.type === 'text') updateLast(m => ({ ...m, text: m.text + ev.delta }))
    else if (ev.type === 'tool') updateLast(m => ({ ...m, tools: [...m.tools, ev.name] }))
    else if (ev.type === 'done') {
      if (ev.sessionId) sessionId = ev.sessionId
      seenDoc = ev.error || ev.stopped ? null : getDoc()
      updateLast(m => ({
        ...m,
        error: ev.error,
        text: m.text || (ev.stopped ? 'Stopped.' : ''),
      }))
      set({ busy: false })
    }
  })

  hot.on('sketch-chat:call', async (msg: { callId: number; method: string; params: Record<string, unknown> }) => {
    hot.send('sketch-chat:result', { callId: msg.callId, ...(await runMethod(msg.method, msg.params ?? {})) })
  })

  // The dev server restarted (e.g. vite.config change): any answer in progress is gone.
  hot.on('vite:ws:disconnect', () => {
    if (!state.busy) return
    updateLast(m => ({ ...m, error: 'Lost the connection to the dev server.' }))
    set({ busy: false })
  })
}

// Hot reload would register the listeners above twice, so reload the page instead.
if (hot) hot.accept(() => location.reload())
