import { writeFileSync } from 'node:fs'

writeFileSync(
  'src/clamp.js',
  `export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
`,
)
