#!/usr/bin/env node
import { pack } from '../src/pack.js'

const HELP = `usage: pack [--outdir <dir>] <input...>

  --outdir <dir>  directory for bundle.txt (default: dist)
  --help          show this help`

const args = process.argv.slice(2)
let outdir = 'dist'
const inputs = []
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--help') {
    console.log(HELP)
    process.exit(0)
  } else if (arg === '--outdir') {
    outdir = args[++i]
  } else if (arg.startsWith('--')) {
    console.error(`pack: unknown option ${arg}`)
    process.exit(2)
  } else {
    inputs.push(arg)
  }
}
if (inputs.length === 0) {
  console.error('pack: no inputs')
  process.exit(2)
}
console.log(pack(inputs, outdir))
