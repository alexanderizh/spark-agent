import { writeFileSync } from 'node:fs'

writeFileSync(
  'src/label.js',
  `export function label(user) {
  const id = String(user.id ?? '')
  const raw = typeof user.role === 'string' ? user.role.trim() : ''
  const role = raw === '' ? 'GUEST' : raw.toUpperCase()
  return \`ID:\${id}|ROLE:\${role}\`
}
`,
)
