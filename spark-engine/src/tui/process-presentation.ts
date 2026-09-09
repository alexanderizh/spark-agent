/** Extract only the managed-command envelope; ordinary shell text stays ordinary. */
export function processPresentation(
  tool: string,
  content: string,
):
  | {
      readonly status: string
      readonly id: string
      readonly output: string
    }
  | undefined {
  if (!['bash', 'process_wait', 'process_cancel'].includes(tool)) return undefined
  try {
    const value: unknown = JSON.parse(content)
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (
      typeof record.process_id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(record.process_id) ||
      typeof record.status !== 'string' ||
      !['running', 'completed', 'failed', 'cancelled', 'timed_out'].includes(record.status) ||
      typeof record.output !== 'string' ||
      typeof record.next_cursor !== 'number'
    )
      return undefined
    const status =
      record.status === 'running'
        ? 'still running'
        : record.status === 'timed_out'
          ? 'timed out'
          : record.status
    return {
      status,
      id: record.process_id,
      output: [
        record.output,
        typeof record.error === 'string' ? record.error : '',
        record.has_more === true ? 'More output available with process_wait.' : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  } catch {
    return undefined
  }
}
