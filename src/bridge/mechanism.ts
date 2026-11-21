/*
 * Draw a whole reaction mechanism from one description: species from SMILES laid out left to right,
 * "+" signs, reaction arrows with reagents, curly arrows and lone pairs. Used by Claude's draw_mechanism
 * tool (one call instead of dozens) and by practice mode to draw an exercise's setup.
 */
import type { ArrowKind, Doc, ID } from '../model/types'
import { batch, commit, getDoc, newId, replaceDoc } from '../model/store'
import { contentBounds, growBond, moveItems } from '../model/ops'
import { adjacency, bondOrderSum, hCount, type Adjacency } from '../chem/chem'
import { addMolecule } from '../actions'
import { autoBend } from '../render/layout'

export interface MechSpecies { smiles: string }
export interface MechArrow { from: string; to: string; half?: boolean }
export interface MechStep {
  species: MechSpecies[]
  /** Curly arrows between atoms/bonds of this step's species: "2.3" atom, "2.3H" an H on it, "2.3-2.4" bond. */
  arrows?: MechArrow[]
  /** Reaction arrow after this step (leave out on the last step). */
  then?: { above?: string; below?: string; kind?: ArrowKind }
}
export interface MechSpec {
  steps: MechStep[]
  title?: string
  /** Top-left corner; default: below everything on the canvas. */
  x?: number
  y?: number
  /** Wrap to a new row past this width (canvas units). */
  width?: number
  /** 'arrows' (default): on atoms where a curly arrow starts, heteroatoms where one ends, and anionic heteroatoms. */
  lonePairs?: 'arrows' | 'heteroatoms' | 'none'
}

const VALENCE_E: Record<string, number> = { B: 3, C: 4, Si: 4, N: 5, P: 5, O: 6, S: 6, Se: 6, F: 7, Cl: 7, Br: 7, I: 7 }
const HETERO = new Set(['N', 'P', 'O', 'S', 'Se', 'F', 'Cl', 'Br', 'I'])

/** Lone pairs an atom has from its valence electrons, bonds, H and charge. */
function naturalLonePairs(d: Doc, id: ID, adj: Adjacency): number {
  const a = d.atoms[id]
  const ve = VALENCE_E[a.element]
  if (ve === undefined) return 0
  const used = bondOrderSum(id, adj) + hCount(a, adj) + (a.radical ? 1 : 0)
  return Math.max(0, Math.min(4, Math.floor((ve - a.charge - used) / 2)))
}

/** "2.3" -> species 2, atom 3; "2.3H" -> its explicit H. Both 1-based. */
const REF = /^(\d+)\.(\d+)(H?)$/

/** Horizontal room an atom's label takes beyond its centre. */
const labelPad = (d: Doc, id: ID, adj: Adjacency) => {
  const a = d.atoms[id]
  if (a.element === 'C' && !a.charge) return 2
  return 9 + (a.element.length - 1) * 8 + (hCount(a, adj) ? 9 : 0) + (a.lonePairs ? 7 : 0)
}

function extent(d: Doc, ids: ID[]) {
  const adj = adjacency(d)
  let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity
  for (const id of ids) {
    const a = d.atoms[id]
    if (!a) continue
    const p = labelPad(d, id, adj)
    x1 = Math.min(x1, a.x - p); x2 = Math.max(x2, a.x + p)
    y1 = Math.min(y1, a.y - 10); y2 = Math.max(y2, a.y + 10)
  }
  return { x1, x2, y1, y2 }
}

export interface DrawnMechanism { species: { step: number; index: number; smiles: string; atoms: ID[] }[]; curlies: ID[]; arrows: ID[] }

