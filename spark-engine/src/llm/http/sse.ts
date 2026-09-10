import { isAbortError } from '../../kernel/cancellation.js'
import { KernelError } from '../../kernel/errors.js'
import { safeErrorCause, safeErrorCauseSummary } from '../error-detail.js'

export interface SseEvent {
  readonly event?: string
  readonly data: string
  readonly id?: string
  readonly retry?: number
}

export interface SseParserOptions {
  readonly maxEventBytes?: number
  readonly provider?: string
  readonly signal?: AbortSignal
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  options: SseParserOptions = {},
): AsyncIterable<SseEvent> {
  const maxEventBytes = options.maxEventBytes ?? 8 * 1024 * 1024
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  let buffer = ''

  try {
    while (true) {
      let item: Awaited<ReturnType<typeof reader.read>>
      try {
        item = await reader.read()
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) throw error
        const cause = safeErrorCause(error)
        throw new KernelError(
          'llm.sse_stream_error',
          `${options.provider ?? 'Provider'} stream disconnected: ${safeErrorCauseSummary(cause)}`,
          {
            retryable: true,
            cause: error,
            detail: { ...(options.provider ? { provider: options.provider } : {}), cause },
          },
        )
      }
      const { done, value } = item
      if (done) break
      try {
        buffer += decoder.decode(value, { stream: true })
      } catch (error) {
        throw new KernelError('llm.sse_invalid_utf8', 'SSE stream was not valid UTF-8', {
          cause: error,
        })
      }

      while (true) {
        const boundary = findBoundary(buffer)
        if (!boundary) break
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        assertEventSize(encoder.encode(block).byteLength, maxEventBytes)
        const event = parseBlock(block)
        if (event) yield event
      }
      assertEventSize(encoder.encode(buffer).byteLength, maxEventBytes)
    }

    try {
      buffer += decoder.decode()
    } catch (error) {
      throw new KernelError('llm.sse_invalid_utf8', 'SSE stream ended with invalid UTF-8', {
        cause: error,
      })
    }
    if (buffer.trim()) {
      assertEventSize(encoder.encode(buffer).byteLength, maxEventBytes)
      const event = parseBlock(buffer)
      if (event) yield event
    }
  } finally {
    reader.releaseLock()
  }
}

function assertEventSize(actualBytes: number, maxEventBytes: number): void {
  if (actualBytes > maxEventBytes) {
    throw new KernelError('llm.sse_event_too_large', `SSE event exceeded ${maxEventBytes} bytes`)
  }
}

function findBoundary(value: string): { readonly index: number; readonly length: number } | null {
  const lf = value.indexOf('\n\n')
  const crlf = value.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (lf === -1) return { index: crlf, length: 4 }
  if (crlf === -1) return { index: lf, length: 2 }
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 }
}

function parseBlock(block: string): SseEvent | null {
  let event: string | undefined
  let id: string | undefined
  let retry: number | undefined
  const data: string[] = []

  for (const rawLine of block.split(/\r?\n/u)) {
    if (!rawLine || rawLine.startsWith(':')) continue
    const colon = rawLine.indexOf(':')
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon)
    let value = colon === -1 ? '' : rawLine.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
    else if (field === 'id' && !value.includes('\0')) id = value
    else if (field === 'retry' && /^\d+$/u.test(value)) retry = Number(value)
  }
  if (data.length === 0) return null
  return {
    data: data.join('\n'),
    ...(event === undefined ? {} : { event }),
    ...(id === undefined ? {} : { id }),
    ...(retry === undefined ? {} : { retry }),
  }
}
