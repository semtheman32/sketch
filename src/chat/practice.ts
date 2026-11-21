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
import type { Doc, ID } from '../model/types'
import { emptyDoc } from '../model/types'
import { batch, getDoc, replaceDoc } from '../model/store'
import { runMethod } from '../bridge/client'
import { drawMechanism } from '../bridge/mechanism'

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
  /** Which kind of reaction this is (shown with a check). */
  reactionType?: string
  summary: string
  points?: CheckPoint[]
  time: number
}
export interface Attempt {
  verdict?: Verdict; checks: number; hints: number; solutionShown: boolean
  /** Ticked off by the user ("I've done this one"), whatever Claude's verdict. */
  done?: boolean
}
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
  /** Exercise ids in the order they were opened, like browser history; historyPos is where Back/Next stand. */
  history: string[]
  historyPos: number
}

const STORAGE_KEY = 'sketch-practice'
const hot = import.meta.hot

let state: PracticeState = { exercises: [], current: -1, attempts: {}, feedback: {}, busy: null, lang: 'en', available: !!hot, courseOnly: false, history: [], historyPos: -1 }
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  if (saved?.exercises) state = { ...state, ...saved, busy: null, available: !!hot }
} catch { /* storage unavailable */ }
// Lists saved before there was a history start it at the open exercise.
if (!state.history?.length && state.exercises[state.current]) state = { ...state, history: [state.exercises[state.current].id], historyPos: 0 }

/* Your drawing for each exercise, so going back shows it again (the 30 most recent, in their own storage key). */
const DRAWINGS_KEY = 'sketch-practice-drawings'
function loadDrawings(): Record<string, Doc> {
  try { return JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? '{}') ?? {} } catch { return {} }
}
function saveDrawing(id: string, doc: Doc) {
  const all = loadDrawings()
  delete all[id]
  all[id] = doc
  const ids = Object.keys(all)
  for (const old of ids.slice(0, Math.max(0, ids.length - 30))) delete all[old]
  try { localStorage.setItem(DRAWINGS_KEY, JSON.stringify(all)) } catch { /* storage full: keep going without */ }
}

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
/** Tick an exercise off as done (or untick it). Independent of Claude's verdict. */
export function setDone(id: string, done: boolean) { bumpAttempt(id, () => ({ done })) }
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
  const history = state.history.filter(id => id !== ex.id)
  const historyPos = state.history.slice(0, state.historyPos + 1).filter(id => id !== ex.id).length - 1
  set({ exercises, current, history, historyPos: Math.min(historyPos, history.length - 1) })
}

/**
 * Make an exercise current (one undo step). Shows your earlier drawing for it if there is one,
 * otherwise its starting point on a fresh canvas. Your drawing of the exercise you leave is kept.
 * `fromHistory`: opened by Back/Next, so the history itself stays as it is.
 */
export async function openExercise(index: number, { fromHistory = false } = {}) {
  const ex = state.exercises[index]
  if (!ex) return
  const leaving = currentExercise()
  const switching = leaving?.id !== ex.id
  if (leaving && switching) saveDrawing(leaving.id, getDoc())
  let { history, historyPos } = state
  if (!fromHistory && history[historyPos] !== ex.id) {
    history = [...history.slice(0, historyPos + 1), ex.id].slice(-100)
    historyPos = history.length - 1
  }
  set({ current: index, history, historyPos })
  const saved = switching ? loadDrawings()[ex.id] : undefined
  if (saved) { replaceDoc(saved); afterDraw() }
  else if (ex.setup) await drawSetup(ex.setup)
}

/** Step through the history (skipping exercises removed since). Returns false at either end. */
async function stepHistory(dir: 1 | -1) {
  for (let pos = state.historyPos + dir; pos >= 0 && pos < state.history.length; pos += dir) {
    const i = state.exercises.findIndex(e => e.id === state.history[pos])
    if (i < 0) continue
    set({ historyPos: pos })
    await openExercise(i, { fromHistory: true })
    return true
  }
  return false
}

export const canGoBack = (s: PracticeState = state) =>
  s.history.slice(0, Math.max(0, s.historyPos)).some(id => s.exercises.some(e => e.id === id))

/** Exercises Next may pick when there is no history ahead: same level as the open one, not yet done first. */
function nextCandidates(s: PracticeState = state) {
  const all = s.exercises.map((e, i) => ({ e, i })).filter(({ e, i }) => i !== s.current && !(s.courseOnly && outOfCourse(e)))
  const level = s.exercises[s.current]?.difficulty?.toLowerCase()
  const same = level ? all.filter(({ e }) => e.difficulty?.toLowerCase() === level) : all
  const base = same.length ? same : all
  const notYet = base.filter(({ e }) => !s.attempts[e.id]?.done && s.attempts[e.id]?.verdict !== 'correct')
  return notYet.length ? notYet : base
}
export const canGoNext = (s: PracticeState = state) =>
  s.history.slice(s.historyPos + 1).some(id => s.exercises.some(e => e.id === id)) || nextCandidates(s).length > 0

export async function goBack() { await stepHistory(-1) }

/** Forward in the history, or at its end a random exercise from the list (same level, not done yet first). */
export async function goNext() {
  if (await stepHistory(1)) return
  const pool = nextCandidates()
  if (pool.length) await openExercise(pool[Math.floor(Math.random() * pool.length)].i)
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
      await drawMechanism({
        x: 0, y: 0, width: Infinity, lonePairs: 'none',
        steps: [
          { species: s.reactants, then: { above: s.above ?? '', below: s.below ?? '' } },
          { species: s.product?.length ? s.product : [{ smiles: '?' }] },
        ],
      })
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
// Check and Hint send the drawing along (as compact text), so Claude can answer in one round.
export async function checkDrawing() {
  const ex = currentExercise()
  if (!ex || state.busy) return
  bumpAttempt(ex.id, a => ({ checks: a.checks + 1 }))
  run('check', { exercise: ex, drawing: await call('get_document') })
}
export async function askHint() {
  const ex = currentExercise()
  if (!ex || state.busy) return
  bumpAttempt(ex.id, a => ({ hints: a.hints + 1 }))
  run('hint', { exercise: ex, hintsShown: hintsGiven(ex.id), drawing: await call('get_document') })
}
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
export function recordFeedback(f: { kind?: Feedback['kind']; verdict?: Verdict; reactionType?: string; summary: string; points?: CheckPoint[] }) {
  const ex = currentExercise()
  if (!ex) throw new Error('No exercise is open')
  const kind = f.kind ?? (f.verdict ? 'check' : 'hint')
  addFeedback(ex.id, { kind, verdict: f.verdict, reactionType: f.reactionType, summary: f.summary, points: f.points })
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
        addFeedback(ex.id, { kind, verdict, reactionType: r.reaction_type ? String(r.reaction_type) : undefined, summary: String(r.summary ?? ''), points: Array.isArray(r.points) ? r.points.map((p: any) => ({ ok: !!p.ok, text: String(p.text ?? '') })) : [] })
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
    exercises: state.exercises.map((e, i) => ({ index: i, id: e.id, title: e.title, topic: e.topic, difficulty: e.difficulty, source: e.source, in_course: e.inCourse ?? null, verdict: state.attempts[e.id]?.verdict ?? null, done: !!state.attempts[e.id]?.done })),
    language: state.lang,
    course_only: state.courseOnly,
  }
}

export const exerciseIndex = (id: ID) => state.exercises.findIndex(e => e.id === id)
