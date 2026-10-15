import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('src', { recursive: true })
writeFileSync(
  'src/slug.js',
  `export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}
`,
)
