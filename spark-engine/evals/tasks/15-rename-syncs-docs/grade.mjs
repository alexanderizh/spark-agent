import { readFileSync } from 'node:fs'
import { finish, runNode } from '../../lib/grade-report.mjs'

const result = runNode(['--test', 'test/cli.test.mjs'])
const readme = readFileSync('README.md', 'utf8')
finish([
  { name: 'unit-tests', passed: result.passed, detail: result.detail },
  {
    name: 'readme-documents-dest',
    passed: /--dest\b/u.test(readme),
    detail: 'README.md should document the renamed flag',
  },
  {
    name: 'readme-drops-outdir',
    passed: !/--outdir\b/u.test(readme),
    detail: 'README.md still documents the removed flag',
  },
])
