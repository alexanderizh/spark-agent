import assert from 'node:assert/strict'
import test from 'node:test'

import { inRange } from '../src/bound.js'

test('uses an inclusive range', () => {
  assert.equal(inRange(1, 1, 3), true)
  assert.equal(inRange(3, 1, 3), true)
  assert.equal(inRange(2, 1, 3), true)
  assert.equal(inRange(0, 1, 3), false)
  assert.equal(inRange(4, 1, 3), false)
})
