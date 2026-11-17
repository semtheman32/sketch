#!/usr/bin/env node
/*
 * Claude bridge for Sketch.
 *
 * Runs as an MCP server over stdio (Claude Code starts it from .mcp.json) and also
 * hosts a local WebSocket on 127.0.0.1:3917 that the open app connects to.
 * Each MCP tool call is forwarded to the app, which applies it as one undoable edit.
 *
 * stdout belongs to the MCP protocol, so all logging goes to stderr.
 */
import { INSTRUCTIONS, TOOLS, runTool } from './tools.mjs'
import { WebSocketServer } from 'ws'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const PORT = Number(process.env.SKETCH_BRIDGE_PORT ?? 3917)
const TIMEOUT_MS = 30_000
const log = (...a) => console.error('[sketch-bridge]', ...a)

// ---------------------------------------------------------------- WebSocket side

const RETRY_MS = 3_000
const APP_WAIT_MS = 5_000 // the app retries its connection every 3 s

let app = null
let wsError = null
let listening = false
let binding = null // in-flight listen() promise
let nextId = 1
const pending = new Map()

// Try to take the port. If another session's bridge holds it, keep retrying in the
// background (and on every tool call), so freeing the port is enough: no restart needed.
function listen() {
  if (listening) return Promise.resolve()
  if (binding) return binding
  binding = new Promise(resolve => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT })
    wss.once('listening', () => {
      listening = true
      wsError = null
      log(`waiting for the app on ws://127.0.0.1:${PORT}`)
      resolve()
    })
    wss.once('error', err => {
      const msg = err.code === 'EADDRINUSE'
        ? `Port ${PORT} is in use, probably by another Claude session's bridge. Close that session (or stop its bridge); this one will take over the port automatically.`
        : String(err)
      if (msg !== wsError) log(msg)
      wsError = msg
      wss.close()
      resolve()
    })
    wss.on('connection', onConnection)
  }).finally(() => { binding = null })
  return binding
}

setInterval(() => { if (!listening) listen() }, RETRY_MS).unref()
listen()

function waitForApp(ms) {
  return new Promise(resolve => {
    const start = Date.now()
    const tick = () => {
      if ((app && app.readyState === 1) || Date.now() - start >= ms) return resolve()
      setTimeout(tick, 200)
    }
    tick()
  })
}

function onConnection(socket) {
  if (app && app !== socket) app.close()
  app = socket
  log('app connected')
  socket.on('message', raw => {
    let msg
    try { msg = JSON.parse(String(raw)) } catch { return }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  })
  socket.on('close', () => {
    if (app === socket) { app = null; log('app disconnected') }
  })
}

async function call(method, params = {}) {
  if (!listening) {
    await listen()
    if (!listening) throw new Error(wsError)
  }
  if (!app || app.readyState !== 1) await waitForApp(APP_WAIT_MS)
  if (!app || app.readyState !== 1) {
    throw new Error(
      'The Sketch app is not connected. Ask the user to start it with `npm run dev` in the project folder and open http://localhost:5173 in a browser.')
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    app.send(JSON.stringify({ id, method, params }))
  })
}

// ---------------------------------------------------------------- MCP side

const server = new McpServer({ name: 'sketch', version: '1.0.0' }, { instructions: INSTRUCTIONS })

for (const def of TOOLS) {
  server.registerTool(def.name, { description: def.description, inputSchema: def.shape }, args => runTool(def, args, call))
}

await server.connect(new StdioServerTransport())
log('MCP server ready')
