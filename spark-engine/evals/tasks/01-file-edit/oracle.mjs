import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/sum.js'
const source = readFileSync(path, 'utf8')
const next = source.replace('return a - b', 'return a + b')
if (next === source) {
  process.stderr.write('oracle did not find the bug\n')
  process.exit(1)
}
writeFileSync(path, next)
