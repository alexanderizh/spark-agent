import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

import { finish, runNode } from '../../lib/grade-report.mjs'
import { walkFiles } from '../../lib/files.mjs'

const tests = runNode(['--test', 'test/greet.test.mjs'])
const sources = (await walkFiles(process.cwd())).filter((rel) => rel.startsWith('src/'))
const combined = sources.map((rel) => readFileSync(rel, 'utf8')).join('\n')
const oldNameLeft = /\bformatName\b/u.test(combined)
const renamed = combined.includes('formatDisplayName')
const exported = await import(pathToFileURL(join(process.cwd(), 'src/index.js')).href)

finish([
  { name: 'unit-tests', passed: tests.passed, detail: tests.detail },
  {
    name: 'rename',
    passed:
      renamed &&
      !oldNameLeft &&
      typeof exported.formatDisplayName === 'function' &&
      exported.formatName === undefined,
    detail: `formatDisplayName export=${typeof exported.formatDisplayName} old identifier left=${oldNameLeft}`,
  },
])
