import { useEffect, useRef, useState } from 'react'
import type { Doc, ID } from '../model/types'
import {
  askHint, checkDrawing, lastError, openExercise, outOfCourse, removeExercise, requestExercise, restartExercise,
  setCourseOnly, setLang, showSolution, stopPractice, usePractice, type Feedback, type Verdict,
} from '../chat/practice'
import { flashItems } from '../model/flash'
import { RichText } from './RichText'
import { Icon } from './Icons'

const TOPICS = [
  'SN1 / SN2', 'E1 / E2', 'Addition to alkenes', 'Carbonyl addition (Grignard, hydride)', 'Acetals and imines',
  'Ester hydrolysis and transesterification', 'Aldol and enolates', 'Claisen / Dieckmann', 'Michael / Robinson',
  'Electrophilic aromatic substitution', 'Carbocation rearrangements', 'Wittig', 'Protecting groups',
]
const LEVELS = ['easy', 'medium', 'hard'] as const

const T = {
  en: {
    intro: 'Get an exercise, draw the mechanism on the canvas with curly arrows, then press Check.',
    topic: 'Topic', random: 'Random topic', newEx: 'New exercise', own: 'Or type your own question…', useOwn: 'Use my question',
    check: 'Check', hint: 'Hint', solution: 'Solution', restart: 'Start over', exercises: 'Exercises', solved: 'solved',
    working: { new: 'Making an exercise', check: 'Checking your drawing', hint: 'Thinking of a hint', solution: 'Drawing the solution' },
    verdict: { correct: 'Correct', almost: 'Almost', incorrect: 'Not yet' } as Record<Verdict, string>,
    undoNote: 'Opening an exercise starts a fresh canvas. Undo (Ctrl+Z) brings your previous drawing back.',
    hintLabel: 'Hint', solutionLabel: 'Solution', remove: 'Remove', stop: 'Stop',
    sessionNote: 'A Claude Code session can add whole sets too (for example from your lecture notes).',
    courseOnly: 'Only course material',
    courseOnlyTip: 'Show only exercises you can solve with the course material, and keep new exercises inside it (course.md).',
    beyond: 'beyond the course', hidden: 'hidden',
  },
  nl: {
    intro: 'Vraag een opgave, teken het mechanisme met curly arrows op het canvas en druk op Nakijken.',
    topic: 'Onderwerp', random: 'Willekeurig onderwerp', newEx: 'Nieuwe opgave', own: 'Of typ je eigen vraag…', useOwn: 'Gebruik mijn vraag',
    check: 'Nakijken', hint: 'Hint', solution: 'Uitwerking', restart: 'Opnieuw', exercises: 'Opgaven', solved: 'goed',
    working: { new: 'Opgave maken', check: 'Tekening nakijken', hint: 'Hint bedenken', solution: 'Uitwerking tekenen' },
    verdict: { correct: 'Goed', almost: 'Bijna', incorrect: 'Nog niet' } as Record<Verdict, string>,
    undoNote: 'Een opgave opent op een leeg canvas. Ongedaan maken (Ctrl+Z) haalt je vorige tekening terug.',
    hintLabel: 'Hint', solutionLabel: 'Uitwerking', remove: 'Verwijderen', stop: 'Stop',
    sessionNote: 'Een Claude Code-sessie kan ook hele sets toevoegen (bijvoorbeeld uit je lesoverzichten).',
    courseOnly: 'Alleen lesstof',
    courseOnlyTip: 'Toon alleen opgaven die je met de gegeven lesstof kunt oplossen, en houd nieuwe opgaven binnen de lesstof (course.md).',
    beyond: 'buiten de lesstof', hidden: 'verborgen',
  },
}

