import { spawnSync } from 'node:child_process'

export function finish(checks) {
  const ok = checks.every((check) => check.passed === true)
  process.stdout.write(`${JSON.stringify({ ok, checks })}\n`, () => {
    process.exit(ok ? 0 : 1)
  })
}

export function runNode(args, timeoutMs = 20_000) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const detail = [stdout, stderr]
    .filter((chunk) => chunk.trim())
    .join('\n')
    .trim()
    .slice(-800)
  return {
    passed: result.status === 0,
    stdout,
    stderr,
    detail: detail || `exit ${result.status}`,
  }
}
