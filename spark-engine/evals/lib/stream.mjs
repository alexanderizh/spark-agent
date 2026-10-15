import { preview, redactSecrets } from './config.mjs'

export function parseSparkStream(stdout, secrets) {
  const calls = new Map()
  let turnStatus = 'unknown'
  let turnError = null
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (
      event.type === 'tool.call' &&
      typeof event.callId === 'string' &&
      !calls.has(event.callId)
    ) {
      const argsText = redactSecrets(preview(event.args, 500), secrets)
      calls.set(event.callId, {
        tool: typeof event.tool === 'string' ? event.tool : 'unknown',
        ok: null,
        durationMs: null,
        argsPreview: preview(argsText, 240),
        argsText,
        resultPreview: '',
      })
    } else if (event.type === 'tool.result' && calls.has(event.callId)) {
      const call = calls.get(event.callId)
      call.ok = event.ok === true
      call.durationMs = typeof event.durationMs === 'number' ? event.durationMs : null
      call.resultPreview = preview(redactSecrets(String(event.content ?? ''), secrets), 240)
    } else if (event.type === 'turn.completed') {
      turnStatus = 'completed'
    } else if (event.type === 'turn.cancelled') {
      turnStatus = 'cancelled'
    } else if (event.type === 'turn.failed') {
      turnStatus = 'failed'
      turnError = redactSecrets(event.error?.message ?? 'turn.failed', secrets)
    }
  }
  const toolNotes = [...calls.values()].map((call) => ({
    tool: call.tool,
    ok: call.ok,
    durationMs: call.durationMs,
    argsPreview: call.argsPreview,
    resultPreview: call.resultPreview,
    argsText: call.argsText,
  }))
  const toolCounts = {}
  for (const note of toolNotes) toolCounts[note.tool] = (toolCounts[note.tool] ?? 0) + 1
  return { toolNotes, toolCounts, turnStatus, turnError }
}
