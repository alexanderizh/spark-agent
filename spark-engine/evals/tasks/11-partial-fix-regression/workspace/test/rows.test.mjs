import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanRows, formatCell } from '../src/rows.js'

test('cleanRows drops empty and missing names', () => {
  const rows = [{ name: '' }, { name: 'a' }, { name: null }, { name: undefined }]
  assert.deepEqual(cleanRows(rows), [{ name: 'a' }])
})

test('formatCell keeps an empty string and only dashes nullish values', () => {
  assert.equal(formatCell(''), '')
  assert.equal(formatCell(null), '\u2014')
  assert.equal(formatCell(undefined), '\u2014')
  assert.equal(formatCell(0), '0')
  assert.equal(formatCell(false), 'false')
})
