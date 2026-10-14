import { writeFileSync } from 'node:fs'

writeFileSync(
  'src/parse-port.js',
  `export function parsePort(value) {
  if (typeof value === 'boolean' || value === null || value === undefined) throw new Error('port')
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^[0-9]+$/u.test(text)) throw new Error('port')
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port')
  return port
}
`,
)
