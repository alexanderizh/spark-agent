import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import type {
  MobileBridgeEvent,
  MobileBridgeRelayFrame,
} from '../../../packages/protocol/src/mobile-bridge'
import { Relay, readEvents } from './relay'
import type { SocketPort } from './relay'
import { mergeEvents, reduceTimeline, timelineRows } from './timeline'

const messages = (...args: Parameters<typeof reduceTimeline>) => reduceTimeline(...args).messages

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
  assert.equal(req.p, '/v1/sessions/shared/messages?limit=200&turnLimit=12&eventLimit=1200')
  socket.receive({
    t: 'res',
    id: req.id,
    s: 200,
    b: { sessionId: 'shared', events: [], running: true },
  })
  assert.deepEqual(await history, { events: [], running: true, nextBeforeSeq: null })
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

test('distinguishes a write blocked before dispatch from an accepted write with a lost receipt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { relay, resume } = setup(t)
  await assert.rejects(relay.submit(target, 'queued message', 'id'), { outcome: 'not-sent' })
  const socket = resume()
  socket.receive({ t: 'welcome', devices: [] })
  const submit = relay.submit(target, 'queued message', 'id')
  const rejected = assert.rejects(submit, { outcome: 'unconfirmed' })
  // The desktop received the write, but it is queued and not yet present in history.
  assert.equal(socket.sent.at(-1)?.t, 'req')
  t.mock.timers.tick(30_000)
  await rejected

  const history = relay.history(target)
  const req = socket.sent.at(-1)
  assert.ok(req?.t === 'req')
  socket.receive({
    t: 'res',
    id: req.id,
    s: 200,
    b: { sessionId: 'shared', events: [], running: true },
  })
  assert.deepEqual((await history).events, [])
  assert.equal(socket.sent.filter((frame) => frame.t === 'req' && frame.m === 'POST').length, 1)
})

test('reads unassigned totals from the selected desktop without paging the full list', async (t) => {
  const { relay, resume } = setup(t)
  const socket = resume()
  socket.receive({ t: 'welcome', devices: [] })
  const count = relay.unassignedSessionCount(target.deviceId)
  const request = socket.sent.at(-1)
  assert.ok(request?.t === 'req')
  assert.equal(request.p, '/v1/sessions?limit=1&projectId=default')
  assert.equal(request.d, target.deviceId)
  socket.receive({ t: 'res', id: request.id, s: 200, b: { total: 6, sessions: [] } })
  assert.equal(await count, 6)

  const list = relay.projectList(target.deviceId)
  const projects = socket.sent.at(-1)
  assert.ok(projects?.t === 'req')
  socket.receive({
    t: 'res',
    id: projects.id,
    s: 200,
    b: { total: 0, projects: [], unassignedRunningSessionCount: 2 },
  })
  assert.equal((await list).unassignedRunningSessionCount, 2)
})

