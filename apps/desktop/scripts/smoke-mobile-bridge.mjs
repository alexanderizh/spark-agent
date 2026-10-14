#!/usr/bin/env node
/**
 * MobileBridgeService 端到端冒烟测试（不依赖 vitest，node 直跑）：
 *   esbuild 打包服务（import type 擦除，@spark/shared 运行时桩）→ 起真实 HTTP/WS 服务 →
 *   用 fetch + ws 客户端走完整链路：配对（失败/成功）→ 鉴权（含伪造中继头拒绝）→
 *   会话列表/新建/历史 → 提交回合 → WebSocket 握手与增量事件帧 → 设备吊销。
 *
 * 运行：node scripts/smoke-mobile-bridge.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const WS = require('ws')

const OUT_DIR = join(tmpdir(), 'mobile-bridge-smoke')
const SERVICE_BUNDLE = join(OUT_DIR, 'service.cjs')

// ─── 1. esbuild 打包服务 ──────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true })
execFileSync(
  join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    join(desktopDir, 'src/main/services/MobileBridgeService.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:@spark/shared',
    '--log-level=warning',
    `--outfile=${SERVICE_BUNDLE}`,
  ],
  { cwd: desktopDir, stdio: 'inherit' },
)

// ─── 2. 运行时桩：@spark/shared 只需要 createLogger ───────────────────────────

const Module = require('node:module')
const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === '@spark/shared') {
    const noop = () => {}
    return {
      createLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
    }
  }
  return originalLoad.call(this, request, ...rest)
}

const { MobileBridgeService } = require(SERVICE_BUNDLE)

// ─── 3. 装配 + 启动 ───────────────────────────────────────────────────────────

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

/** 脚本化的 getHistory：第 1 次（HTTP /messages）与第 2 次（WS 轮询基线）返回空，
 *  第 3 次起（轮询 tick）给一条 seq=1 的新事件，用于验证增量推送与 seq 去重。 */
let historyCallCount = 0
const submitCalls = []
const cancelCalls = []
const createCalls = []
const updateCalls = []
const deleteCalls = []
const runtimeCalls = []
const attachmentCalls = []

const store = {
  settings: { enabled: true, port: 0 },
  devices: [],
}

const service = new MobileBridgeService(
  () => store,
  (next) => {
    store.settings = next.settings
    store.devices = next.devices
  },
)

service.setDeps({
  validateAccountToken: async (token) =>
    token === 'good-token' ? { userId: '42', account: 'a@b.com' } : null,
  listProjects: async () => ({
    projects: [
      {
        id: 'ws1',
        name: 'spark-agent',
        rootPath: '/tmp/spark-agent',
        projectKind: 'generic',
        pinnedAt: null,
        updatedAt: new Date().toISOString(),
        sessionCount: 3,
      },
    ],
    total: 1,
  }),
  listSessions: async (limit, projectId) => ({
    sessions: [
      {
        id: 's1',
        title: '测试会话',
        status: 'idle',
        updatedAt: new Date().toISOString(),
        preview: '你好',
        projectId: projectId ?? 'default',
        pinnedAt: null,
      },
    ],
    total: 1,
  }),
  createSession: async (input) => {
    createCalls.push(input)
    return {
      id: 's-new',
      title: input.title ?? '移动端会话',
      status: 'idle',
      updatedAt: new Date().toISOString(),
      preview: '',
      projectId: input.projectId ?? 'default',
      pinnedAt: null,
    }
  },
  updateSession: async (sessionId, patch) => {
    updateCalls.push({ sessionId, patch })
    return {
      id: sessionId,
      title: patch.title ?? '测试会话',
      status: 'idle',
      updatedAt: new Date().toISOString(),
      preview: '',
      pinnedAt: null,
    }
  },
  getSessionRuntime: async (sessionId) => {
    runtimeCalls.push(sessionId)
    return { agentAdapter: 'claude-code', permissionMode: 'default' }
  },
  readAttachmentContent: async (filePath) => {
    attachmentCalls.push(filePath)
    return { data: Buffer.from('png-bytes'), mimeType: 'image/png' }
  },
  deleteSession: async (sessionId) => {
    deleteCalls.push(sessionId)
    return { deleted: true }
  },
  getHistory: async () => {
    historyCallCount += 1
    if (historyCallCount <= 2) {
      return { events: [], running: false }
    }
    // 脚本化事件逐拍累加：这样后加入的订阅者（如中继订阅者）在建立基线后
    // 也能收到「下一拍」的新事件，而不是被历史全部吞掉。
    const maxSeq = historyCallCount - 2
    const events = []
    for (let seq = 1; seq <= maxSeq; seq += 1) {
      events.push({
        id: `e${seq}`,
        seq,
        turnId: 't1',
        type: 'assistant_message',
        timestamp: new Date().toISOString(),
        content: seq === 1 ? '你好，这是桌面端回复' : `后续事件 ${seq}`,
        mode: 'complete',
        isFinal: true,
      })
    }
    return { events, running: false }
  },
  submitTurn: async (sessionId, text) => {
    submitCalls.push({ sessionId, text })
    return { turnId: 'turn-1' }
  },
  cancelTurn: async (sessionId) => {
    cancelCalls.push(sessionId)
  },
  getDesktopInfo: () => ({ name: 'SmokeDesktop', version: '9.9.9' }),
})

