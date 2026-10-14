import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = (...args) =>
  spawnSync(process.execPath, ['bin/pack.mjs', ...args], { encoding: 'utf8' })

test('--dest picks the output directory', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pack-')), 'out')
  const result = run('--dest', dir, 'a', 'b')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(dir, 'bundle.txt'), 'utf8'), 'a\nb\n')
})

test('--outdir is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-'))
  const result = run('--outdir', dir, 'a')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown option --outdir/u)
})

test('--help documents --dest', () => {
  const result = run('--help')
  assert.equal(result.status, 0)
  assert.match(result.stdout, /--dest/u)
  assert.doesNotMatch(result.stdout, /--outdir/u)
})
