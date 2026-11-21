/*
 * Practice mode: mechanism exercises you draw yourself and have checked.
 *
 * Exercises come from three places:
 *   - the Practice tab ("New exercise"), which asks Claude for one through chat/plugin.mjs;
 *   - your own question typed into the Practice tab;
 *   - a Claude Code session, through the bridge tools practice_add_exercises / practice_get_state
 *     (e.g. a session that has your lecture notes and makes a whole set at once).
 * Checking, hints and the worked solution run through chat/plugin.mjs as one-off Claude turns that
 * get the exercise's answer key plus read access to the canvas.
 */
import { useSyncExternalStore } from 'react'
import type { ID } from '../model/types'
import { emptyDoc } from '../model/types'
import { batch, getDoc, replaceDoc } from '../model/store'
import { runMethod } from '../bridge/client'

export interface Species { smiles: string; label?: string }
export interface ExerciseSetup {
  /** Starting materials, drawn left to right with "+" between them. */
  reactants: Species[]
  /** Reagents written above the reaction arrow, conditions below. */
  above?: string
  below?: string
  /** Product drawn after the arrow; leave out to ask for it ("?"). */
  product?: Species[]
}
export interface Exercise {
  id: string
  title: string
  question: string
  /** Hidden from the user until they ask for the solution; given to Claude when checking. */
  answerKey: string
  hints: string[]
  topic?: string
  difficulty?: string
  /** Where it came from, e.g. "Organic Synthesis 2, lecture 4" or "Claude". */
  source?: string
  setup?: ExerciseSetup
  /** true: solvable with the course material (course.md); false: goes beyond it. Unknown when left out. */
  inCourse?: boolean
}
export type Verdict = 'correct' | 'almost' | 'incorrect'
export interface CheckPoint { ok: boolean; text: string }
export interface Feedback {
  kind: 'check' | 'hint' | 'solution' | 'error'
  verdict?: Verdict
  summary: string
  points?: CheckPoint[]
  time: number
}
export interface Attempt { verdict?: Verdict; checks: number; hints: number; solutionShown: boolean }
export type Lang = 'en' | 'nl'

interface PracticeState {
  exercises: Exercise[]
  current: number // index into exercises, -1 when none
  attempts: Record<string, Attempt>
  feedback: Record<string, Feedback[]> // newest last
  busy: null | { kind: 'new' | 'check' | 'hint' | 'solution'; tools: string[] }
  lang: Lang
  available: boolean
  /** "Only course material": hide exercises marked as beyond the course, and keep new ones inside it. */
  courseOnly: boolean
}

const STORAGE_KEY = 'sketch-practice'
const hot = import.meta.hot

let state: PracticeState = { exercises: [], current: -1, attempts: {}, feedback: {}, busy: null, lang: 'en', available: !!hot, courseOnly: false }
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  if (saved?.exercises) state = { ...state, ...saved, busy: null, available: !!hot }
} catch { /* storage unavailable */ }

const listeners = new Set<() => void>()
function set(s: Partial<PracticeState>) {
  state = { ...state, ...s }
  listeners.forEach(l => l())
  try {
    const { busy: _b, available: _a, ...keep } = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keep))
  } catch { /* ignore */ }
}
export const usePractice = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)
export const getPractice = () => state
export const currentExercise = (): Exercise | undefined => state.exercises[state.current]

const attemptOf = (id: string): Attempt => state.attempts[id] ?? { checks: 0, hints: 0, solutionShown: false }
function bumpAttempt(id: string, fn: (a: Attempt) => Partial<Attempt>) {
  const a = attemptOf(id)
  set({ attempts: { ...state.attempts, [id]: { ...a, ...fn(a) } } })
}
function addFeedback(id: string, f: Omit<Feedback, 'time'>) {
  set({ feedback: { ...state.feedback, [id]: [...(state.feedback[id] ?? []), { ...f, time: Date.now() }] } })
}

export function setLang(lang: Lang) { set({ lang }) }
export function setCourseOnly(courseOnly: boolean) { set({ courseOnly }) }

/** Hidden by the "only course material" checkbox. */
export const outOfCourse = (e: Exercise) => e.inCourse === false

/** Mark exercises as inside (true) or beyond (false) the course material. Returns the ids that changed. */
export function setInCourse(ids: string[], inCourse: boolean) {
  const want = new Set(ids)
  const changed: string[] = []
  const exercises = state.exercises.map(e => {
    if (!want.has(e.id)) return e
    changed.push(e.id)
    return { ...e, inCourse }
  })
  set({ exercises })
  return changed
}