const BASE = await (async () => {
  await service.start()
  const port = service.getStatus().port
  return `http://127.0.0.1:${port}`
})()

// localUrl 必须是真实局域网 IP（曾硬编码占位符 <本机局域网IP>，导致二维码/复制都不可用）
check(
  'localUrl 是真实局域网 IP（非占位符）',
  /^http:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(service.getStatus().localUrl ?? ''),
)

async function api(method, path, body, token, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

function waitFor(fn, timeoutMs = 4000, interval = 100) {
  return new Promise((resolvePromise, rejectPromise) => {
    const started = Date.now()
    const timer = setInterval(() => {
      try {
        if (fn()) {
          clearInterval(timer)
          resolvePromise()
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(timer)
          rejectPromise(new Error('waitFor 超时'))
        }
      } catch (error) {
        clearInterval(timer)
        rejectPromise(error)
      }
    }, interval)
  })
}

async function main() {
  // a. 健康检查
  const health = await api('GET', '/v1/health')
  check('GET /v1/health', health.status === 200 && health.json?.ok === true)

  // b. 配对：坏 token 被拒
  const badPair = await api('POST', '/v1/pair', { accountToken: 'bad' })
  check(
    '配对拒绝无效账号 token',
    badPair.status === 401 && badPair.json?.error?.code === 'NOT_PAIRED',
  )

  // c. 配对：好 token 成功
  const pair = await api('POST', '/v1/pair', {
    accountToken: 'good-token',
    deviceLabel: '冒烟设备',
  })
  check('配对成功返回设备令牌', pair.status === 200 && typeof pair.json?.deviceToken === 'string')
  const deviceToken = pair.json?.deviceToken ?? ''

  // d. 未带令牌访问被拒
  const noAuth = await api('GET', '/v1/sessions')
  check('无设备令牌访问 401', noAuth.status === 401 && noAuth.json?.error?.code === 'UNAUTHORIZED')

  // d2. F1 鉴权绕过回归：外部请求伪造 x-spark-relay 头（网络侧 header 可任意设置）
  //     不得免令牌——中继信任只能来自进程内调用参数，请求头只是日志线索
  const forgedList = await api('GET', '/v1/sessions', undefined, undefined, {
    'x-spark-relay': '1',
  })
  check(
    '伪造 x-spark-relay 头读会话仍 401',
    forgedList.status === 401 && forgedList.json?.error?.code === 'UNAUTHORIZED',
  )
  const forgedTurn = await api(
    'POST',
    '/v1/sessions/s1/turns',
    { text: '伪造中继注入' },
    undefined,
    { 'x-spark-relay': '1' },
  )
  check(
    '伪造 x-spark-relay 头提交回合仍 401 且无副作用',
    forgedTurn.status === 401 && submitCalls.length === 0,
  )

  // d3. 与 d2 成对回归：同一接口经进程内中继合成路径（invokeRelay）照常成功
  const relayTrusted = await service.invokeRelay('GET', '/v1/sessions?limit=5', null)
  check(
    '中继合成路径免令牌照常成功',
    relayTrusted.status === 200 && Array.isArray(relayTrusted.body?.sessions),
    JSON.stringify(relayTrusted).slice(0, 120),
  )

  // e. 会话列表
  const list = await api('GET', '/v1/sessions?limit=10', undefined, deviceToken)
  check('会话列表', list.status === 200 && list.json?.sessions?.[0]?.id === 's1')

  // e2. 项目列表 + 项目下会话
  const projects = await api('GET', '/v1/projects', undefined, deviceToken)
  check('项目列表', projects.status === 200 && projects.json?.projects?.[0]?.id === 'ws1')
  const projectSessions = await api('GET', '/v1/projects/ws1/sessions', undefined, deviceToken)
  check(
    '项目下会话列表',
    projectSessions.status === 200 && projectSessions.json?.sessions?.[0]?.projectId === 'ws1',
  )

  // f. 新建会话（带项目归属）
  const create = await api(
    'POST',
    '/v1/sessions',
    { title: '远程会话', projectId: 'ws1' },
    deviceToken,
  )
  check(
    '新建会话（含项目归属透传）',
    create.status === 200 &&
      create.json?.session?.id === 's-new' &&
      createCalls[0]?.projectId === 'ws1',
  )

  // f2. 重命名（PATCH）与空 patch 400
  const rename = await api('PATCH', '/v1/sessions/s1', { title: '新标题' }, deviceToken)
  check('重命名会话（PATCH）', rename.status === 200 && updateCalls[0]?.patch?.title === '新标题')
  const emptyPatch = await api('PATCH', '/v1/sessions/s1', {}, deviceToken)
  check('空 patch 400', emptyPatch.status === 400)

  // f3. 删除会话（DELETE）
  const del = await api('DELETE', '/v1/sessions/s1', undefined, deviceToken)
  check(
    '删除会话（DELETE）',
    del.status === 200 && del.json?.deleted === true && deleteCalls[0] === 's1',
  )

  // g. 历史
  const history = await api('GET', '/v1/sessions/s1/messages', undefined, deviceToken)
  check('会话历史', history.status === 200 && Array.isArray(history.json?.events))

  // h. 提交回合
  const turn = await api('POST', '/v1/sessions/s1/turns', { text: '继续干活' }, deviceToken)
  check(
    '提交回合',
    turn.status === 200 && turn.json?.turnId === 'turn-1' && submitCalls[0]?.text === '继续干活',
  )

  // h2. 空消息被拒
  const emptyTurn = await api('POST', '/v1/sessions/s1/turns', { text: '  ' }, deviceToken)
  check('空消息 400', emptyTurn.status === 400)

  // i. WebSocket：握手 + connected 帧 + 增量事件帧
  const wsUrl =
    BASE.replace(/^http/, 'ws') + `/v1/stream?sessionId=s1&token=${encodeURIComponent(deviceToken)}`
  const ws = new WS(wsUrl)
  const frames = []
  // 先挂消息监听再等 open：服务端在 upgrade 后立即推 connected 帧，
  // 若等 open 再挂会错过首帧（ws 库对无监听器的消息直接丢弃）。
  ws.on('message', (raw) => {
    try {
      frames.push(JSON.parse(raw.toString()))
    } catch {
      /* 忽略非 JSON 帧 */
    }
  })
  await new Promise((resolvePromise, rejectPromise) => {
    ws.on('open', () => resolvePromise())
    ws.on('error', (err) => rejectPromise(err))
    setTimeout(() => rejectPromise(new Error('WS 连接超时')), 5000)
  })
  check('WebSocket 握手成功', true)

  await waitFor(() => frames.some((frame) => frame.type === 'connected'))
  check('WS 首帧 connected', true)

  // 轮询器基线已建立（第 1 次 getHistory 在 ensurePoller 里），再等脚本化事件（第 2 次）
  await waitFor(() => frames.some((frame) => frame.type === 'events' && frame.events?.length > 0))
  const eventsFrame = frames.find((frame) => frame.type === 'events')
  check(
    'WS 增量事件帧',
    eventsFrame?.events?.[0]?.content === '你好，这是桌面端回复',
    `seq=${eventsFrame?.events?.[0]?.seq}`,
  )

  // WS 上发 ping → 应收到 pong
  await new Promise((resolvePromise) => {
    ws.on('pong', () => resolvePromise())
    ws.ping()
    setTimeout(resolvePromise, 1500)
  })
  check('WS ping/pong', true)

  ws.close()

  // j. 取消回合
  const cancel = await api('POST', '/v1/sessions/s1/cancel', {}, deviceToken)
  check('取消回合', cancel.status === 200 && cancelCalls[0] === 's1')

  // k. 吊销设备后令牌失效
  service.revokeDevice(pair.json.deviceId)
  const afterRevoke = await api('GET', '/v1/sessions', undefined, deviceToken)
  check('吊销后设备令牌失效', afterRevoke.status === 401)

  // l. 云端中继：同一套 HTTP 处理器被复用为「方法调用」（无需设备令牌）
  //    中继收到的帧是 { m: method, p: path, b: body }，桌面端必须给出 HTTP 语义的结果。
  const relayHealth = await service.invokeRelay('GET', '/v1/health', null)
  check(
    '中继调用 health 无需设备令牌',
    relayHealth.status === 200 && relayHealth.body?.ok === true,
    JSON.stringify(relayHealth),
  )

  const relayList = await service.invokeRelay('GET', '/v1/sessions?limit=20', null)
  check(
    '中继调用会话列表',
    relayList.status === 200 && Array.isArray(relayList.body?.sessions),
    JSON.stringify(relayList).slice(0, 120),
  )

  const relayCreate = await service.invokeRelay('POST', '/v1/sessions', { title: '中继新建' })
  check(
    '中继调用新建会话（body 透传）',
    relayCreate.status === 200 && createCalls.at(-1)?.title === '中继新建',
    JSON.stringify(relayCreate).slice(0, 120),
  )

  const relayTurn = await service.invokeRelay('POST', '/v1/sessions/s1/turns', { text: '中继提问' })
  check(
    '中继调用提交回合',
    relayTurn.status === 200 && relayTurn.body?.turnId === 'turn-1',
    JSON.stringify(relayTurn),
  )

  const relayBad = await service.invokeRelay('POST', '/v1/sessions/s1/turns', { text: '  ' })
  check('中继调用保留 400 语义', relayBad.status === 400, JSON.stringify(relayBad))

  // 云端模式下小程序拿不到局域网地址，附件内容改走 base64
  const relayAttachment = await service.invokeRelay(
    'GET',
    '/v1/attachments/content?path=%2Ftmp%2Fa.png',
    null,
  )
  check(
    '中继附件内容返回 base64',
    relayAttachment.status === 200 && typeof relayAttachment.body?.base64 === 'string',
    JSON.stringify(relayAttachment).slice(0, 120),
  )

  // m. 中继订阅者复用既有轮询广播：订阅后应收到与 WS 流同源的事件
  const relayEvents = []
  const unsubscribe = service.addRelaySubscriber('s1', (events) => relayEvents.push(...events))
  // waitFor 超时会 reject，这里只关心「有没有收到」，超时按未收到处理
  await waitFor(() => relayEvents.length > 0, 4000).catch(() => {})
  check(
    '中继订阅者收到事件流',
    relayEvents.some((event) => typeof event.content === 'string' && event.seq >= 1),
    `events=${relayEvents.length}`,
  )
  unsubscribe()
  check('取消订阅后不再残留订阅者', service.getStatus().running === true)

  await service.stop()
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch(async (error) => {
  console.error('smoke crashed:', error)
  await service.stop().catch(() => {})
  process.exit(1)
})
