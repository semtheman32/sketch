/* Higher-level actions shared by the UI and the Claude bridge. */
import { renderToStaticMarkup } from 'react-dom/server'
import type { Doc, ID } from './model/types'
import { commit, getDoc } from './model/store'
import { contentBounds, insertMolecule, nextFreeSpot } from './model/ops'
import type { P } from './model/geometry'
import { adjacency, components, formulaOf } from './chem/chem'
import { parseMolfile, writeMolfile } from './chem/molfile'
import { cleanMolblock, molblockToSmiles, nameToMolblock, smilesToMolblock } from './chem/rdkit'
import { Scene, PRINT } from './render/Scene'

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
  try { return await molblockToSmiles(writeMolfile(doc, atomIds)) } catch { return null }
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

export function exportSvg(doc: Doc, margin = 24): string {
  const b = contentBounds(doc) ?? { x1: 0, y1: 0, x2: 100, y2: 60 }
  const x = b.x1 - margin, y = b.y1 - margin
  const w = b.x2 - b.x1 + margin * 2, h = b.y2 - b.y1 + margin * 2
  const body = renderToStaticMarkup(<Scene doc={doc} palette={PRINT} />)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`
}

export async function exportPngDataUrl(doc: Doc, scale = 2): Promise<string> {
  const svg = exportSvg(doc)
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
