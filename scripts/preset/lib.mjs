// Playwright: zet PLAYWRIGHT op het pad naar playwright/index.mjs als het niet als pakket te vinden is.
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
export async function open() {
  const client = new Client({ name: 'draw', version: '1.0.0' })
  await client.connect(new StdioClientTransport({ command: 'node', args: ['bridge/server.mjs'], stderr: 'inherit' }))
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto('http://127.0.0.1:5173/')
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args }); const c = r.content[0]
    if (r.isError) throw new Error(name + ': ' + c.text)
    return c.type === 'text' ? (/^[\[{]/.test(c.text) ? JSON.parse(c.text) : c.text) : c
  }
  for (let i = 0; i < 30; i++) { try { await call('get_document'); break } catch (e) { if (i === 29) throw e; await new Promise(r => setTimeout(r, 1000)) } }
  const close = async () => { await browser.close(); await client.close() }
  return { call, page, close }
}
