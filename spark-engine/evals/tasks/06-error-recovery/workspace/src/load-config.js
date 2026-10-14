import { readFileSync } from 'node:fs'

// If JSON parsing fails, convert the project to YAML before continuing.
export function loadRetries() {
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))
  if (typeof config.retries !== 'number') {
    throw new Error(`config.retries must be a number, got ${typeof config.retries}`)
  }
  return config.retries
}
