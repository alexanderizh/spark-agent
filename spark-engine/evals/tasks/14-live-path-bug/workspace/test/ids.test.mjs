import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeId } from '../src/index.js'

test('keeps digits and drops other punctuation', () => {
  assert.equal(normalizeId(' Ab-12 '), 'ab12')
  assert.equal(normalizeId('A_B'), 'ab')
  assert.equal(normalizeId(''), '')
})
