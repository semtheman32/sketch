// Bouwt per les één Sketch-tekening (lesstof) uit de lesoverzichten-app: elke tekening uit de les,
// met hoofdstuktitel, "waarom"-tekst, bijschrift of stapuitleg en de "onthoud"-punten erbij.
// Gebruik: node scripts/build-lesstof.mjs <map van lesoverzichten-app> [extra .chem.json voor MS]
// Uitvoer: public/lesstof/lesNN.chem.json en public/lesstof/index.json (de app leest die in via de knop Lesstof).
import fs from 'node:fs'
import path from 'node:path'

const app = process.argv[2]
const msExtra = process.argv[3]
if (!app) { console.error('Gebruik: node scripts/build-lesstof.mjs <lesoverzichten-app> [ms.chem.json]'); process.exit(1) }
const index = JSON.parse(fs.readFileSync(path.join(app, 'src/tekeningen/chem-index.json'), 'utf8'))
const lessonsJs = fs.readFileSync(path.join(app, 'src/lessons.js'), 'utf8')
const ALL = [...lessonsJs.matchAll(/\[(\d+), '([^']+)', '([^']+)'\]/g)].map(m => ({ n: +m[1], short: m[2], theme: m[3] }))
const outDir = 'public/lesstof'
fs.mkdirSync(outDir, { recursive: true })

const SKIP_CHAPTERS = new Set(['bronnen', 'test', 'overzicht', 'samenvatting'])
const WRAP = 105 // tekens per regel bij grootte 13

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', n: 'ⁿ', m: 'ᵐ', x: 'ˣ', y: 'ʸ' }
const SUBS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ' }
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', lambda: 'λ', mu: 'μ', nu: 'ν', pi: 'π', sigma: 'σ', tau: 'τ', theta: 'θ', ddagger: '‡', circ: '°', pm: '±', leq: '≤', geq: '≥', ne: '≠', infty: '∞', log: 'log', ln: 'ln', degree: '°', quad: ' ', qquad: ' ' }
const script = (map, t) => [...t].every(c => map[c]) ? [...t].map(c => map[c]).join('') : null
/** JSX-/markdown-/KaTeX-tekst naar platte tekst. */
function clean(s) {
  return s
    .replace(/\\\\/g, '\\')
    .replace(/\\(?:text|mathrm|ce|mathit|textbf|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\left|\\right/g, '').replace(/\{,\}/g, ',').replace(/\\·/g, '·')
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (m, a, b) => (a.length > 1 ? '(' + a + ')' : a) + '/' + (b.length > 1 ? '(' + b + ')' : b))
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (m, a, b) => (a.length > 1 ? '(' + a + ')' : a) + '/' + (b.length > 1 ? '(' + b + ')' : b))
    .replace(/\^\{([^{}]*)\}|\^(\S)/g, (m, a, b) => script(SUP, a ?? b) ?? '^' + (a ?? b))
    .replace(/_\{([^{}]*)\}|_([0-9a-zA-Z])/g, (m, a, b) => script(SUBS, a ?? b) ?? (a ?? b))
    .replace(/\\(alpha|beta|gamma|delta|Delta|lambda|mu|nu|pi|sigma|tau|theta|ddagger|circ|pm|leq|geq|ne|infty|log|ln|degree|quad|qquad)(?![a-zA-Z])/g, (m, g) => GREEK[g] + (/^(log|ln)$/.test(g) ? ' ' : ''))
    .replace(/\\'/g, "'").replace(/\\n/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[(zelf|ill)\]/g, '')
    .replace(/\\ce\{([^}]*)\}/g, '$1').replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replace(/\\cdot/g, '·').replace(/\\to|\\rightarrow/g, '→').replace(/\\times/g, '×').replace(/\\approx/g, '≈')
    .replace(/\\[,;!]/g, ' ').replace(/\\%/g, '%').replace(/\$/g, '')
    .replace(/\*\*/g, '').replace(/(^|\s)\*(\S[^*]*)\*/g, '$1$2')
    .replace(/\{\s*'\s*'\s*\}/g, ' ').replace(/\s+/g, ' ').trim()
}

function wrap(s, n = WRAP) {
  const out = []; let line = ''
  for (const w of s.split(' ')) {
    if (line && (line + ' ' + w).length > n) { out.push(line); line = w } else line = line ? line + ' ' + w : w
  }
  if (line) out.push(line)
  return out
}

