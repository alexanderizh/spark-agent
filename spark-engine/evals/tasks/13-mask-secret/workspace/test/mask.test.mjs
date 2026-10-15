import assert from 'node:assert/strict'
import test from 'node:test'

import { maskSecret } from '../src/mask.js'

test('masks short and empty strings', () => {
  assert.equal(maskSecret(''), '')
  assert.equal(maskSecret('a'), '*')
  assert.equal(maskSecret('ab'), '**')
  assert.equal(maskSecret('abc'), '***')
})

test('keeps the ends of longer strings by code point', () => {
  assert.equal(maskSecret('abcd'), 'a**d')
  assert.equal(maskSecret('café'), 'c**é')
  assert.equal(maskSecret('a😀b'), '***')
  assert.equal(maskSecret('ab😀cd'), 'a***d')
})

test('is idempotent', () => {
  for (const value of ['', 'a', 'ab😀cd', 'café', '****']) {
    assert.equal(maskSecret(maskSecret(value)), maskSecret(value))
  }
})

test('rejects non-strings', () => {
  assert.throws(() => maskSecret(null), TypeError)
  assert.throws(() => maskSecret(12), TypeError)
})
