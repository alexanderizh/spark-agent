import { writeFileSync } from 'node:fs'

writeFileSync(
  'src/money.js',
  `export function lineTotal(unitCents, qty, discountBps = 0) {
  return Math.round((unitCents * qty * (10000 - discountBps)) / 10000)
}
`,
)
writeFileSync(
  'src/invoice.js',
  `import { lineTotal } from './money.js'

export function renderInvoice(order) {
  const body = order.lines
    .map((line) => \`\${line.sku} \${lineTotal(line.unitCents, line.qty, line.discountBps)}\`)
    .join('\\n')
  return \`\${body}\\n\`
}
`,
)
