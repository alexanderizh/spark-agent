import { KernelError } from '../../kernel/errors.js'
import { safeDiagnosticText, safeErrorCause, safeProviderError } from '../error-detail.js'
import { parseSseStream, type SseEvent } from './sse.js'

export type FetchLike = typeof globalThis.fetch

export interface OpenSseOptions {
  readonly provider: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
  readonly signal: AbortSignal
  readonly fetch?: FetchLike
}

export interface OpenedSse {
  readonly events: AsyncIterable<SseEvent>
  readonly requestId?: string
}

export async function openSse(options: OpenSseOptions): Promise<OpenedSse> {
  const fetcher = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetcher(options.url, {
      method: 'POST',
      headers: {
        ...options.headers,
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal.aborted) throw error
    throw new KernelError('llm.transport_error', `${options.provider} request failed`, {
      retryable: true,
      cause: error,
      detail: { provider: options.provider, cause: safeErrorCause(error) },
    })
  }

  const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id')
  if (!response.ok) {
    const detail = await readError(response)
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
    throw new KernelError(
      errorCode(options.provider, response.status, detail.type),
      detail.message ?? `${options.provider} returned HTTP ${response.status}`,
      {
        retryable: isRetryableStatus(response.status),
        detail: {
          provider: options.provider,
          status: response.status,
          ...(detail.type ? { type: detail.type } : {}),
          ...(requestId ? { requestId } : {}),
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          ...(detail.providerError ? { providerError: detail.providerError } : {}),
        },
      },
    )
  }
  if (!response.body) {
    throw new KernelError('llm.empty_http_body', `${options.provider} returned no response body`, {
      retryable: true,
      detail: { provider: options.provider, ...(requestId ? { requestId } : {}) },
    })
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('text/event-stream')) {
    throw new KernelError(
      'llm.protocol_mismatch',
      `${options.provider} returned ${contentType || 'an unknown content type'} instead of text/event-stream`,
      { detail: { provider: options.provider, ...(requestId ? { requestId } : {}) } },
    )
  }
  return {
    events: parseSseStream(response.body, { provider: options.provider, signal: options.signal }),
    ...(requestId ? { requestId } : {}),
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

function errorCode(provider: string, status: number, type?: string): string {
  const suffix = type?.replace(/[^a-z0-9_.-]/giu, '_') ?? String(status)
  return `llm.${provider}.${suffix}`
}

async function readError(response: Response): Promise<{
  type?: string
  message?: string
  providerError?: Record<string, unknown>
}> {
  let text: string
  try {
    text = (await response.text()).slice(0, 32_768)
  } catch (error) {
    return {
      message: safeDiagnosticText(
        `HTTP ${response.status} error body could not be read: ${safeErrorCause(error).message}`,
      ),
    }
  }
  try {
    const value: unknown = JSON.parse(text)
    const record = asRecord(value)
    const nested = asRecord(record?.error)
    const rawType = stringValue(nested?.type) ?? stringValue(record?.type)
    const rawMessage =
      stringValue(nested?.message) ?? stringValue(record?.message) ?? stringValue(record?.error)
    const type = rawType ? safeDiagnosticText(rawType, 256) : undefined
    const message = rawMessage ? safeDiagnosticText(rawMessage) : undefined
    const providerError = safeProviderError(nested)
    return {
      ...(type ? { type } : {}),
      ...(message ? { message } : {}),
      ...(providerError && Object.keys(providerError).length > 0 ? { providerError } : {}),
    }
  } catch {
    return { ...(text ? { message: safeDiagnosticText(text) } : {}) }
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  if (/^\d+(?:\.\d+)?$/u.test(value)) return Math.max(0, Math.round(Number(value) * 1000))
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now())
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
