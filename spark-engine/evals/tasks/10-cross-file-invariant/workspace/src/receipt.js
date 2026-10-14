import { lineTotal } from './money.js'

export function renderReceipt(order) {
  const body = order.lines
    .map((line) => `${line.sku}:${lineTotal(line.unitCents, line.qty, line.discountBps)}`)
    .join('|')
  return `${body}\n`
}
