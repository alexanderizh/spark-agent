import assert from 'node:assert/strict'
import test from 'node:test'
import { label } from '../src/label.js'

test('formats id and uppercased role', () => {
  assert.equal(label({ id: 'u1', role: 'admin' }), 'ID:u1|ROLE:ADMIN')
})

test('uses guest when role is missing or blank', () => {
  assert.equal(label({ id: 'u2' }), 'ID:u2|ROLE:GUEST')
  assert.equal(label({ id: 'u3', role: '  ' }), 'ID:u3|ROLE:GUEST')
})
