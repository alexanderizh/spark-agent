import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePort } from '../src/parse-port.js'

test('accepts numeric and numeric-string ports', () => {
  assert.equal(parsePort(80), 80)
  assert.equal(parsePort('443'), 443)
  assert.equal(parsePort(' 8080 '), 8080)
})

test('rejects out of range and non-integers', () => {
  for (const value of [0, 65536, -1, 1.5, 'foo', '80a', '', '  ', true]) {
    assert.throws(() => parsePort(value), /port/u)
  }
})
