import { finish, runNode } from '../../lib/grade-report.mjs'

const result = runNode(['--test', 'test/rows.test.mjs'])
finish([{ name: 'unit-tests', passed: result.passed, detail: result.detail }])
