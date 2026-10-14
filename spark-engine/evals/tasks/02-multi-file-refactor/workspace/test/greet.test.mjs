import assert from 'node:assert/strict'
import test from 'node:test'
import { greet } from '../src/greet.js'

test('greets by first and last name', () => {
  assert.equal(greet({ first: 'Ada', last: 'Lovelace' }), 'Hello, Ada Lovelace')
})
