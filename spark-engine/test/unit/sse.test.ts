import { describe, expect, it } from 'vitest'

import { parseSseStream } from '../../src/llm/http/sse.js'

describe('SSE parser', () => {
  it('decodes split UTF-8, CRLF, comments, and multi-line data without loss', async () => {
    const bytes = new TextEncoder().encode(
      ': keepalive\r\nevent: delta\r\nid: 7\r\ndata: {"text":"你\r\ndata: 好"}\r\n\r\n',
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    })
    const events = []
    for await (const event of parseSseStream(stream)) events.push(event)
    expect(events).toEqual([{ event: 'delta', id: '7', data: '{"text":"你\n好"}' }])
  })

  it('rejects an event that exceeds the configured byte budget', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 123456789\n\n'))
        controller.close()
      },
    })
    const consume = async (): Promise<void> => {
      for await (const _event of parseSseStream(body, { maxEventBytes: 4 })) void _event
    }
    await expect(consume()).rejects.toMatchObject({ code: 'llm.sse_event_too_large' })
  })

  it('applies the byte budget per event rather than per network chunk', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\ndata: 2\n\n'))
        controller.close()
      },
    })
    const events = []
    for await (const event of parseSseStream(body, { maxEventBytes: 7 })) events.push(event)
    expect(events).toEqual([{ data: '1' }, { data: '2' }])
  })

  it('classifies response-body disconnects as retryable and preserves nested causes', async () => {
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'))
          return
        }
        controller.error(
          new TypeError('terminated', {
            cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
          }),
        )
      },
    })
    const events = parseSseStream(body, { provider: 'test-provider' })
    const iterator = events[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { data: '{"ok":true}' },
      done: false,
    })
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'llm.sse_stream_error',
      retryable: true,
      detail: {
        provider: 'test-provider',
        cause: {
          name: 'TypeError',
          message: 'terminated',
          cause: { code: 'ECONNRESET', message: 'socket reset' },
        },
      },
    })
  })
})
