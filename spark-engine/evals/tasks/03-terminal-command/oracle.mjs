import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, ['bin/token.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
})
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'token command failed\n')
  process.exit(result.status || 1)
}
mkdirSync('out', { recursive: true })
writeFileSync('out/token.txt', result.stdout)