export function PracticePanel({ doc, setSelection }: { doc: Doc; setSelection: (ids: ID[]) => void }) {
  const p = usePractice()
  const t = T[p.lang]
  const [topic, setTopic] = useState('')
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('medium')
  const [own, setOwn] = useState('')
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const ex = p.exercises[p.current]
  const feedback = ex ? p.feedback[ex.id] ?? [] : []
  const attempt = ex ? p.attempts[ex.id] : undefined

  // Show the newest feedback (or the top of a newly opened exercise).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const last = el.querySelector('.fb:last-child')
    if (last) last.scrollIntoView({ block: 'start', behavior: 'smooth' })
    else el.scrollTop = 0
  }, [feedback.length, p.current])

  // Keep the original index: open/remove work on the full list.
  const listed = p.exercises.map((e, i) => ({ e, i })).filter(({ e }) => !(p.courseOnly && outOfCourse(e)))
  const hiddenCount = p.exercises.length - listed.length
  const solved = listed.filter(({ e }) => p.attempts[e.id]?.verdict === 'correct').length
  const showRef = (id: ID) => { setSelection([id]); flashItems([id]) }
  const guard = async (fn: () => unknown) => {
    setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const busy = p.busy
  const disabled = !!busy || !p.available

  return (
    <div className="practice">
      <div className="practice-top">
        {p.exercises.length > 0 && <span className="muted small">{solved}/{listed.length} {t.solved}</span>}
        <label className="course-only" title={t.courseOnlyTip}>
          <input type="checkbox" checked={p.courseOnly} onChange={e => setCourseOnly(e.target.checked)} />
          {t.courseOnly}
        </label>
        <div className="seg-mini" role="group" aria-label="Language">
          {(['nl', 'en'] as const).map(l => (
            <button key={l} className={p.lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {ex ? (
          <section className="ex-card">
            <div className="ex-meta">
              {[ex.topic, ex.difficulty, ex.source, outOfCourse(ex) ? t.beyond : ''].filter(Boolean).join(' · ')}
              {attempt?.verdict && <span className={'verdict ' + attempt.verdict}>{t.verdict[attempt.verdict]}</span>}
            </div>
            <h3>{ex.title}</h3>
            <div className="rich"><RichText text={ex.question} doc={doc} onRef={showRef} /></div>
            <div className="ex-actions">
              <button className="btn primary" disabled={disabled} onClick={checkDrawing}>{t.check}</button>
              <button className="btn" disabled={disabled} onClick={askHint}>{t.hint}</button>
              <button className="btn" disabled={disabled} onClick={showSolution}>{t.solution}</button>
              {ex.setup && <button className="text-btn" disabled={!!busy} onClick={() => guard(restartExercise)} title={t.undoNote}>{t.restart}</button>}
            </div>
            {feedback.length > 0 && (
              <ol className="feedback">
                {feedback.map((f, i) => <FeedbackItem key={i} f={f} t={t} doc={doc} onRef={showRef} />)}
              </ol>
            )}
          </section>
        ) : (
          <p className="muted">{t.intro}</p>
        )}

        {busy && (
          <div className="practice-busy">
            <div className="typing"><span /><span /><span /></div>
            <span>{t.working[busy.kind]}…</span>
            <button className="text-btn" onClick={stopPractice}>{t.stop}</button>
          </div>
        )}
        {(error || (!busy && lastError)) && <div className="msg-error">{error || lastError}</div>}

        <section className="ex-new">
          <div className="ex-new-row">
            <select value={topic} onChange={e => setTopic(e.target.value)} aria-label={t.topic}>
              <option value="">{t.random}</option>
              {TOPICS.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <div className="seg-mini" role="group" aria-label="Level">
              {LEVELS.map(l => <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l}</button>)}
            </div>
          </div>
          <button className="btn primary wide" disabled={disabled} onClick={() => requestExercise({ topic, difficulty: level })}>
            <Icon name="sparkles" size={15} /> {t.newEx}
          </button>
          <form className="composer" onSubmit={e => { e.preventDefault(); if (own.trim()) { requestExercise({ own }); setOwn('') } }}>
            <textarea
              value={own} rows={1} placeholder={t.own}
              onChange={e => setOwn(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (own.trim() && !disabled) { requestExercise({ own }); setOwn('') } }
              }}
            />
            <button type="submit" className="send-btn" disabled={!own.trim() || disabled} aria-label={t.useOwn} title={t.useOwn}><Icon name="send" size={16} /></button>
          </form>
          <p className="muted small">{t.undoNote} {t.sessionNote}</p>
        </section>

        {p.exercises.length > 0 && (
          <details className="ex-list" open={listed.length <= 8}>
            <summary>{t.exercises} ({listed.length}{hiddenCount > 0 ? `, ${hiddenCount} ${t.hidden}` : ''})</summary>
            <ol>
              {listed.map(({ e, i }) => {
                const v = p.attempts[e.id]?.verdict
                return (
                  <li key={e.id} className={i === p.current ? 'on' : ''}>
                    <span className={'vdot ' + (v ?? '')} title={v ? t.verdict[v] : ''} />
                    <button className="ex-open" disabled={!!busy} onClick={() => guard(() => openExercise(i))}>
                      <span className="ex-title">{e.title}</span>
                      {(e.difficulty || e.source || outOfCourse(e)) && <span className="muted small">{[e.difficulty, e.source, outOfCourse(e) ? t.beyond : ''].filter(Boolean).join(' · ')}</span>}
                    </button>
                    <button className="icon-btn" disabled={!!busy} onClick={() => removeExercise(i)} aria-label={t.remove} title={t.remove}><Icon name="close" size={13} /></button>
                  </li>
                )
              })}
            </ol>
          </details>
        )}
      </div>
    </div>
  )
}

function FeedbackItem({ f, t, doc, onRef }: { f: Feedback; t: (typeof T)['en']; doc: Doc; onRef: (id: ID) => void }) {
  const label = f.kind === 'check' && f.verdict ? t.verdict[f.verdict] : f.kind === 'hint' ? t.hintLabel : f.kind === 'solution' ? t.solutionLabel : ''
  return (
    <li className={'fb fb-' + f.kind + (f.verdict ? ' ' + f.verdict : '')}>
      {label && <div className="fb-label">{label}</div>}
      <div className="rich"><RichText text={f.summary} doc={doc} onRef={onRef} /></div>
      {f.points && f.points.length > 0 && (
        <ul className="fb-points">
          {f.points.map((pt, i) => (
            <li key={i} className={pt.ok ? 'ok' : 'bad'}>
              <span className="mark">{pt.ok ? '✓' : '✗'}</span>
              <span className="rich"><RichText text={pt.text} doc={doc} onRef={onRef} /></span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
