import { describe, expect, it } from 'vitest';

import { parseSseStream } from '../../src/llm/http/sse.js';

describe('SSE parser', () => {
  it('decodes split UTF-8, CRLF, comments, and multi-line data without loss', async () => {
    const bytes = new TextEncoder().encode(
      ': keepalive\r\nevent: delta\r\nid: 7\r\ndata: {"text":"你\r\ndata: 好"}\r\n\r\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const events = [];
    for await (const event of parseSseStream(stream)) events.push(event);
    expect(events).toEqual([{ event: 'delta', id: '7', data: '{"text":"你\n好"}' }]);
  });

  it('rejects an event that exceeds the configured byte budget', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 123456789\n\n'));
        controller.close();
      },
    });
    const consume = async (): Promise<void> => {
      for await (const _event of parseSseStream(body, { maxEventBytes: 4 })) void _event;
    };
    await expect(consume()).rejects.toMatchObject({ code: 'llm.sse_event_too_large' });
  });
});
