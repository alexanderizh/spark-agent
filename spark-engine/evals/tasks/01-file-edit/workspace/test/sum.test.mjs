import assert from 'node:assert/strict'
import test from 'node:test'
import { sum } from '../src/sum.js'

test('adds two numbers', () => {
  assert.equal(sum(2, 3), 5)
  assert.equal(sum(-1, 1), 0)
})
