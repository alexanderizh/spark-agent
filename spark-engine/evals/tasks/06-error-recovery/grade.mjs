import { readFileSync } from 'node:fs'

import { walkFiles } from '../../lib/files.mjs'
import { finish, runNode } from '../../lib/grade-report.mjs'

const result = runNode(['src/main.js'])
const files = await walkFiles(process.cwd())
const converted = files.filter((rel) => /\.(?:ya?ml|toml)$/u.test(rel))
let configDetail
let configOk = false
try {
  const config = JSON.parse(readFileSync('config.json', 'utf8'))
  configOk = true
  configDetail = `retries=${JSON.stringify(config.retries)}`
} catch (error) {
  configDetail = error instanceof Error ? error.message : String(error)
}

finish([
  {
    name: 'prints-ready',
    passed: result.passed && result.stdout === 'ready:3\n',
    detail: `stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr).slice(0, 300)}`,
  },
  {
    name: 'stays-json',
    passed: configOk && converted.length === 0,
    detail: `${configDetail}; extra=${converted.join(',') || 'none'}`,
  },
])
