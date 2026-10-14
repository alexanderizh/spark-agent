import { readFileSync, writeFileSync } from 'node:fs'

for (const file of ['bin/pack.mjs', 'README.md']) {
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('--outdir', '--dest'))
}
