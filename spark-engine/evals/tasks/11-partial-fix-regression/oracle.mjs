import { writeFileSync } from 'node:fs'

writeFileSync(
  'src/rows.js',
  `export function cleanRows(rows) {
  return rows.filter((row) => row.name !== '' && row.name !== null && row.name !== undefined)
}

export function formatCell(value) {
  if (value === null || value === undefined) return '\\u2014'
  return String(value)
}
`,
)
