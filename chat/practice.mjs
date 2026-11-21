/*
 * Prompts and submit tools for practice mode (see plugin.mjs and src/chat/practice.ts).
 * Each practice request is a one-off Claude turn that ends by calling one submit_* tool.
 */
import * as z from 'zod'
import fs from 'node:fs'
import path from 'node:path'

/** Optional course syllabus (course.md in the project root). When present, new exercises stay inside it. */
function courseText() {
  try { return fs.readFileSync(path.resolve(process.cwd(), 'course.md'), 'utf8').trim() } catch { return '' }
}

export const PRACTICE_SYSTEM = `
You are an organic chemistry tutor inside Sketch, a drawing app for molecules and reaction mechanisms.
The user is practising mechanisms, a bit like NMR Challenge but for curly arrows: they get an exercise,
draw the mechanism themselves on the canvas, and press Check. You make exercises, check drawings, give
hints and show worked solutions. Be precise about the chemistry and honest in grading, and keep the tone
encouraging and short. You finish every request by calling the submit tool you are given, exactly once,
and write nothing else: only the submit tool's content is shown to the user.

Formatting in the texts you submit: **bold**, *italic* and short bullet lists work; formulas like H2O get
subscripts; ids like a12 (atom), b3 (bond), c4 (curly arrow) become buttons that highlight that item.
`.trim()

const LANG = { en: 'English', nl: 'Dutch (Nederlands)' }

const species = z.object({ smiles: z.string().describe('Complete, valid SMILES with charges, e.g. "CC(C)(C)Br" or "[OH-]"'), label: z.string().optional() })

const SUBMIT = {
  exercise: {
    name: 'submit_exercise',
    description: 'Hand over the exercise. The app draws the setup and shows the question; the answer key and hints stay hidden until asked for.',
    shape: {
      title: z.string().describe('Short title, e.g. "E1 of tert-butyl bromide"'),
      question: z.string().describe('The task as the user sees it, e.g. "Draw the mechanism with curly arrows, including all intermediates and formal charges."'),
      answer_key: z.string().describe('Full worked answer for the grader: numbered steps, each with every curly arrow (from which lone pair or bond to which atom or bond), the SMILES of each intermediate with charges, the final product SMILES, and acceptable alternatives (other bases, combined proton transfers…).'),
      hints: z.array(z.string()).describe('2 or 3 hints, from a gentle nudge to almost the answer. Never the full answer.'),
      topic: z.string().describe('e.g. "SN1", "aldol", "acetal formation"'),
      difficulty: z.enum(['easy', 'medium', 'hard']),
      setup: z.object({
        reactants: z.array(species).min(1).describe('Starting materials, drawn left to right with "+" between them. Put simple reagents (H2O, NaOH, H2SO4…) in above/below instead.'),
        above: z.string().optional().describe('Reagents above the arrow, e.g. "NaOEt"'),
        below: z.string().optional().describe('Conditions below the arrow, e.g. "EtOH, heat"'),
        product: z.array(species).optional().describe('Main product(s) shown after the arrow. Leave out when the user must predict the product (the app shows "?").'),
      }).optional().describe('What the app draws on a fresh canvas. Leave out only when the user already drew the starting materials and asked you to use them.'),
    },
  },
  check: {
    name: 'submit_check',
    description: 'Hand over the grading of the user\'s drawing.',
    shape: {
      reaction_type: z.string().describe('The kind of reaction, short, e.g. "Acid-catalysed epoxide opening (SN1-like)", "E2 (Zaitsev)", "Electrophilic addition of HBr (Markovnikov)". Shown above the verdict.'),
      verdict: z.enum(['correct', 'almost', 'incorrect']).describe('correct: complete, chemically right mechanism. almost: right mechanism with small slips (a missing charge, a skipped proton transfer, an arrow slightly off). incorrect: wrong step, wrong product, or not finished. Judge the drawing only: a missing written explanation never lowers the verdict.'),
      summary: z.string().describe('One or two sentences: the overall verdict and the single most important thing to fix.'),
      points: z.array(z.object({ ok: z.boolean(), text: z.string() })).describe('Step by step: what is right (ok=true) and what is wrong (ok=false). Point at items by id. For mistakes, say what is wrong and ask a guiding question; do not give the corrected structure unless the verdict is almost.'),
    },
  },
  hint: {
    name: 'submit_hint',
    description: 'Hand over one hint.',
    shape: { text: z.string().describe('One short hint for the next thing the user should do, based on what they have drawn so far. Do not give away the whole answer.') },
  },
  solution: {
    name: 'submit_solution',
    description: 'Hand over the explanation of the worked solution you drew.',
    shape: { explanation: z.string().describe('Short numbered walk-through of the steps you drew, naming the key idea of each (which electrons attack what, and why).') },
  },
}

const exerciseText = ex => `Exercise: ${ex.title}
Question shown to the user: ${ex.question}
${ex.setup ? `The app drew this setup: reactants ${ex.setup.reactants.map(r => r.smiles).join(' + ')}, arrow with "${ex.setup.above ?? ''}" above and "${ex.setup.below ?? ''}" below, then ${ex.setup.product?.length ? `the product ${ex.setup.product.map(p => p.smiles).join(' + ')}` : 'a "?" (the user must find the product)'}.` : 'The user drew the starting materials themselves.'}

Answer key (hidden from the user):
${ex.answerKey}${ex.hints?.length ? `\n\nPrepared hints: ${ex.hints.map((h, i) => `(${i + 1}) ${h}`).join(' ')}` : ''}`

