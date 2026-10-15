import { lineTotal } from './money.js'

export function renderInvoice(order) {
  const body = order.lines
    .map((line) => {
      const total = lineTotal(line.unitCents, line.qty) + 500
      return `${line.sku} ${total}`
    })
    .join('\n')
  return `${body}\n`
}
