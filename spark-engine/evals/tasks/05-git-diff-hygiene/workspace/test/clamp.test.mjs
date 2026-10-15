import assert from 'node:assert/strict'
import test from 'node:test'
import { clamp } from '../src/clamp.js'

test('clamps into the inclusive range', () => {
  assert.equal(clamp(10, 0, 5), 5)
  assert.equal(clamp(-1, 0, 5), 0)
  assert.equal(clamp(3, 0, 5), 3)
})
