/* Higher-level actions shared by the UI and the Claude bridge. */
import { renderToStaticMarkup } from 'react-dom/server'
import type { Doc, ID } from './model/types'
import { commit, getDoc } from './model/store'
import { addAtom, contentBounds, copyItems, insertMolecule, nextFreeSpot } from './model/ops'
import { add, angleOf, norm, rotate, sub, type P } from './model/geometry'
import { abbrevOf, findAbbrev } from './chem/abbrev'
import { STYLES, type DrawStyle } from './render/styles'
import { adjacency, components, formulaOf } from './chem/chem'
import { parseMolfile, writeMolfile } from './chem/molfile'
import { cleanMolblock, molblockToSmiles, nameToMolblock, smilesToMolblock } from './chem/rdkit'
import { Scene, PRINT } from './render/Scene'
import { newId } from './model/store'

export interface AddedMolecule { atomIds: ID[]; bondIds: ID[]; source: 'smiles' | 'name' | 'molfile' }

/** Add a molecule from SMILES, a molfile, or a compound name (looked up on PubChem). */
export async function addMolecule(input: string, at?: P, kind?: 'smiles' | 'name' | 'molfile'): Promise<AddedMolecule> {
  const text = input.trim()
  if (!text) throw new Error('Type a name or SMILES first')
  let molblock: string | null = null
  let source: AddedMolecule['source'] = 'smiles'
  if (kind === 'molfile' || (!kind && /V2000/.test(text))) {
    molblock = text; source = 'molfile'
  } else {
    if (kind !== 'name' && !/\s/.test(text)) molblock = await smilesToMolblock(text)
    if (!molblock && kind !== 'smiles') { molblock = await nameToMolblock(text); source = 'name' }
  }
  if (!molblock) throw new Error(`Couldn't read "${text}" as SMILES or find it by name`)
  const parsed = parseMolfile(molblock)
  return commit(d => {
    const spot = at ?? nextFreeSpot(d, molWidth(parsed.atoms))
    return { ...insertMolecule(d, parsed, spot), source }
  })
}

const molWidth = (atoms: { x: number }[]) => {
  if (!atoms.length) return 0
  const xs = atoms.map(a => a.x)
  return Math.max(...xs) - Math.min(...xs)
}

/** Recompute 2D layout for the molecules containing the given atoms (all molecules if none given). */
export async function cleanStructures(atomIds?: ID[]): Promise<number> {
  const doc = getDoc()
  const comps = components(doc).filter(c => c.length > 1 && (!atomIds?.length || c.some(id => atomIds.includes(id))))
  const updates: { ids: ID[]; coords: P[] }[] = []
  for (const comp of comps) {
    const out = await cleanMolblock(writeMolfile(doc, comp))
    if (!out) continue
    const parsed = parseMolfileKeepAll(out)
    if (parsed.length !== comp.length) continue
    let ox = 0, oy = 0, nx = 0, ny = 0
    comp.forEach((id, i) => { ox += doc.atoms[id].x; oy += doc.atoms[id].y; nx += parsed[i].x; ny += parsed[i].y })
    const k = comp.length
    updates.push({ ids: comp, coords: parsed.map(p => ({ x: p.x - nx / k + ox / k, y: p.y - ny / k + oy / k })) })
  }
  if (updates.length) {
    commit(d => {
      for (const u of updates) u.ids.forEach((id, i) => { if (d.atoms[id]) { d.atoms[id].x = u.coords[i].x; d.atoms[id].y = u.coords[i].y } })
    })
  }
  return updates.length
}

/** Atom coordinates from a molfile without stripping hydrogens (atom order must be kept). */
function parseMolfileKeepAll(text: string): P[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const c = lines.findIndex(l => /V2000/.test(l))
  const n = parseInt(lines[c].slice(0, 3))
  const scale = 40 / 1.5
  const out: P[] = []
  for (let i = 0; i < n; i++) {
    const l = lines[c + 1 + i]
    out.push({ x: parseFloat(l.slice(0, 10)) * scale, y: -parseFloat(l.slice(10, 20)) * scale })
  }
  return out
}

export async function smilesOf(doc: Doc, atomIds: ID[]): Promise<string | null> {
  try {
    const ex = await expandAbbreviations(doc, atomIds)
    return await molblockToSmiles(writeMolfile(ex.doc, ex.atomIds))
  } catch { return null }
}

// ------------------------------------------------------------------ group abbreviations

const fragCache = new Map<string, ReturnType<typeof parseMolfile>>()

/** 2D structure of a group, from its SMILES (atom 0 is the attachment atom). Cached. */
async function fragment(label: string) {
  const ab = findAbbrev(label)
  if (!ab) return null
  if (!fragCache.has(ab.label)) {
    const mb = await smilesToMolblock(ab.smiles)
    if (!mb) return null
    fragCache.set(ab.label, parseMolfile(mb))
  }
  return fragCache.get(ab.label)!
}

/** Load the structures of every group label used in these atoms, so expandInDoc can run synchronously. */
export async function prepareGroups(doc: Doc, atomIds: ID[] = Object.keys(doc.atoms)): Promise<void> {
  const labels = new Set(atomIds.map(id => doc.atoms[id]?.element).filter(el => el && abbrevOf(el)))
  await Promise.all([...labels].map(l => fragment(l!)))
}

