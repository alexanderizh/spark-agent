import assert from 'node:assert/strict'
import test from 'node:test'

import { applyEntries } from '../src/ledger.js'

test('sums integer cents and allows a negative balance', () => {
  assert.equal(applyEntries([], 100), 100)
  assert.equal(
    applyEntries([
      { direction: 'in', amountCents: 250 },
      { direction: 'out', amountCents: 100 },
    ]),
    150,
  )
  assert.equal(applyEntries([{ direction: 'out', amountCents: 20 }], 0), -20)
})

test('rejects unknown directions and non-integers', () => {
  assert.throws(() => applyEntries([{ direction: 'credit', amountCents: 10 }]), /direction/u)
  assert.throws(() => applyEntries([{ direction: 'in', amountCents: 1.5 }]), /amount/u)
  assert.throws(() => applyEntries([], 1.5), /amount/u)
})
