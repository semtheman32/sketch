/*
 * A small, safe formatter for Claude's chat replies: paragraphs, bullet and numbered lists,
 * **bold**, *italic*, `code`, chemical formulas with subscripts (C6H6 → C₆H₆), and atom ids
 * (a12) as buttons that select that atom on the canvas. No HTML is ever injected.
 */
import type { ReactNode } from 'react'
import type { Doc, ID } from '../model/types'
import { exists } from '../model/types'
import { ELEMENTS } from '../chem/elements'

const SUB = '₀₁₂₃₄₅₆₇₈₉'
/** Words that look like formulas but are reaction names. */
const NOT_FORMULAS = new Set(['SN1', 'SN2', 'E1', 'E2', 'E1CB', 'SNAR', 'S8', 'H1', 'C13', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'])

function formula(word: string): string | null {
  if (!/\d/.test(word) || NOT_FORMULAS.has(word.toUpperCase())) return null
  const parts = word.match(/[A-Z][a-z]?\d*/g)
  if (!parts || parts.join('') !== word || parts.length < 2) return null
  if (!parts.every(p => p.replace(/\d+/, '') in ELEMENTS)) return null
  return word.replace(/\d/g, d => SUB[+d])
}

type RefHandler = (id: ID) => void

function inline(text: string, doc: Doc, onRef: RefHandler, key: string): ReactNode[] {
  const out: ReactNode[] = []
  // Tokens: **bold**, *italic*, `code`, ids like a12/b3, formula-like words.
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\b[abrctk]\d+\b|\b[A-Z][A-Za-z0-9]*\d[A-Za-z0-9]*\b)/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${key}-${i++}`
    if (tok.startsWith('**')) out.push(<strong key={k}>{inline(tok.slice(2, -2), doc, onRef, k)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('*')) out.push(<em key={k}>{inline(tok.slice(1, -1), doc, onRef, k)}</em>)
    else if (/^[abrctk]\d+$/.test(tok) && exists(doc, tok)) {
      out.push(<button key={k} className="atom-ref" onClick={() => onRef(tok)} title="Select it on the canvas">{tok}</button>)
    } else out.push(formula(tok) ?? tok)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function RichText({ text, doc, onRef }: { text: string; doc: Doc; onRef: RefHandler }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter(l => l.trim())
        if (!lines.length) return null
        if (lines.every(l => /^\s*[-*•]\s+/.test(l))) {
          return <ul key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*•]\s+/, ''), doc, onRef, `${bi}-${li}`)}</li>)}</ul>
        }
        if (lines.every(l => /^\s*\d+[.)]\s+/.test(l))) {
          return <ol key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''), doc, onRef, `${bi}-${li}`)}</li>)}</ol>
        }
        const clean = lines.map(l => l.replace(/^#{1,6}\s+/, '')) // headings read as plain lines in a chat bubble
        return <p key={bi}>{clean.flatMap((l, li) => [li ? <br key={`br${li}`} /> : null, ...inline(l, doc, onRef, `${bi}-${li}`)])}</p>
      })}
    </>
  )
}
