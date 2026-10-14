import { writeFileSync } from 'node:fs'

writeFileSync(
  'src/core/ids.js',
  `export function normalizeId(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '')
}
`,
)
