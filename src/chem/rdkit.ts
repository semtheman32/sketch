/* RDKit (WASM) is copied to /public/rdkit by scripts/copy-rdkit.mjs and loaded on first use. */

interface RDMol {
  get_molblock(): string
  get_smiles(): string
  set_new_coords(useCoordGen?: boolean): boolean
  is_valid?(): boolean
  delete(): void
}
interface RDKitModule {
  get_mol(input: string): RDMol | null
  prefer_coordgen?(p: boolean): void
  version(): string
}

declare global {
  interface Window { initRDKitModule?: (opts: { locateFile: () => string }) => Promise<RDKitModule> }
}

let loading: Promise<RDKitModule> | null = null

export function loadRDKit(): Promise<RDKitModule> {
  if (loading) return loading
  loading = new Promise<RDKitModule>((resolve, reject) => {
    const base = import.meta.env.BASE_URL + 'rdkit/'
    const start = () => {
      window.initRDKitModule!({ locateFile: () => base + 'RDKit_minimal.wasm' })
        .then(m => { m.prefer_coordgen?.(true); resolve(m) })
        .catch(reject)
    }
    if (window.initRDKitModule) return start()
    const s = document.createElement('script')
    s.src = base + 'RDKit_minimal.js'
    s.onload = start
    s.onerror = () => reject(new Error('Could not load RDKit'))
    document.head.appendChild(s)
  })
  loading.catch(() => { loading = null })
  return loading
}

function withMol<T>(rd: RDKitModule, input: string, fn: (m: RDMol) => T): T | null {
  let mol: RDMol | null = null
  try {
    mol = rd.get_mol(input)
    if (!mol || (mol.is_valid && !mol.is_valid())) return null
    return fn(mol)
  } catch {
    return null
  } finally {
    mol?.delete()
  }
}

/** SMILES → molfile with fresh 2D coordinates, or null if the SMILES is invalid. */
export async function smilesToMolblock(smiles: string): Promise<string | null> {
  const rd = await loadRDKit()
  return withMol(rd, smiles, m => { m.set_new_coords(true); return m.get_molblock() })
}

/** Recompute 2D coordinates for a molfile, keeping atom order. */
export async function cleanMolblock(molblock: string): Promise<string | null> {
  const rd = await loadRDKit()
  return withMol(rd, molblock, m => { m.set_new_coords(true); return m.get_molblock() })
}

export async function molblockToSmiles(molblock: string): Promise<string | null> {
  const rd = await loadRDKit()
  return withMol(rd, molblock, m => m.get_smiles())
}

/** Look up a compound name on PubChem and return a 2D molfile. */
export async function nameToMolblock(name: string): Promise<string | null> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name.trim())}/SDF?record_type=2d`
  const res = await fetch(url)
  if (!res.ok) return null
  const sdf = await res.text()
  return sdf.split('$$$$')[0]
}