let nextId = Date.now()
/** Validate loose input (from Claude or the bridge) into an Exercise. */
export function toExercise(raw: any, source?: string): Exercise {
  if (!raw || typeof raw !== 'object') throw new Error('Each exercise must be an object')
  const question = String(raw.question ?? '').trim()
  const answerKey = String(raw.answer_key ?? raw.answerKey ?? '').trim()
  if (!question) throw new Error('An exercise needs a question')
  if (!answerKey) throw new Error(`Exercise "${question.slice(0, 40)}" needs an answer_key`)
  const sp = (s: any): Species => typeof s === 'string' ? { smiles: s } : { smiles: String(s?.smiles ?? ''), label: s?.label ? String(s.label) : undefined }
  const setup = raw.setup && Array.isArray(raw.setup.reactants) && raw.setup.reactants.length ? {
    reactants: raw.setup.reactants.map(sp).filter((s: Species) => s.smiles),
    above: raw.setup.above ? String(raw.setup.above) : undefined,
    below: raw.setup.below ? String(raw.setup.below) : undefined,
    product: Array.isArray(raw.setup.product) ? raw.setup.product.map(sp).filter((s: Species) => s.smiles) : undefined,
  } : undefined
  return {
    id: `x${(nextId++).toString(36)}`,
    title: String(raw.title ?? '').trim() || question.split(/[.?!\n]/)[0].slice(0, 60),
    question, answerKey,
    hints: Array.isArray(raw.hints) ? raw.hints.map(String).filter(Boolean) : [],
    topic: raw.topic ? String(raw.topic) : undefined,
    difficulty: raw.difficulty ? String(raw.difficulty) : undefined,
    source: raw.source ? String(raw.source) : source,
    setup,
    inCourse: typeof raw.in_course === 'boolean' ? raw.in_course : typeof raw.inCourse === 'boolean' ? raw.inCourse : undefined,
  }
}

/** Add exercises to the list. Returns their ids. With `open`, opens the first new one. */
export async function addExercises(list: Exercise[], { replace = false, open = true } = {}) {
  const exercises = replace ? list : [...state.exercises, ...list]
  set({ exercises, current: replace ? -1 : state.current })
  if (open && list.length) await openExercise(exercises.indexOf(list[0]))
  return list.map(e => e.id)
}

export function removeExercise(index: number) {
  const ex = state.exercises[index]
  if (!ex) return
  const exercises = state.exercises.filter((_, i) => i !== index)
  const current = index === state.current ? -1 : state.current > index ? state.current - 1 : state.current
  set({ exercises, current })
}

/** Make an exercise current and draw its starting point on a fresh canvas (one undo step). */
export async function openExercise(index: number) {
  const ex = state.exercises[index]
  if (!ex) return
  set({ current: index })
  if (ex.setup) await drawSetup(ex.setup)
}

/** Start the current exercise over: redraw its starting point. */
export async function restartExercise() {
  const ex = currentExercise()
  if (ex?.setup) await drawSetup(ex.setup)
}

async function call(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const r = await runMethod(method, params)
  if ('error' in r) throw new Error(r.error)
  return r.result
}

/**
 * Reactants (with "+" between), reaction arrow with reagents, then the product or a "?".
 * Built off-screen and swapped in as a single edit, so one Undo brings back the previous drawing.
 */
let afterDraw = () => {}
/** The app registers how to bring a freshly drawn exercise into view. */
export function onPracticeDrawn(fn: () => void) { afterDraw = fn }

async function drawSetup(s: ExerciseSetup) {
  const before = getDoc()
  try {
    await batch(async () => {
      replaceDoc(emptyDoc())
      let prevRight: number | null = null
      let y = 0
      for (const [i, r] of s.reactants.entries()) {
        const res = await call('add_molecule', { smiles: r.smiles })
        const xs: number[] = res.atoms.map((a: { x: number }) => a.x)
        if (i === 0) y = res.atoms.reduce((t: number, a: { y: number }) => t + a.y, 0) / res.atoms.length
        if (i > 0 && prevRight !== null) await call('add_text', { text: '+', x: (prevRight + Math.min(...xs)) / 2 - 5, y: y + 6, size: 18 })
        prevRight = Math.max(...xs)
      }
      const x1 = (prevRight ?? 0) + 45
      const width = Math.max(110, Math.max(s.above?.length ?? 0, s.below?.length ?? 0) * 7.5 + 20)
      await call('add_reaction_arrow', { x1, y1: y, x2: x1 + width, y2: y, above: s.above ?? '', below: s.below ?? '' })
      if (s.product?.length) for (const p of s.product) await call('add_molecule', { smiles: p.smiles })
      else await call('add_text', { text: '?', x: x1 + width + 30, y: y + 9, size: 26, bold: true })
    })
  } catch (err) {
    replaceDoc(before)
    throw err
  }
  afterDraw()
}

/* ------------------------------------------------------------------ Claude turns */

let runId = 0

