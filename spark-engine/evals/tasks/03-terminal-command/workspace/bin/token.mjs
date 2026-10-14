import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const seed = readFileSync(new URL('./seed.txt', import.meta.url), 'utf8')
process.stdout.write(createHash('sha256').update(seed).digest('hex').slice(0, 16))
