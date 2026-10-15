import { readFileSync, writeFileSync } from 'node:fs'

for (const file of ['bin/pack.mjs', 'README.md']) {
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('--outdir', '--dest'))
}

const note = '`--outdir` was renamed to `--dest`.'
const readme = readFileSync('README.md', 'utf8')
if (!readme.includes(note)) {
  writeFileSync('README.md', `${readme.replace(/\s*$/u, '')}\n\n${note}\n`)
}
