/*
 * The in-app chat with Claude. Messages go to chat/plugin.mjs over Vite's dev WebSocket;
 * Claude's tool calls come back the same way and run on this tab's canvas.
 * Only available under `npm run dev` (the plugin lives in the dev server).
 */
import { useSyncExternalStore } from 'react'
import { runMethod } from '../bridge/client'

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
export function sendChat(text: string, context?: string, contextLabel?: string) {
  text = text.trim()
  if (!text || state.busy || !hot) return
  chatId++
  set({
    busy: true,
    messages: [...state.messages, { role: 'user', text, tools: [], note: contextLabel }, { role: 'assistant', text: '', tools: [] }],
  })
  hot.send('sketch-chat:send', { chatId, text: context ? `${text}

${context}` : text, sessionId })
}

export function stopChat() {
  if (state.busy) hot?.send('sketch-chat:stop', { chatId })
}

export function newChat() {
  stopChat()
  chatId++
  sessionId = undefined
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