/** Draw the mechanism as one undo step. On any error nothing is drawn. */
export async function drawMechanism(spec: MechSpec): Promise<DrawnMechanism> {
  if (!spec.steps?.length) throw new Error('Give at least one step')
  const before = getDoc()
  const mode = spec.lonePairs ?? 'arrows'
  const out: DrawnMechanism = { species: [], curlies: [], arrows: [] }
  try {
    await batch(async () => {
      const b0 = contentBounds(getDoc())
      const x0 = spec.x ?? (b0 ? b0.x1 : 0)
      let top = spec.y ?? (b0 ? b0.y2 + 90 : 0)
      const maxX = x0 + (spec.width ?? 1000)
      if (spec.title) {
        commit(d => { const id = newId('t'); d.texts[id] = { id, text: spec.title!, x: x0, y: top + 18, bold: true, size: 18 } })
        top += 40
      }

      // Each row is built on the centre line y = 0, then moved down under the previous row.
      let row: ID[] = []
      let cursor = x0
      const endRow = () => {
        if (!row.length) return
        commit(d => {
          const e = rowExtent(d, row)
          moveItems(d, row, 0, top + 30 - e.y1) // 30: room for curly arrows bowing upwards
          top = rowExtent(d, row).y2 + 60
        })
        row = []
        cursor = x0
      }
      /** Put an item of width w at the cursor, starting a new row first when it would stick out. */
      const place = (w: number) => { if (row.length && cursor + w > maxX) endRow(); const x = cursor; cursor += w; return x }

      for (const [si, step] of spec.steps.entries()) {
        const n = si + 1
        const atomsOf: ID[][] = []
        // Lone pairs go on the atoms where a curly arrow starts (and anionic heteroatoms).
        const startsAt = new Set((step.arrows ?? []).map(a => a.from).filter(r => REF.test(r) && !r.endsWith('H')))
        const endsAt = new Set((step.arrows ?? []).map(a => a.to).filter(r => REF.test(r) && !r.endsWith('H')))
        for (const [ki, sp] of step.species.entries()) {
          if (ki > 0) {
            const x = place(46)
            const id = newId('t')
            commit(d => { d.texts[id] = { id, text: '+', x: x + 14, y: 7, size: 20 } })
            row.push(id)
          }
          if (sp.smiles.trim() === '?') {
            const x = place(40)
            const id = newId('t')
            commit(d => { d.texts[id] = { id, text: '?', x: x + 8, y: 10, size: 28, bold: true } })
            row.push(id)
            atomsOf.push([])
            continue
          }
          const res = await addMolecule(sp.smiles, { x: 0, y: 0 }, 'smiles').catch(() => { throw new Error(`Step ${n}, species ${ki + 1}: "${sp.smiles}" is not valid SMILES`) })
          const ids = res.atomIds
          commit(d => {
            const adj = adjacency(d)
            ids.forEach((id, i) => {
              const a = d.atoms[id]
              const want = mode === 'heteroatoms' ? HETERO.has(a.element)
                : mode === 'arrows' ? startsAt.has(`${ki + 1}.${i + 1}`) || (HETERO.has(a.element) && (a.charge < 0 || endsAt.has(`${ki + 1}.${i + 1}`)))
                : false
              if (want && !a.lonePairs) a.lonePairs = naturalLonePairs(d, id, adj)
            })
          })
          let e = extent(getDoc(), ids)
          const x = place(e.x2 - e.x1 + 8)
          e = extent(getDoc(), ids) // place() may have moved the row, not this molecule
          commit(d => moveItems(d, ids, x + 4 - e.x1, -(e.y1 + e.y2) / 2))
          row.push(...ids, ...res.bondIds)
          atomsOf.push(ids)
          out.species.push({ step: n, index: ki + 1, smiles: sp.smiles, atoms: ids })
        }

        // Curly arrows: resolve "s.i", "s.iH" and "s.i-s.j" to ids (adding explicit H atoms where asked).
        for (const arrow of step.arrows ?? []) {
          const id = commit(d => {
            const atom = (ref: string): ID => {
              const m = REF.exec(ref.trim())
              if (!m) throw new Error(`Step ${n}: "${ref}" is not an atom reference like "1.3" or "1.3H"`)
              const ids = atomsOf[+m[1] - 1]
              if (!ids) throw new Error(`Step ${n}: there is no species ${m[1]}`)
              const a = ids[+m[2] - 1]
              if (!a) throw new Error(`Step ${n}: species ${m[1]} has only ${ids.length} heavy atoms, not ${m[2]}`)
              if (!m[3]) return a
              const adj = adjacency(d)
              const h = (adj.get(a) ?? []).find(nb => d.atoms[nb.other].element === 'H')
              if (h) return h.other
              if (!hCount(d.atoms[a], adj)) throw new Error(`Step ${n}: atom ${m[1]}.${m[2]} (${d.atoms[a].element}) has no H`)
              const hid = growBond(d, a, 1, 'none', 'H')
              row.push(hid, ...Object.values(d.bonds).filter(b => b.a1 === hid || b.a2 === hid).map(b => b.id))
              return hid
            }
            const end = (ref: string): ID => {
              const parts = ref.split('-')
              if (parts.length === 1) return atom(ref)
              if (parts.length !== 2) throw new Error(`Step ${n}: "${ref}" is not a bond like "1.2-1.3"`)
              const [p, q] = parts.map(atom)
              const bond = Object.values(d.bonds).find(b => (b.a1 === p && b.a2 === q) || (b.a1 === q && b.a2 === p))
              if (!bond) throw new Error(`Step ${n}: atoms ${parts[0]} and ${parts[1]} are not bonded`)
              return bond.id
            }
            const from = end(arrow.from), to = end(arrow.to)
            if (from === to) throw new Error(`Step ${n}: arrow from and to are the same`)
            const cid = newId('c')
            d.curlies[cid] = { id: cid, from, to, half: !!arrow.half, bend: autoBend(d, from, to, adjacency(d)) }
            return cid
          })
          out.curlies.push(id)
        }

        if (step.then && si < spec.steps.length - 1) {
          const len = Math.max(90, Math.max(step.then.above?.length ?? 0, step.then.below?.length ?? 0) * 7.5 + 24)
          const x = place(len + 50)
          const id = newId('r')
          commit(d => { d.arrows[id] = { id, kind: step.then!.kind ?? 'forward', x1: x + 22, y1: 0, x2: x + 22 + len, y2: 0, above: step.then!.above ?? '', below: step.then!.below ?? '' } })
          row.push(id)
          out.arrows.push(id)
        } else if (si < spec.steps.length - 1) {
          const x = place(140)
          const id = newId('r')
          commit(d => { d.arrows[id] = { id, kind: 'forward', x1: x + 22, y1: 0, x2: x + 112, y2: 0, above: '', below: '' } })
          row.push(id)
          out.arrows.push(id)
        }
      }
      endRow()
    })
  } catch (err) {
    replaceDoc(before)
    throw err
  }
  return out
}

/** Vertical extent of a row's atoms, texts and arrows (with room for labels and reagent text). */
function rowExtent(d: Doc, ids: ID[]) {
  let y1 = Infinity, y2 = -Infinity
  for (const id of ids) {
    const a = d.atoms[id], t = d.texts[id], r = d.arrows[id]
    if (a) { y1 = Math.min(y1, a.y - 12); y2 = Math.max(y2, a.y + 12) }
    if (t) { y1 = Math.min(y1, t.y - (t.size ?? 14)); y2 = Math.max(y2, t.y + 4) }
    if (r) { y1 = Math.min(y1, r.y1 - (r.above ? 26 : 6)); y2 = Math.max(y2, r.y1 + (r.below ? 26 : 6)) }
  }
  return { y1, y2 }
}