/** Ask Claude for a new exercise. `request` is the user's own question, or a topic and level. */
export function requestExercise(opts: { own?: string; topic?: string; difficulty?: string }) {
  run('new', opts)
}
export function checkDrawing() { const ex = currentExercise(); if (ex) { bumpAttempt(ex.id, a => ({ checks: a.checks + 1 })); run('check', { exercise: ex }) } }
export function askHint() { const ex = currentExercise(); if (ex) { bumpAttempt(ex.id, a => ({ hints: a.hints + 1 })); run('hint', { exercise: ex, hintsShown: hintsGiven(ex.id) }) } }
export function showSolution() { const ex = currentExercise(); if (ex) { bumpAttempt(ex.id, () => ({ solutionShown: true })); run('solution', { exercise: ex }) } }
export function stopPractice() { if (state.busy) hot?.send('sketch-practice:stop', { runId }) }

const hintsGiven = (id: string) => (state.feedback[id] ?? []).filter(f => f.kind === 'hint').map(f => f.summary)

function run(kind: NonNullable<PracticeState['busy']>['kind'], payload: Record<string, unknown>) {
  if (state.busy || !hot) return
  runId++
  set({ busy: { kind, tools: [] } })
  hot.send('sketch-practice:run', { runId, kind, lang: state.lang, courseOnly: state.courseOnly, ...payload })
}

/** Record a result that came from elsewhere (a Claude Code session checking through the bridge). */
export function recordFeedback(f: { kind?: Feedback['kind']; verdict?: Verdict; summary: string; points?: CheckPoint[] }) {
  const ex = currentExercise()
  if (!ex) throw new Error('No exercise is open')
  const kind = f.kind ?? (f.verdict ? 'check' : 'hint')
  addFeedback(ex.id, { kind, verdict: f.verdict, summary: f.summary, points: f.points })
  if (f.verdict) bumpAttempt(ex.id, a => ({ verdict: best(a.verdict, f.verdict!), checks: a.checks + 1 }))
  return { exercise: ex.id, recorded: kind }
}

const RANK: Record<Verdict, number> = { incorrect: 0, almost: 1, correct: 2 }
const best = (a: Verdict | undefined, b: Verdict) => (!a || RANK[b] > RANK[a] ? b : a)

type PracticeEvent =
  | { runId: number; type: 'tool'; name: string }
  | { runId: number; type: 'done'; error?: string; stopped?: boolean; result?: any }

if (hot) {
  hot.on('sketch-practice:event', async (ev: PracticeEvent) => {
    if (ev.runId !== runId || !state.busy) return
    if (ev.type === 'tool') { set({ busy: { ...state.busy, tools: [...state.busy.tools, ev.name] } }); return }
    const kind = state.busy.kind
    set({ busy: null })
    const ex = currentExercise()
    if (ev.stopped) return
    if (ev.error || !ev.result) {
      const msg = ev.error || 'Claude finished without an answer. Try again.'
      if (ex && kind !== 'new') addFeedback(ex.id, { kind: 'error', summary: msg })
      else { lastError = msg; set({}) }
      return
    }
    lastError = ''
    const r = ev.result
    if (kind === 'new') {
      try {
        const made = toExercise(r, 'Claude')
        // Made while "only course material" was on: the prompt kept it inside course.md.
        if (state.courseOnly && made.inCourse === undefined) made.inCourse = true
        await addExercises([made])
      } catch (err) { lastError = err instanceof Error ? err.message : String(err); set({}) }
    } else if (ex) {
      if (kind === 'check') {
        const verdict: Verdict = ['correct', 'almost', 'incorrect'].includes(r.verdict) ? r.verdict : 'incorrect'
        addFeedback(ex.id, { kind, verdict, summary: String(r.summary ?? ''), points: Array.isArray(r.points) ? r.points.map((p: any) => ({ ok: !!p.ok, text: String(p.text ?? '') })) : [] })
        bumpAttempt(ex.id, a => ({ verdict: best(a.verdict, verdict) }))
      } else {
        addFeedback(ex.id, { kind, summary: String(r.text ?? r.explanation ?? '') })
      }
    }
  })
  hot.on('vite:ws:disconnect', () => { if (state.busy) { set({ busy: null }); lastError = 'Lost the connection to the dev server.' } })
  hot.accept(() => location.reload())
}

/** Error from the last "New exercise" request (shown in the panel). */
export let lastError = ''

/** For the bridge: what is open, how it is going, and the list. */
export function practiceSummary() {
  const ex = currentExercise()
  return {
    current: ex ? { ...ex, attempt: attemptOf(ex.id), feedback: state.feedback[ex.id] ?? [] } : null,
    exercises: state.exercises.map((e, i) => ({ index: i, id: e.id, title: e.title, topic: e.topic, difficulty: e.difficulty, source: e.source, in_course: e.inCourse ?? null, verdict: state.attempts[e.id]?.verdict ?? null })),
    language: state.lang,
    course_only: state.courseOnly,
  }
}

export const exerciseIndex = (id: ID) => state.exercises.findIndex(e => e.id === id)
