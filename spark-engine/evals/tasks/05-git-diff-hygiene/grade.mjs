import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { finish, runNode } from '../../lib/grade-report.mjs'

delete process.env.GIT_DIR
delete process.env.GIT_WORK_TREE
delete process.env.GIT_INDEX_FILE

function git(args) {
  return spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' })
}

const tests = runNode(['--test', 'test/clamp.test.mjs'])
const notes = readFileSync('notes.txt', 'utf8')
const head = git(['rev-parse', 'HEAD'])
const staged = git(['diff', '--cached', '--name-only'])
const notesDiff = git(['diff', '--numstat', '--', 'notes.txt'])
const expectedHead = process.env.SPARK_EVAL_GIT_HEAD ?? ''

finish([
  { name: 'unit-tests', passed: tests.passed, detail: tests.detail },
  {
    name: 'scratch-preserved',
    passed: notes === 'project notes\nunrelated scratch\n' && notesDiff.stdout.trim() !== '',
    detail: `notes=${JSON.stringify(notes)} diff=${JSON.stringify(notesDiff.stdout.trim())}`,
  },
  {
    name: 'history-unchanged',
    passed: head.status === 0 && head.stdout.trim() === expectedHead && expectedHead !== '',
    detail: `head=${head.stdout.trim()} expected=${expectedHead}`,
  },
  {
    name: 'nothing-staged',
    passed: staged.status === 0 && staged.stdout.trim() === '',
    detail: staged.stdout.trim() || 'index clean',
  },
])