test('uses the desktop total and raw page length to reach session 51', async (t) => {
  const { relay, resume } = setup(t)
  const socket = resume()
  socket.receive({ t: 'welcome', devices: [] })
  const first = relay.sessions(target.deviceId)
  const req = socket.sent.at(-1)
  assert.ok(req?.t === 'req')
  socket.receive({
    t: 'res',
    id: req.id,
    s: 200,
    b: {
      total: 51,
      sessions: [...Array.from({ length: 49 }, (_, i) => ({ id: `s${i + 1}`, title: '' })), null],
    },
  })
  const page = await first
  assert.equal(page.sessions.length, 49)
  assert.equal(page.nextOffset, 50)
  const second = relay.sessions(target.deviceId, page.nextOffset)
  const next = socket.sent.at(-1)
  assert.ok(next?.t === 'req')
  assert.equal(next.p, '/v1/sessions?limit=50&offset=50')
  assert.equal(next.d, target.deviceId)
  socket.receive({
    t: 'res',
    id: next.id,
    s: 200,
    b: { total: 51, sessions: [{ id: 's51', title: '旧会话' }] },
  })
  assert.deepEqual(await second, { sessions: [{ id: 's51', title: '旧会话' }], nextOffset: null })
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

test('keeps earlier reply segments when the final event only repeats the last segment', () => {
  const first = event(1, 'first', { segmentId: 'intro', mode: 'complete' })
  const second = event(2, 'la', { segmentId: 'ending' })
  const third = event(3, 'st', { segmentId: 'ending' })
  const final = event(4, 'last', { isFinal: true, mode: 'complete' })
  assert.deepEqual(
    messages(mergeEvents([first, second, third], [final, third])).map((row) => row.text),
    ['first', 'last'],
  )
  assert.deepEqual(
    messages([final]).map((row) => row.text),
    ['last'],
  )
})

test('preserves the identity and order of streamed segments when a full reply arrives', () => {
  const intro = event(1, 'Checking.\n', { segmentId: 'intro', mode: 'complete' })
  const ending = event(2, 'Found', { segmentId: 'ending' })
  const final = event(3, 'Checking.\nFound it.', { isFinal: true, mode: 'complete' })
  const live = messages([intro, ending])
  assert.deepEqual(messages([intro, ending, final]), [live[0], { ...live[1], text: 'Found it.' }])
  assert.deepEqual(messages([intro, ending, { ...final, content: 'Checking.\nFound' }]), live)
})

test('keeps tool progress between streamed paragraphs through history reconciliation', () => {
  const thinking = event(1, 'Reading', { type: 'agent_thinking', segmentId: 'reasoning' })
  const intro = event(2, 'Checking.\n', { segmentId: 'intro' })
  const request = event(3, '', { type: 'tool_call', toolCallId: 'tool-1', toolName: 'lookup' })
  const result = event(4, '', { type: 'tool_result', toolCallId: 'tool-1', toolStatus: 'error' })
  const reply = event(5, 'Found it.', { segmentId: 'ending' })
  const final = event(6, 'Checking.\nFound it.', { isFinal: true, mode: 'complete' })
  const live = readEvents([thinking, intro, request])
  const progress = messages(live)[2]
  assert.equal(progress?.toolStatus, 'running')
  const rows = messages(
    mergeEvents(live, readEvents([intro, request, result, reply, final])),
    false,
  )
  assert.deepEqual(
    rows.map((row) => row.role),
    ['thinking', 'assistant', 'tool', 'assistant'],
  )
  assert.equal(rows[2]?.key, progress?.key)
  assert.equal(rows[2]?.toolName, 'lookup')
  assert.equal(rows[2]?.toolStatus, 'error')
  assert.equal(messages(live, false)[2]?.toolStatus, 'success')
})

test('history uses the raw cursor even when the desktop mapped the page to no events', async (t) => {
  const { relay, resume } = setup(t)
  const socket = resume()
  socket.receive({ t: 'welcome', devices: [] })
  const load = (beforeSeq?: number) => {
    const result = relay.history(target, beforeSeq)
    const req = socket.sent.at(-1)
    assert.ok(req?.t === 'req')
    assert.equal(req.d, target.deviceId)
    assert.equal(
      req.p,
      `/v1/sessions/shared/messages?limit=200&turnLimit=12&eventLimit=1200${beforeSeq == null ? '' : `&beforeSeq=${beforeSeq}`}`,
    )
    return { result, req }
  }
  const latest = load()
  socket.receive({
    t: 'res',
    id: latest.req.id,
    s: 200,
    b: {
      sessionId: 'shared',
      running: true,
      events: [],
      hasMore: true,
      nextBeforeSeq: 80,
    },
  })
  const page = await latest.result
  assert.equal(page.nextBeforeSeq, 80)
  const earlier = load(page.nextBeforeSeq ?? undefined)
  const failed = assert.rejects(earlier.result, /历史分页游标/)
  socket.receive({
    t: 'res',
    id: earlier.req.id,
    s: 200,
    b: {
      sessionId: 'shared',
      running: false,
      events: [],
      hasMore: true,
      nextBeforeSeq: 80,
    },
  })
  await failed
})

test('stops the selected desktop session and requires an acknowledgement', async (t) => {
  const { relay, resume } = setup(t)
  const socket = resume()
  socket.receive({ t: 'welcome', devices: [] })
  const request = relay.cancel(target)
  const frame = socket.sent.at(-1)
  assert.deepEqual(frame, {
    t: 'req',
    id: 'native-1',
    m: 'POST',
    p: '/v1/sessions/shared/cancel',
    b: null,
    d: 'desktop-a',
  })
  socket.receive({ t: 'res', id: 'native-1', s: 200, b: { cancelled: true } })
  await request
  const rejected = assert.rejects(relay.cancel(target), /电脑未确认停止/)
  socket.receive({ t: 'res', id: 'native-2', s: 200, b: { cancelled: false } })
  await rejected
})

test('projects the same completed-round divider and day grouping as the mini-program', () => {
  const events = [
    event(1, 'Question', { type: 'user_message' }),
    event(2, 'Intro', { segmentId: 'intro' }),
    event(3, '', { type: 'tool_call', toolCallId: 'tool-1', toolName: 'lookup' }),
    event(4, 'Answer', { segmentId: 'answer' }),
    event(5, '', { type: 'agent_status', status: 'completed' }),
  ]
  const timeline = reduceTimeline(events)
  const folded = timelineRows(timeline, new Set())
  assert.deepEqual(
    folded.map((row) => row.kind),
    ['time', 'user', 'divider', 'assistant'],
  )
  const divider = folded.find((row) => row.kind === 'divider')
  assert.ok(divider)
  const unfolded = timelineRows(timeline, new Set([divider.key]))
  assert.deepEqual(
    unfolded.map((row) => row.kind),
    ['time', 'user', 'divider', 'assistant', 'tool', 'assistant'],
  )
})

test('routes interactions to the selected session and recognizes expired replies', async (t) => {
  const { relay, resume } = setup(t)
  const socket = resume()
  socket.receive({ t: 'welcome', devices: [] })
  const interactions = relay.interactions(target)
  const question = {
    questionId: 'q/1',
    sessionId: 'shared',
    createdAt: '',
    questions: [{ header: '', question: 'Ready?' }],
  }
  assert.deepEqual(socket.sent.at(-1), {
    t: 'req',
    id: 'native-1',
    m: 'GET',
    p: '/v1/sessions/shared/interactions',
    b: null,
    d: 'desktop-a',
  })
  socket.receive({
    t: 'res',
    id: 'native-1',
    s: 200,
    b: {
      approvals: [{ requestId: 'different', sessionId: 'other' }],
      questions: [
        question,
        { ...question, questionId: 'malformed', questions: [null, ...question.questions] },
      ],
    },
  })
  const snapshot = await interactions
  assert.deepEqual(snapshot.approvals, [])
  assert.deepEqual(
    snapshot.questions.map((row) => row.questionId),
    ['q/1'],
  )
  const approval = relay.resolveApproval(target, 'a/1', 'deny')
  assert.deepEqual(socket.sent.at(-1), {
    t: 'req',
    id: 'native-2',
    m: 'POST',
    p: '/v1/sessions/shared/approvals/a%2F1/resolve',
    b: { decision: 'deny' },
    d: 'desktop-a',
  })
  socket.receive({ t: 'res', id: 'native-2', s: 200, b: { ok: false } })
  assert.equal(await approval, false)
  const answers = { answers: [{ index: 0, answer: 'Yes' }], questionCount: 1, answeredCount: 1 }
  const answer = relay.answerQuestion(target, 'q/1', answers)
  assert.deepEqual(socket.sent.at(-1), {
    t: 'req',
    id: 'native-3',
    m: 'POST',
    p: '/v1/sessions/shared/questions/q%2F1/answer',
    b: { answers },
    d: 'desktop-a',
  })
  socket.receive({ t: 'res', id: 'native-3', s: 200, b: { ok: true } })
  assert.equal(await answer, true)
})

test('filters unrelated lineage and forks at the selected turn on the target desktop', async (t) => {
  const { relay, resume } = setup(t)
  const socket = resume()
  socket.receive({ t: 'welcome', devices: [] })
  const lineage = relay.lineage(target)
  socket.receive({
    t: 'res',
    id: 'native-1',
    s: 200,
    b: {
      lineage: { childSessionId: 'shared', parentSessionId: 'source', sourceTitleSnapshot: '来源' },
      children: [
        { parentSessionId: 'shared', childSessionId: 'child', childTitle: '分支' },
        { parentSessionId: 'other', childSessionId: 'bad' },
      ],
    },
  })
  assert.deepEqual(await lineage, {
    parent: { id: 'source', title: '来源' },
    children: [{ id: 'child', title: '分支' }],
  })
  const fork = relay.fork(target, 'turn-42', '')
  assert.deepEqual(socket.sent.at(-1), {
    t: 'req',
    id: 'native-2',
    m: 'POST',
    p: '/v1/sessions/shared/fork',
    b: { anchorTurnId: 'turn-42' },
    d: 'desktop-a',
  })
  socket.receive({
    t: 'res',
    id: 'native-2',
    s: 200,
    b: { session: { id: 'child', title: '分支' } },
  })
  assert.equal((await fork).session.id, 'child')
})

test('keeps a project session creation and sidebar ordering scoped to the selected desktop', async (t) => {
  const { relay, resume } = setup(t)
  const socket = resume()
  socket.receive({ t: 'welcome', devices: [] })
  const create = relay.createSession('desktop-b', 'project-1', '新会话')
  const creation = socket.sent.at(-1)
  assert.ok(creation?.t === 'req')
  assert.equal(creation.d, 'desktop-b')
  assert.equal(creation.p, '/v1/sessions')
  assert.deepEqual(creation.b, { projectId: 'project-1', title: '新会话' })
  socket.receive({
    t: 'res',
    id: creation.id,
    s: 200,
    b: { session: { id: 'new', title: '新会话' } },
  })
  assert.deepEqual(await create, { id: 'new', title: '新会话' })

  const sort = relay.saveSidebarOrder('desktop-b', {
    scope: 'projects',
    itemIds: ['second', 'first'],
  })
  const sorting = socket.sent.at(-1)
  assert.ok(sorting?.t === 'req')
  assert.equal(sorting.d, 'desktop-b')
  assert.equal(sorting.p, '/v1/sidebar-order')
  assert.deepEqual(sorting.b, { scope: 'projects', itemIds: ['second', 'first'] })
  socket.receive({ t: 'res', id: sorting.id, s: 200, b: { itemIds: ['first', 'second'] } })
  await assert.rejects(sort, /排序未确认/)
})
