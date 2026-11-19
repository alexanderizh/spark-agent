import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import type {
  MobileBridgeEvent,
  MobileBridgeRelayFrame,
} from '../../../packages/protocol/src/mobile-bridge'
import { Relay, readEvents } from './relay'
import type { SocketPort } from './relay'
import { mergeEvents, messages } from './timeline'

class FakeSocket implements SocketPort {
  onopen: SocketPort['onopen'] = null
  onmessage: SocketPort['onmessage'] = null
  onerror: SocketPort['onerror'] = null
  onclose: SocketPort['onclose'] = null
  sent: MobileBridgeRelayFrame[] = []
  send(text: string) {
    this.sent.push(JSON.parse(text))
  }
  close() {
    this.onclose?.({ code: 1000 } as CloseEvent)
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent)
  }
  open() {
    this.onopen?.({} as Event)
  }
}

const target = { deviceId: 'desktop-a', sessionId: 'shared' }
const event = (
  seq: number,
  content: string,
  patch: Partial<MobileBridgeEvent> = {},
): MobileBridgeEvent => ({
  id: `e${seq}`,
  seq,
  type: 'assistant_message',
  turnId: 'turn-1',
  timestamp: '2026-11-19T00:00:00Z',
  mode: 'delta',
  content,
  ...patch,
})

function setup(t: TestContext) {
  const sockets: FakeSocket[] = []
  const relay = new Relay(
    'sample-token',
    'rn-test',
    {
      presence: () => undefined,
      restored: () => undefined,
      issue: () => undefined,
      state: () => undefined,
    },
    () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  )
  t.after(() => relay.pause())
  const resume = () => {
    relay.resume()
    const socket = sockets.at(-1)
    assert.ok(socket)
    socket.open()
    return socket
  }
  return { relay, resume, sockets }
}

test('waits for welcome, routes the history call, and rejects cross-device events', async (t) => {
  const { relay, resume } = setup(t)
  const socket = resume()
  const seen: MobileBridgeEvent[] = []
  relay.subscribe(target, (events) => seen.push(...events))
  await assert.rejects(relay.history(target), /尚未连接/)
  assert.deepEqual(
    socket.sent.map((frame) => frame.t),
    ['hello'],
  )
  socket.receive({ t: 'welcome', devices: [] })
  assert.deepEqual(socket.sent.at(-1), { t: 'sub', sessionId: 'shared', d: 'desktop-a' })
  const history = relay.history(target)
  const req = socket.sent.at(-1)
  assert.ok(req?.t === 'req')
  assert.equal(req.d, 'desktop-a')
  assert.equal(req.p, '/v1/sessions/shared/messages?limit=200')
  socket.receive({
    t: 'res',
    id: req.id,
    s: 200,
    b: { sessionId: 'shared', events: [], running: true },
  })
  assert.deepEqual(await history, { events: [], running: true })
  for (const d of ['desktop-b', undefined, 'desktop-a']) {
    socket.receive({ t: 'event', d, sessionId: 'shared', events: [event(1, 'hello')] })
  }
  socket.receive({ t: 'event', d: 'desktop-a', sessionId: 'other', events: [event(2, 'wrong')] })
  assert.deepEqual(
    seen.map((entry) => entry.content),
    ['hello'],
  )
})

test('resubscribes after reconnect without replaying a write with an unknown outcome', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { relay, resume, sockets } = setup(t)
  const first = resume()
  first.receive({ t: 'welcome', devices: [] })
  relay.subscribe(target, () => undefined)
  const turn = relay.submit(target, 'hello', 'fixed-message-id')
  assert.deepEqual(first.sent.at(-1), {
    t: 'req',
    id: 'native-1',
    m: 'POST',
    p: '/v1/sessions/shared/turns',
    b: { text: 'hello', clientMessageId: 'fixed-message-id' },
    d: 'desktop-a',
  })
  first.close()
  await assert.rejects(turn, /连接已关闭/)
  t.mock.timers.tick(1000)
  const second = sockets.at(-1)
  assert.ok(second && second !== first)
  second.open()
  second.receive({ t: 'welcome', devices: [] })
  assert.deepEqual(
    second.sent.map((frame) => frame.t),
    ['hello', 'sub'],
  )
})

test('ignores stale subscriptions and stops reconnecting after an auth error', (t) => {
  const { relay, resume, sockets } = setup(t)
  const socket = resume()
  socket.receive({ t: 'welcome', devices: [] })
  const seen: string[] = []
  const unsubscribe = relay.subscribe(target, () => seen.push('a'))
  relay.subscribe({ ...target, deviceId: 'desktop-b' }, () => seen.push('b'))
  unsubscribe()
  socket.receive({ t: 'event', d: 'desktop-a', sessionId: 'shared', events: [event(1, 'a')] })
  socket.receive({ t: 'event', d: 'desktop-b', sessionId: 'shared', events: [event(1, 'b')] })
  socket.receive({ t: 'error', code: 'UNAUTHORIZED' })
  relay.resume()
  socket.receive({ t: 'event', d: 'desktop-b', sessionId: 'shared', events: [event(2, 'late')] })
  assert.deepEqual(seen, ['b'])
  assert.equal(sockets.length, 1)
})

test('merges out-of-order live deltas with history without duplicate final replies', () => {
  const first = event(1, 'hel', { segmentId: 'paragraph' })
  const second = event(2, 'lo', { segmentId: 'paragraph' })
  const merged = mergeEvents([second], [first, second])
  assert.deepEqual(
    messages(merged).map((row) => row.text),
    ['hello'],
  )
  const final = event(3, 'hello!', { isFinal: true, mode: 'complete' })
  assert.deepEqual(
    messages(mergeEvents(merged, [final])).map((row) => row.text),
    ['hello!'],
  )
  const { content: _ignored, ...withoutContent } = first
  assert.deepEqual(readEvents([null, { ...first, seq: '1' }, { ...first, content: {} }]), [
    withoutContent,
  ])
})