/** Build the turn for one practice request. Returns the prompt, which canvas tools it gets, and its submit tool. */
export function practicePrompt(msg) {
  const lang = `Write every text the user will see in ${LANG[msg.lang] ?? LANG.en}.`
  switch (msg.kind) {
    case 'new': {
      const own = String(msg.own ?? '').trim()
      const ask = own
        ? `The user typed their own exercise:\n"""\n${own}\n"""\nTurn it into an exercise: keep their wording for the question as far as possible, and work out the answer key. If they say the starting materials are already drawn ("this", "what I drew"), call get_document first and leave out setup.`
        : `Make one new mechanism exercise. Topic: ${msg.topic || 'any classic organic reaction mechanism (choose one at random, vary it)'}. Level: ${msg.difficulty || 'medium'}.
Easy: one or two steps, common reagents (SN2, E2, acid-base, simple carbonyl addition). Medium: two to four steps with intermediates (SN1/E1 with carbocations, acetal or imine formation, ester hydrolysis, aldol, Grignard, EAS). Hard: longer or subtler mechanisms (rearrangements, Claisen/Dieckmann, Michael + Robinson, Wittig, neighbouring-group effects, pericyclic).
Use a real reaction that works as written. Usually give the product and ask for the mechanism; sometimes (about one in three) leave the product out and ask for product and mechanism.`
      const course = msg.courseOnly ? courseText() : ''
      const scope = course
        ? `\n\nThe user is studying for this course. Only make exercises about reactions and mechanisms that are in this syllabus; this overrides the topic and level examples above. If the chosen topic is not in the syllabus, pick the closest topic that is, and make "hard" mean longer combinations of these reactions with stereochemistry, not reactions from outside the course. Put the lesson in "topic" (e.g. "Les 8 · halohydrine").\n\n<syllabus>\n${course}\n</syllabus>`
        : ''
      return {
        prompt: `${ask}${scope}\n\nCheck that every SMILES is valid and balanced in charge. ${lang}\nThen call submit_exercise.`,
        tools: own ? ['get_document'] : [],
        submit: SUBMIT.exercise,
      }
    }
    case 'check':
      return {
        prompt: `${exerciseText(msg.exercise)}

The user says they are done and asks you to check their drawing. This is the canvas now (atoms per molecule with charges and lone pairs, bonds, curly arrows "c1 a5>b2" from > to, reaction arrows, texts):
<drawing>
${msg.drawing ?? '(not available: call get_document)'}
</drawing>
Grade from this text. Call screenshot only if the layout really matters for your verdict and the text cannot tell you (it usually can).
- Accept any chemically valid mechanism, not only the one in the answer key (other order of proton transfers, another base, curly arrows drawn on a separate copy of a species…).
- Each curly arrow must start at electrons (a lone pair on an atom, or a bond) and end at the atom or bond the electrons go to. A curly arrow whose "from" is an atom means its lone pair.
- Check intermediates and product: structure, formal charges, and that mass and charge balance.
- Lone pairs drawn as dots are optional unless the question asks for them.
- If nothing beyond the setup is drawn, the verdict is incorrect and the summary says to draw the mechanism first.
- Grade the drawing (arrows, intermediates, charges, product, stereochemistry). Written explanations ("why", "explain") are a bonus: if one is missing, never mark a point as wrong (ok=false) for it and never lower the verdict. You may add one ok=true point starting with "Bonus:" that names what a short explanation could say.
- Fill reaction_type (in the user's language) with the kind of reaction this exercise is, so the user learns to recognise it.
${lang}
Then call submit_check.`,
        tools: msg.drawing ? ['screenshot'] : ['get_document', 'screenshot'],
        submit: SUBMIT.check,
      }
    case 'hint':
      return {
        prompt: `${exerciseText(msg.exercise)}
${msg.hintsShown?.length ? `\nHints already given: ${msg.hintsShown.map(h => `"${h}"`).join(', ')}. Give the next one, a bit more concrete.` : ''}

The user asks for a hint. This is what they have drawn so far (atoms per molecule, bonds, curly arrows "c1 a5>b2" from > to):
<drawing>
${msg.drawing ?? '(not available: call get_document)'}
</drawing>
Give one hint for their next step (or for their first mistake). ${lang}
Then call submit_hint.`,
        tools: msg.drawing ? [] : ['get_document'],
        submit: SUBMIT.hint,
      }
    case 'solution':
      return {
        prompt: `${exerciseText(msg.exercise)}

The user asks for the worked solution. Draw the complete mechanism with ONE draw_mechanism call, titled "${msg.lang === 'nl' ? 'Uitwerking' : 'Solution'}" (it goes below the user's drawing by itself): one step per intermediate, with that step's curly arrows on its species and the reagents on the reaction arrow to the next step; the last step holds the products. Draw explicit H only where an arrow needs one ("2.3H"). Do not move, change or delete anything the user drew.
Then take one screenshot. Fix only clear problems (a wrong structure, an arrow on the wrong atom) with the editing tools; don't redraw for small layout details.
${lang}
Then call submit_solution.`,
        tools: ['draw_mechanism', 'screenshot', 'get_document', 'delete_items', 'move', 'set_atom', 'add_curly_arrow', 'set_text'],
        submit: SUBMIT.solution,
      }
    default:
      throw new Error(`Unknown practice request ${msg.kind}`)
  }
}
