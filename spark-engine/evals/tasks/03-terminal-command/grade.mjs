import { readFileSync } from 'node:fs'

import { finish, runNode } from '../../lib/grade-report.mjs'

const expected = runNode(['bin/token.mjs'])
let actual = ''
let readError = ''
try {
  actual = readFileSync('out/token.txt', 'utf8')
} catch (error) {
  readError = error instanceof Error ? error.message : String(error)
}
finish([
  {
    name: 'token-file',
    passed: expected.passed && readError === '' && actual === expected.stdout,
    detail:
      readError || `expected ${JSON.stringify(expected.stdout)} got ${JSON.stringify(actual)}`,
  },
])
