import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('src', { recursive: true })
writeFileSync(
  'src/mask.js',
  `export function maskSecret(value) {
  if (typeof value !== 'string') throw new TypeError('string')
  const chars = Array.from(value)
  if (chars.length < 4) return '*'.repeat(chars.length)
  return \`\${chars[0]}\${'*'.repeat(chars.length - 2)}\${chars[chars.length - 1]}\`
}
`,
)
