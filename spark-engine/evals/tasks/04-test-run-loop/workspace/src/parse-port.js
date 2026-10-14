export function parsePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port)) throw new Error('port')
  return port
}
