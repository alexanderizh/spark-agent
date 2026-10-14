#!/usr/bin/env node
/**
 * MobileBridgeService 端到端冒烟测试（不依赖 vitest，node 直跑）：
 *   esbuild 打包服务（import type 擦除，@spark/shared 运行时桩）→ 起真实 HTTP/WS 服务 →
 *   用 fetch + ws 客户端走完整链路：配对（失败/成功）→ 鉴权 → 会话列表/新建/历史 →
 *   提交回合 → WebSocket 握手与增量事件帧 → 设备吊销。
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
  deleteSession: async (sessionId) => {
    deleteCalls.push(sessionId)
    return { deleted: true }
  },
  getHistory: async () => {
    historyCallCount += 1
    if (historyCallCount <= 2) {
      return { events: [], running: false }
    }
    return {
      events: [
        {
          id: 'e1',
          seq: 1,
          turnId: 't1',
          type: 'assistant_message',
          timestamp: new Date().toISOString(),
          content: '你好，这是桌面端回复',
          mode: 'complete',
          isFinal: true,
        },
      ],
      running: false,
    }
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

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  check(
    '重命名会话（PATCH）',
    rename.status === 200 && updateCalls[0]?.patch?.title === '新标题',
  )
  const emptyPatch = await api('PATCH', '/v1/sessions/s1', {}, deviceToken)
  check('空 patch 400', emptyPatch.status === 400)

  // f3. 删除会话（DELETE）
  const del = await api('DELETE', '/v1/sessions/s1', undefined, deviceToken)
  check('删除会话（DELETE）', del.status === 200 && del.json?.deleted === true && deleteCalls[0] === 's1')

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
