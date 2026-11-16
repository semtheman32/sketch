// Copies the RDKit WASM build into public/ so Vite serves it as a static file.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', '@rdkit', 'rdkit', 'dist')
const dest = join(root, 'public', 'rdkit')
mkdirSync(dest, { recursive: true })
for (const f of ['RDKit_minimal.js', 'RDKit_minimal.wasm']) cpSync(join(src, f), join(dest, f))
console.log('RDKit copied to public/rdkit')
