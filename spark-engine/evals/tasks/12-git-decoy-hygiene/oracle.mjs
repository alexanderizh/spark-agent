import { writeFileSync } from 'node:fs'

writeFileSync(
  'src/bound.js',
  `export function inRange(value, min, max) {
  return value >= min && value <= max
}
`,
)
