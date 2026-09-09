import { processPresentation } from './process-presentation.js'
import { stableStringify } from '../kernel/stable-json.js'

export interface ToolPresentation {
  readonly title: string
  readonly detail?: string
}

export interface ToolResultPresentation {
  readonly processStatus?: string
  readonly processId?: string
  readonly lines: readonly string[]
  readonly duration: string
  readonly sessionId?: string
}

const RESULT_MAX_LINES = 6
const RESULT_MAX_CHARACTERS = 720

/** Human-readable tool summaries; large payload fields never enter the transcript header. */
export function presentTool(tool: string, args: unknown): ToolPresentation {
  const record = isRecord(args) ? args : {}
  const display = toolDisplayName(tool)
  switch (tool) {
    case 'task': {
      const description = stringValue(record.description) ?? 'Delegated task'
      const allowed = Array.isArray(record.allowed_tools)
        ? record.allowed_tools.filter((value): value is string => typeof value === 'string')
        : []
      return {
        title: `${display} · ${singleLine(description, 72)}`,
        detail: allowed.length === 0 ? 'read-only' : `tools: ${singleLine(allowed.join(', '), 88)}`,
      }
    }
    case 'read':
    case 'write':
    case 'edit':
      return { title: `${display} · ${singleLine(stringValue(record.path) ?? 'unknown path', 88)}` }
    case 'glob': {
      const pattern = Array.isArray(record.pattern)
        ? record.pattern.join(', ')
        : stringValue(record.pattern)
      return { title: `${display} · ${singleLine(pattern ?? 'unknown pattern', 88)}` }
    }
    case 'grep': {
      const pattern = stringValue(record.pattern) ?? 'unknown pattern'
      const path = stringValue(record.path)
      return {
        title: `${display} · ${singleLine(pattern, 64)}`,
        ...(path === undefined ? {} : { detail: `in ${singleLine(path, 72)}` }),
      }
    }
    case 'process_wait':
    case 'process_cancel':
      return {
        title: `${tool === 'process_wait' ? 'Wait' : 'Cancel'} · ${singleLine(stringValue(record.process_id) ?? 'unknown process', 36)}`,
      }
    case 'bash':
      return {
        title: `${display} · ${singleLine(stringValue(record.command) ?? 'unknown command', 96)}`,
      }
    default: {
      const argsText = preview(args)
      return { title: argsText === '' ? display : `${display} · ${argsText}` }
    }
  }
}

/** Bounded tool output preview. The complete value remains in the event ledger/model context. */
export function presentToolResult(
  tool: string,
  content: string,
  durationMs: number,
  terminalWidth: number,
  recordedSessionId?: string,
): ToolResultPresentation {
  const sessionId =
    recordedSessionId ?? (tool === 'task' ? extractSubagentSessionId(content) : undefined)
  const managed = processPresentation(tool, content)
  const withoutSession =
    managed?.output ?? (sessionId === undefined ? content : removeSubagentSessionLine(content))
  const maximumLineWidth = Math.max(24, Math.min(120, terminalWidth - 8))
  const lines: string[] = []
  let used = 0
  const candidates = withoutSession.split('\n').map((line) => line.trimEnd())
  for (const candidate of candidates) {
    if (candidate.trim() === '') continue
    const remaining = RESULT_MAX_CHARACTERS - used
    if (remaining <= 0 || lines.length >= RESULT_MAX_LINES) break
    const line = truncateLine(
      sanitizeTerminalLine(candidate),
      Math.min(maximumLineWidth, remaining),
    )
    lines.push(line)
    used += line.length
  }
  if (
    candidates.filter((line) => line.trim() !== '').length > lines.length ||
    used >= RESULT_MAX_CHARACTERS
  ) {
    lines.push('…')
  }
  return {
    lines,
    duration: formatDuration(durationMs),
    ...(managed === undefined ? {} : { processStatus: managed.status, processId: managed.id }),
    ...(sessionId === undefined ? {} : { sessionId }),
  }
}

export function singleLine(value: string, maximum: number): string {
  const line = sanitizeTerminalLine(value.replaceAll(/\s+/g, ' ').trim())
  return line.length <= maximum ? line : `${line.slice(0, Math.max(0, maximum - 1))}…`
}

function preview(value: unknown): string {
  if (value === undefined) return ''
  try {
    return singleLine(stableStringify(value), 72)
  } catch {
    return '[unserializable]'
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

function truncateLine(value: string, maximum: number): string {
  const characters = Array.from(value)
  return characters.length <= maximum
    ? value
    : `${characters.slice(0, Math.max(0, maximum - 1)).join('')}…`
}

/** Prevent untrusted tool output from emitting terminal control sequences. */
function sanitizeTerminalLine(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0
    if (code === 9) return '  '
    if (code === 27) return '␛'
    if (code < 32 || code === 127) return '�'
    return character
  }).join('')
}

function toolDisplayName(tool: string): string {
  const names: Readonly<Record<string, string>> = {
    read: 'Read',
    glob: 'Glob',
    grep: 'Grep',
    write: 'Write',
    edit: 'Edit',
    bash: 'Bash',
    task: 'Task',
  }
  return names[tool] ?? singleLine(tool, 64)
}

function extractSubagentSessionId(content: string): string | undefined {
  return /Subagent session(?::|\s+)\s*([^\s]+)(?:\s+failed:)?/.exec(content)?.[1]
}

function removeSubagentSessionLine(content: string): string {
  return content
    .replace(/^Subagent session:\s*[^\s]+\s*\n?/, '')
    .replace(/^Subagent session\s+[^\s]+\s+failed:\s*/, '')
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
