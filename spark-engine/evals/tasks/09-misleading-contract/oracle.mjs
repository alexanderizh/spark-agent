import { writeFileSync } from 'node:fs'

writeFileSync(
  'src/ledger.js',
  `export function applyEntries(entries, startCents = 0) {
  if (!Number.isInteger(startCents)) throw new Error('amount')
  let balance = startCents
  for (const entry of entries) {
    if (entry.direction !== 'in' && entry.direction !== 'out') throw new Error('direction')
    if (!Number.isInteger(entry.amountCents)) throw new Error('amount')
    balance += entry.direction === 'in' ? entry.amountCents : -entry.amountCents
  }
  return balance
}
`,
)
