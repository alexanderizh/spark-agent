import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { renderInvoice } from '../src/invoice.js'
import { lineTotal } from '../src/money.js'
import { renderReceipt } from '../src/receipt.js'

const order = {
  lines: [
    { sku: 'pen', unitCents: 250, qty: 2, discountBps: 1000 },
    { sku: 'pad', unitCents: 100, qty: 1, discountBps: 0 },
  ],
}

test('lineTotal applies discount basis points and rounds half up', () => {
  assert.equal(lineTotal(250, 2, 1000), 450)
  assert.equal(lineTotal(10, 1, 5000), 5)
  assert.equal(lineTotal(1, 1, 3333), 1)
})

test('invoice and receipt match the frozen snapshots', () => {
  assert.equal(renderInvoice(order), readFileSync('golden/invoice.txt', 'utf8'))
  assert.equal(renderReceipt(order), readFileSync('golden/receipt.txt', 'utf8'))
})
