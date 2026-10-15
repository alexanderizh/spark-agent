import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Writes `bundle.txt` (the joined inputs) into `outdir`, creating it if needed.
export function pack(inputs, outdir) {
  mkdirSync(outdir, { recursive: true })
  const file = join(outdir, 'bundle.txt')
  writeFileSync(file, `${inputs.join('\n')}\n`)
  return file
}