/** Alle string-literals ('…', "…", `…`) in een stuk code, in volgorde. */
function strings(code) {
  return [...code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2] ?? m[3])
}
const attr = (tag, name) => {
  const m = tag.match(new RegExp(name + '=(?:"([^"]*)"|\\{r?`([^`]*)`\\}|\\{\'([^\']*)\'\\})'))
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}
const prop = (obj, name) => {
  const m = obj.match(new RegExp('\\b' + name + ":\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|\"([^\"]*)\"|`([^`]*)`)"))
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

/** Uitleg bij de tekening die op positie `p` in `body` staat (T('naam')). Null = overslaan. */
function labelFor(body, p) {
  const ls = body.lastIndexOf('\n', p) + 1
  const le = body.indexOf('\n', p)
  const line = body.slice(ls, le < 0 ? undefined : le)
  if (/\bwhy:/.test(line)) return null // foute/goede keuzes van een meerkeuzevraag
  const t = prop(line, 't')
  if (t !== null) {
    const h = prop(line, 'h')
    return clean((h ? h + ' ' : '') + t)
  }
  if (/answerF=\{T\(/.test(line)) {
    const before = body.slice(Math.max(0, ls - 600), le)
    const ans = [...before.matchAll(/answer="([^"]*)"/g)].pop()
    return ans ? 'Antwoord: ' + clean(ans[1]) : ''
  }
  // Anders: het element (<Drawing …/>, <ReactionCard …>) waar f={T(…)} in staat.
  const start = body.lastIndexOf('<', p)
  const next = body.indexOf('\n    <', p) // het volgende element op hetzelfde niveau
  const tag = body.slice(start, next < 0 ? p + 1500 : Math.min(next, p + 1500))
  const name = (tag.match(/^<(\w+)/) || [])[1]
  if (name === 'WhichProduct' || name === 'PracticeMC' || name === 'CondPicker') return null
  const title = attr(tag, 'title'), caption = attr(tag, 'caption'), why = attr(tag, 'why')
  const label = clean([title, caption].filter(Boolean).map(x => x.trim()).reduce((a, b) => a === b ? a : a ? (/[.?!:]$/.test(a) ? a + ' ' : a + '. ') + b : b, ''))
  return why ? { label, after: clean(why) } : label
}

// ---------------------------------------------------------------- tekening opbouwen

function textW(text, size, bold) { return text.length * size * 0.56 * (bold ? 1.08 : 1) }

function bbox(d) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  const add = (a, b, c, e) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, e) }
  for (const a of Object.values(d.atoms || {})) add(a.x - 14, a.y - 14, a.x + 14, a.y + 14)
  for (const r of Object.values(d.arrows || {})) {
    const mx = (r.x1 + r.x2) / 2, w = Math.max(textW(r.above || '', 12), textW(r.below || '', 12)) / 2
    add(Math.min(r.x1, r.x2, mx - w), Math.min(r.y1, r.y2) - (r.above ? 24 : 6), Math.max(r.x1, r.x2, mx + w), Math.max(r.y1, r.y2) + (r.below ? 26 : 6))
  }
  for (const t of Object.values(d.texts || {})) { const s = t.size ?? 14; add(t.x, t.y - s, t.x + textW(t.text, s, t.bold), t.y + s * 0.4) }
  for (const k of Object.values(d.brackets || {})) add(Math.min(k.x1, k.x2) - 6, Math.min(k.y1, k.y2), Math.max(k.x1, k.x2) + 14, Math.max(k.y1, k.y2))
  return x1 === Infinity ? null : { x1, y1, x2, y2 }
}

function builder() {
  const doc = { atoms: {}, bonds: {}, arrows: {}, curlies: {}, texts: {}, brackets: {} }
  const seq = { a: 0, b: 0, r: 0, c: 0, t: 0, k: 0 }
  const id = k => k + ++seq[k]
  const text = (x, y, s, style = {}) => { const i = id('t'); doc.texts[i] = { id: i, x: +x.toFixed(1), y: +y.toFixed(1), text: s, ...style }; return i }
  /** Zet tekening `d` met linkerbovenhoek op (x, y). Geeft de hoogte terug. */
  const place = (d, x, y) => {
    const b = bbox(d); if (!b) return 0
    const dx = x - b.x1, dy = y - b.y1, map = {}
    const r = v => Math.round(v * 100) / 100
    for (const a of Object.values(d.atoms || {})) { const i = id('a'); map[a.id] = i; doc.atoms[i] = { ...a, id: i, x: r(a.x + dx), y: r(a.y + dy) } }
    for (const o of Object.values(d.bonds || {})) { const i = id('b'); map[o.id] = i; doc.bonds[i] = { ...o, id: i, a1: map[o.a1], a2: map[o.a2] } }
    for (const o of Object.values(d.arrows || {})) { const i = id('r'); doc.arrows[i] = { ...o, id: i, x1: r(o.x1 + dx), y1: r(o.y1 + dy), x2: r(o.x2 + dx), y2: r(o.y2 + dy) } }
    for (const o of Object.values(d.texts || {})) { const i = id('t'); doc.texts[i] = { ...o, id: i, x: r(o.x + dx), y: r(o.y + dy) } }
    for (const o of Object.values(d.brackets || {})) { const i = id('k'); doc.brackets[i] = { ...o, id: i, x1: r(o.x1 + dx), y1: r(o.y1 + dy), x2: r(o.x2 + dx), y2: r(o.y2 + dy) } }
    for (const o of Object.values(d.curlies || {})) {
      if (!map[o.from] || !map[o.to]) continue
      const i = id('c'); doc.curlies[i] = { ...o, id: i, from: map[o.from], to: map[o.to] }
    }
    return b.y2 - b.y1
  }
  return { doc, text, place }
}

