// Bouwt public/preset/mechanismen.chem.json (het Preset-tabblad).
// Draai vanuit de repo-map terwijl 'npm run dev' loopt: node scripts/preset/build.mjs
// De opgaven staan in data.mjs: alleen de opgave en de uitgangsstoffen, nooit het antwoord.
import { open } from './lib.mjs'
import { SECTIONS } from './data.mjs'
const { call, close } = await open()
await call('clear_canvas')
const W = 1300, X = 0
let y = 0
const bounds = s => { const m = /bounds now (-?[\d.]+),(-?[\d.]+)>(-?[\d.]+),(-?[\d.]+)/.exec(s); return m ? m.slice(1).map(Number) : null }
const wrap = (t, n = 140) => { const out = []; let line = ''; for (const w of t.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w } else line += ' ' + w } if (line.trim()) out.push(line.trim()); return out }

await call('add_text', { text: 'Preset: mechanismen tekenen (OSY2)', x: X, y: y + 30, size: 28, bold: true, color: '#2563eb' })
const intro = ['Alle opdrachten uit OSY2 waarin je een mechanisme tekent: werkcolleges, Wade-opgaven, vaardigheden, de oefencasus Lavendel en de casusopgaven van les 17.',
  'Teken in elk kader het mechanisme met gebogen pijlen, formele ladingen en vrije elektronenparen. Een ? staat waar het product moet komen. De antwoorden staan hier niet bij.']
y += 60
for (const l of intro) { await call('add_text', { text: l, x: X, y, size: 14 }); y += 22 }
y += 20
let n = 0
for (const sec of SECTIONS) {
  await call('add_text', { text: sec.title, x: X, y: y + 34, size: 22, bold: true, color: sec.color })
  y += 56
  for (const it of sec.items) {
    const top = y
    let ty = top + 52
    for (const l of wrap(it.q)) { await call('add_text', { text: l, x: X + 18, y: ty, size: 15 }); ty += 22 }
    const r = await call('draw_mechanism', { x: X + 30, y: ty + 4, width: W - 80, lone_pairs: it.lp ?? 'none', steps: it.steps })
    const b = bounds(String(r)); if (!b) throw new Error('no bounds: ' + r)
    const bottom = Math.max(b[3], ty) + 26
    const end = bottom + 240
    await call('add_bracket', { shape: 'box', x1: X, y1: top, x2: X + W, y2: end, label: it.t, color: sec.color })
    y = end + 24; n++
  }
  y += 16
}
console.log('opdrachten', n)
await call('export_drawing', { format: 'json', path: 'public/preset/mechanismen.chem.json' })
await close(); process.exit(0)
