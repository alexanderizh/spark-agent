import { finish, runNode } from '../../lib/grade-report.mjs'

const result = runNode(['--test', 'test/sum.test.mjs'])
finish([
  {
    name: 'unit-tests',
    passed: result.passed,
    detail: result.detail,
  },
])