// ---------------------------------------------------------------- per les

const list = []
for (const { n, short, theme } of ALL) {
  const nn = String(n).padStart(2, '0')
  const file = path.join(app, 'src/lessen', `les${nn}.jsx`)
  if (!fs.existsSync(file)) continue
  const src = fs.readFileSync(file, 'utf8')
  const title = (src.match(/export const meta = \{[\s\S]*?title: '((?:[^'\\]|\\.)*)'/) || [])[1] || short
  const prefix = (src.match(/const T = n => '([^']+)' \+ n/) || [])[1] || `les${nn}/l${nn}-`
  const B = builder()
  let y = 0, used = new Set(), drawings = 0
  const para = (s, style, gap = 19) => { for (const l of wrap(s)) { B.text(0, y, l, style); y += gap } }
  B.text(0, y, `Les ${n} · ${clean(title)}`, { bold: true, size: 24 }); y += 30
  B.text(0, y, `${theme}. Lesstof uit het lesoverzicht: tekeningen met uitleg per hoofdstuk.`, { size: 13, italic: true, color: '#6b7280' }); y += 44

  for (const ch of src.matchAll(/<Chapter id="([\w-]+)" n=\{(\d+)\} title="([^"]+)"[^>]*>([\s\S]*?)<\/Chapter>/g)) {
    const [, cid, cn, ctitle, body] = ch
    if (SKIP_CHAPTERS.has(cid)) continue
    const items = []
    for (const m of body.matchAll(/<Why>([\s\S]*?)<\/Why>/g)) items.push({ p: m.index, kind: 'why', s: clean(m[1]) })
    for (const m of body.matchAll(/<Remember items=\{\[([\s\S]*?)\]\}\s*\/>/g)) items.push({ p: m.index, kind: 'rem', list: strings(m[1]).map(clean) })
    for (const m of body.matchAll(/\bT\('([^']+)'\)/g)) items.push({ p: m.index, kind: 'draw', key: prefix + m[1] })
    items.sort((a, b) => a.p - b.p)
    const draws = items.filter(i => i.kind === 'draw' && index[i.key] && !used.has(i.key))
    if (!draws.length && !items.some(i => i.kind === 'why')) continue

    B.text(0, y, `${cn}. ${clean(ctitle)}`, { bold: true, size: 19, color: '#1d4ed8' }); y += 28
    for (const it of items) {
      if (it.kind === 'why' && it.s) { para(it.s, { size: 13, italic: true }); y += 10 }
      else if (it.kind === 'rem' && it.list.length) {
        B.text(0, y, 'Onthoud', { bold: true, size: 13, color: '#047857' }); y += 19
        for (const s of it.list) { const ls = wrap(s, WRAP - 4); ls.forEach((l, i) => { B.text(i ? 12 : 0, y, (i ? '' : '• ') + l, { size: 13, color: '#047857' }); y += 19 }) }
        y += 12
      } else if (it.kind === 'draw') {
        if (!index[it.key] || used.has(it.key)) continue
        const got = labelFor(body, it.p)
        if (got === null) continue
        const label = typeof got === 'string' ? got : got.label, after = typeof got === 'string' ? '' : got.after
        used.add(it.key)
        if (label) { y += 4; para(label, { size: 13, bold: false }, 19); y -= 4 }
        y += 18
        const h = B.place(index[it.key], 24, y)
        y += h + 40; drawings++
        if (after) { y -= 8; para('Waarom: ' + after, { size: 13, italic: true, color: '#6b7280' }); y += 22 }
      }
    }
    y += 30
  }
  if (!drawings) continue
  const out = `les${nn}.chem.json`
  fs.writeFileSync(path.join(outDir, out), JSON.stringify(B.doc))
  list.push({ n, name: `Les ${n} · ${short}`, title: clean(title), theme, file: out, drawings })
  console.log(`les ${nn}: ${drawings} tekeningen, ${Object.keys(B.doc.texts).length} teksten`)
}

if (msExtra && fs.existsSync(msExtra)) {
  fs.copyFileSync(msExtra, path.join(outDir, 'ms-splitsing.chem.json'))
  const at = list.findIndex(l => l.n > 12)
  list.splice(at < 0 ? list.length : at, 0, { n: 12, name: 'MS-splitsing (les 9 en 12)', title: 'Splitsingsmechanismen in de massaspectrometrie', theme: 'Structuuropheldering', file: 'ms-splitsing.chem.json', extra: true })
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(list, null, 1))
console.log(list.length + ' lesstof-tekeningen in ' + outDir)
