import { readFileSync, writeFileSync } from 'node:fs'

for (const path of ['src/format-name.js', 'src/greet.js', 'src/index.js']) {
  const source = readFileSync(path, 'utf8')
  if (!source.includes('formatName')) {
    process.stderr.write(`oracle missing formatName in ${path}\n`)
    process.exit(1)
  }
  writeFileSync(path, source.replaceAll('formatName', 'formatDisplayName'))
}