/**
 * Replace group atoms (Ph, Boc…) in `d` with their full structures, pointing away from the
 * rest of the molecule. Needs prepareGroups first. Returns the ids of every atom involved.
 */
export function expandInDoc(d: Doc, atomIds: ID[]): ID[] {
  const out = [...atomIds]
  for (const id of atomIds) {
    const a = d.atoms[id]
    const ab = a && abbrevOf(a.element)
    const frag = ab && fragCache.get(ab.label)
    if (!a || !ab || !frag || !frag.atoms.length) continue
    // direction: from the neighbour towards the group
    const bond = Object.values(d.bonds).find(b => b.a1 === id || b.a2 === id)
    const nb = bond ? d.atoms[bond.a1 === id ? bond.a2 : bond.a1] : null
    const want = nb ? angleOf(sub(a, nb)) : 0
    const f0 = frag.atoms[0]
    let cx = 0, cy = 0
    for (const fa of frag.atoms.slice(1)) { cx += fa.x - f0.x; cy += fa.y - f0.y }
    const have = frag.atoms.length > 1 ? angleOf(norm({ x: cx, y: cy })) : want
    const turn = want - have
    const ids = frag.atoms.map((fa, i) => {
      if (i === 0) { a.element = fa.element; a.charge = fa.charge; return id }
      const p = add(a, rotate(sub(fa, f0), turn))
      const nid = addAtom(d, p.x, p.y, fa.element, fa.charge)
      out.push(nid)
      return nid
    })
    for (const fb of frag.bonds) {
      const bid = newId('b')
      d.bonds[bid] = { id: bid, a1: ids[fb.i], a2: ids[fb.j], order: fb.order, stereo: 'none' }
    }
  }
  return out
}

/** A copy of `doc` with groups among `atomIds` expanded to real atoms (for SMILES and MOL export). */
export async function expandAbbreviations(doc: Doc, atomIds: ID[] = Object.keys(doc.atoms)): Promise<{ doc: Doc; atomIds: ID[] }> {
  if (!atomIds.some(id => doc.atoms[id] && abbrevOf(doc.atoms[id].element))) return { doc, atomIds }
  await prepareGroups(doc, atomIds)
  const copy = structuredClone(doc)
  return { doc: copy, atomIds: expandInDoc(copy, atomIds) }
}

export interface MoleculeSummary { atomIds: ID[]; formula: string; mass: number; smiles: string | null; center: P }

export async function moleculeSummaries(doc: Doc): Promise<MoleculeSummary[]> {
  const adj = adjacency(doc)
  const out: MoleculeSummary[] = []
  for (const comp of components(doc, adj)) {
    const f = formulaOf(doc, comp, adj)
    let cx = 0, cy = 0
    for (const id of comp) { cx += doc.atoms[id].x; cy += doc.atoms[id].y }
    out.push({
      atomIds: comp,
      formula: f.plain,
      mass: Math.round(f.mass * 100) / 100,
      smiles: await smilesOf(doc, comp),
      center: { x: Math.round(cx / comp.length), y: Math.round(cy / comp.length) },
    })
  }
  return out
}

export interface ExportOptions {
  style?: DrawStyle
  /** Leave the background see-through (PNG/SVG). */
  transparent?: boolean
  /** Export only these items. */
  ids?: ID[]
  margin?: number
}

/** The part of the document an export covers. */
export function exportDoc(doc: Doc, ids?: ID[]): Doc {
  return ids?.length ? copyItems(doc, ids) : doc
}

export function exportSvg(doc: Doc, opts: ExportOptions = {}): string {
  const d = exportDoc(doc, opts.ids)
  const st = opts.style ?? STYLES[0]
  const margin = opts.margin ?? Math.max(24, st.font * 1.2)
  const b = contentBounds(d) ?? { x1: 0, y1: 0, x2: 100, y2: 60 }
  const x = b.x1 - margin, y = b.y1 - margin
  const w = b.x2 - b.x1 + margin * 2, h = b.y2 - b.y1 + margin * 2
  const body = renderToStaticMarkup(<Scene doc={d} palette={PRINT} style={st} />)
  const bg = opts.transparent ? '' : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">${bg}${body}</svg>`
}

export async function exportPngBlob(doc: Doc, scale = 3, opts: ExportOptions = {}): Promise<Blob> {
  const url = await exportPngDataUrl(doc, scale, opts)
  return (await fetch(url)).blob()
}

/** Put a PNG of the drawing (or the selection) on the clipboard, for Word, PowerPoint or Docs. */
export async function copyImage(doc: Doc, opts: ExportOptions = {}): Promise<void> {
  const blob = exportPngBlob(doc, 3, opts)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

/** MOL file text with group labels expanded to real atoms. */
export async function exportMolfile(doc: Doc, ids?: ID[]): Promise<string> {
  const d = exportDoc(doc, ids)
  const ex = await expandAbbreviations(d)
  return writeMolfile(ex.doc, ex.atomIds)
}

export async function exportPngDataUrl(doc: Doc, scale = 2, opts: ExportOptions = {}): Promise<string> {
  const svg = exportSvg(doc, opts)
  const m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg)!
  const w = Math.ceil(parseFloat(m[1]) * scale), h = Math.ceil(parseFloat(m[2]) * scale)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Render failed')); img.src = url })
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function download(filename: string, data: string | Blob, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
