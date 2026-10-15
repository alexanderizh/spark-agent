#!/usr/bin/env node
/**
 * 云端中继端到端冒烟（小程序侧）。
 *
 * 不是「协议对不对」的单元测试，而是把三样真东西接起来跑一遍：
 *   小程序 api/bridge.ts + api/relay.ts（真实源码）
 *     ↔ edu-server src/service/mobile-bridge/relay-hub.ts（真实中继实现）
 *       ↔ 假桌面端（脚本扮演，按桌面端协议回 res / 推 event）
 *
 * 覆盖：握手、调用转发与应答、多电脑 deviceId 定向（另一台不受打扰）、
 *       503 离线提示、事件订阅（带 d）与来源隔离、presence devices 设备列表、
 *       授信设备 REST 形状、断线时挂起调用立即失败。
 *
 * 运行：node scripts/smoke-relay.mjs
 */

import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// apps/mobile → apps → Spark-Agent → spark_ai_project → spark-edugen/edu-server
// （edu-server 在另一个仓库，用 SPARK_EDUGEN_DIR 可以覆盖）
const repoRoot = resolve(root, '..', '..')
const eduServer =
  process.env.SPARK_EDUGEN_DIR?.trim() ||
  resolve(root, '..', '..', '..', 'spark-edugen', 'edu-server')
const outDir = mkdtempSync(join(tmpdir(), 'mp-relay-smoke-'))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitUntil(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(20)
  }
  return predicate()
}

// ─── 1. 编译 edu-server 的真实中继实现 ────────────────────────────────────────

console.log('编译 edu-server relay-hub.ts …')
execFileSync(
  join(eduServer, 'node_modules', '.bin', 'tsc'),
  [
    join(eduServer, 'src/service/mobile-bridge/relay-hub.ts'),
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--target',
    'es2020',
    '--moduleResolution',
    'node',
    '--skipLibCheck',
    '--esModuleInterop',
  ],
  { cwd: eduServer, stdio: 'pipe' },
)
const { RelayHub } = require(join(outDir, 'relay-hub.js'))

// ─── 2. 打包小程序真实的 bridge + relay ──────────────────────────────────────

console.log('打包 apps/mobile/src/api/bridge.ts …')
const bridgeBundle = join(outDir, 'bridge.cjs')
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(root, 'src/api/bridge.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--log-level=warning',
    `--outfile=${bridgeBundle}`,
  ],
  { cwd: root, stdio: 'inherit' },
)

// ─── 3. 假 WebSocket（给 RelayHub 当连接用） ──────────────────────────────────

class FakeSocket extends EventEmitter {
  constructor() {
    super()
    this.readyState = 1
    this.outbox = []
  }
  send(data) {
    this.outbox.push(data)
    this.emit('out', data)
  }
  ping() {}
  terminate() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.emit('close')
  }
  close() {
    this.terminate()
  }
}

// ─── 4. wx 全局桩 ────────────────────────────────────────────────────────────

const storage = new Map()
const USER_ID = 'u1'
const hub = new RelayHub(null)
const restCalls = []
const REST_DEVICES = {
  code: 0,
  data: {
    devices: [
      {
        deviceId: 'mac-01',
        name: 'MacBook Pro',
        version: '1.2.3',
        online: true,
        lastSeenAt: new Date().toISOString(),
        trustedAt: new Date().toISOString(),
      },
      {
        deviceId: 'mac-02',
        name: 'Mac mini',
        version: '1.2.3',
        online: false,
        lastSeenAt: null,
        trustedAt: new Date().toISOString(),
      },
    ],
  },
}

global.wx = {
  env: { USER_DATA_PATH: tmpdir() },
  getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  reLaunch: () => {},
  getFileSystemManager: () => ({ writeFileSync: () => {} }),
  /** 小程序 ↔ 中继：把 SocketTask 桥接到真实的 RelayHub 上 */
  connectSocket: ({ url }) => {
    const parsed = new URL(url)
    const socket = new FakeSocket()
    const handlers = { open: [], message: [], close: [], error: [] }

    const task = {
      onOpen: (cb) => handlers.open.push(cb),
      onMessage: (cb) => handlers.message.push(cb),
      onClose: (cb) => handlers.close.push(cb),
      onError: (cb) => handlers.error.push(cb),
      send: ({ data }) => socket.emit('message', Buffer.from(String(data), 'utf8')),
      close: () => socket.terminate(),
    }

    socket.on('out', (data) => {
      // 服务端 → 小程序：异步派发，贴近真实事件循环
      setTimeout(() => {
        for (const cb of handlers.message) cb({ data })
      }, 0)
    })
    socket.on('close', () => {
      setTimeout(() => {
        for (const cb of handlers.close) cb({ code: 1000 })
      }, 0)
    })

    hub.attach('client', USER_ID, socket, { deviceId: 'mp-01', label: '微信小程序' })

    setTimeout(() => {
      for (const cb of handlers.open) cb({})
    }, 0)
    void parsed
    return task
  },
  /** 授信设备管理 REST（edu-server HTTP 接口）的桩：返回协议 v2 形状 */
  request: ({ url, method, success }) => {
    restCalls.push({ url, method })
    const body = url.includes('/mobile-bridge/devices') ? REST_DEVICES : { ok: true, running: true }
    setTimeout(() => success({ statusCode: 200, data: body }), 0)
  },
}

const bridge = require(bridgeBundle)

// ─── 5. 扮演桌面端：按协议回 res / 推 event ──────────────────────────────────

function attachDesktop(deviceId, label) {
  const socket = new FakeSocket()
  const inbox = []
  socket.on('out', (data) => inbox.push(JSON.parse(data)))
  hub.attach('desktop', USER_ID, socket, { deviceId, label, version: '1.2.3' })
  return {
    socket,
    inbox,
    reqCount: () => inbox.filter((f) => f.t === 'req').length,
    reply: (frame, body) =>
      socket.emit('message', Buffer.from(JSON.stringify({ t: 'res', id: frame.id, s: 200, b: body }))),
    pushEvent: (sessionId, events) =>
      socket.emit('message', Buffer.from(JSON.stringify({ t: 'event', sessionId, events }))),
    waitFor: async (predicate, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const hit = inbox.find(predicate)
        if (hit) return hit
        await sleep(20)
      }
      return null
    },
  }
}

async function main() {
  console.log('\n—— 云端中继端到端 ——\n')

  storage.set('spark-mobile:token', 'fake-jwt')

  // 1) 中继是唯一传输：登录即可用
  check('登录后即可发起会话调用（isReady）', bridge.isReady() === true)

  const desktop1 = attachDesktop('mac-01', 'MacBook Pro')

  // 2) 一次真实调用：bridge.listSessions → WS → hub → 桌面端 → 原路返回
  const listPromise = bridge.listSessions(50)
  const frame = await desktop1.waitFor((f) => f.t === 'req')
  check('桌面端收到 req 帧', frame != null)
  check('req 保留 path 与 query', frame?.p === '/v1/sessions?limit=50', String(frame?.p))
  check('req 保留 method', frame?.m === 'GET', String(frame?.m))
  desktop1.reply(frame, { sessions: [{ id: 's1', title: '测试会话' }], total: 1 })
  const listResult = await listPromise
  check(
    '经中继拉到会话列表',
    Array.isArray(listResult.sessions) && listResult.sessions[0]?.id === 's1',
    JSON.stringify(listResult).slice(0, 90),
  )

  // 3) presence：第二台电脑上线后，小程序端设备列表应包含两台
  const desktop2 = attachDesktop('mac-02', 'Mac mini')
  const devicesSeen = await waitUntil(() => {
    const list = bridge.getRelayPresenceDevices()
    const ids = list.map((d) => d.deviceId)
    return ids.includes('mac-01') && ids.includes('mac-02')
  })
  check(
    'presence 设备列表包含两台桌面端',
    devicesSeen,
    JSON.stringify(bridge.getRelayPresenceDevices().map((d) => d.deviceId)),
  )
  check('presence 设备携带展示名', bridge.getRelayPresenceDevices().some((d) => d.label === 'Mac mini'))
  check('任一桌面端在线 → isRelayDesktopOnline=true', bridge.isRelayDesktopOnline() === true)

  // 4) 多电脑定向：req 带 d=mac-02 → 只有 mac-02 收到
  const d1Baseline = desktop1.reqCount()
  const targetPromise = bridge.listSessions(10, undefined, 'mac-02')
  const targetFrame = await desktop2.waitFor((f) => f.t === 'req' && f.p === '/v1/sessions?limit=10')
  check('定向调用到达指定电脑（mac-02）', targetFrame != null)
  desktop2.reply(targetFrame, { sessions: [{ id: 's2', title: 'mini 会话' }], total: 1 })
  const targetResult = await targetPromise
  check(
    '定向调用应答原路返回',
    targetResult.sessions?.[0]?.id === 's2',
    JSON.stringify(targetResult).slice(0, 90),
  )
  await sleep(250)
  check('另一台电脑（mac-01）没有收到定向调用', desktop1.reqCount() === d1Baseline)

  // 5) 授信设备管理 REST：形状对齐协议（name / trustedAt / online）
  const restResult = await bridge.listRelayDevices()
  const restDevices = restResult?.devices ?? []
  check(
    '授信设备 REST 列表形状（含离线设备）',
    restDevices.length === 2 && restDevices[0]?.name === 'MacBook Pro' && restDevices[0]?.trustedAt != null,
    JSON.stringify(restDevices.map((d) => `${d.deviceId}:${d.online}`)),
  )
  check('授信设备 REST 走 /api/v1/mobile-bridge/devices', restCalls.some((c) => c.url.includes('/api/v1/mobile-bridge/devices')))

  // 6) 桌面端全部离线：503 DESKTOP_OFFLINE 要变成可读的中文原因
  desktop1.socket.terminate()
  desktop2.socket.terminate()
  await sleep(120)
  let offlineError = null
  try {
    await bridge.listSessions(10)
  } catch (error) {
    offlineError = error
  }
  check('桌面端离线时抛错', offlineError != null)
  check(
    '离线错误原因是 DESKTOP_OFFLINE',
    offlineError?.reason === 'DESKTOP_OFFLINE',
    `${offlineError?.reason} / ${offlineError?.message}`,
  )
  check(
    '离线提示给出可执行动作',
    /云端中继/.test(offlineError?.hint ?? ''),
    offlineError?.hint ?? '',
  )
  check('全部离线后 isRelayDesktopOnline=false', bridge.isRelayDesktopOnline() === false)

  // 7) 事件订阅（带 d 定向）与来源隔离：
  //    订阅 mac-02 的 sess-1；mac-01 推同名会话事件不应到达（服务端按 (d,sessionId)
  //    隔离；即便漏隔离，端上也按 event.d 丢弃——双保险）
  const desktopA = attachDesktop('mac-01', 'MacBook Pro')
  const desktopB = attachDesktop('mac-02', 'Mac mini')
  const events = []
  const unsubscribe = bridge.connectStream(
    'sess-1',
    {
      onEvent: (list) => events.push(...list),
      onError: () => {},
      onClose: () => {},
    },
    'mac-02',
  )
  await sleep(150)
  const subFrame = await desktopB.waitFor((f) => f.t === 'sub' && f.sessionId === 'sess-1')
  check('订阅指令到达定向电脑（mac-02）', subFrame != null, JSON.stringify(subFrame ?? null))
  desktopA.pushEvent('sess-1', [{ seq: 1, content: '另一台电脑的同名会话' }])
  await sleep(150)
  check('来源设备不匹配的事件被丢弃', events.length === 0, JSON.stringify(events))
  desktopB.pushEvent('sess-1', [{ seq: 2, content: '定向你好' }])
  await sleep(150)
  check(
    '定向电脑的事件正常送达',
    events.length === 1 && events[0]?.content === '定向你好',
    JSON.stringify(events),
  )
  unsubscribe()

  // 8) 桌面端中途掉线：挂起的调用立即失败，不能干等到超时
  const hangPromise = bridge.listSessions(5)
  await sleep(150)
  desktopA.socket.terminate()
  desktopB.socket.terminate()
  let hangError = null
  try {
    await hangPromise
  } catch (error) {
    hangError = error
  }
  check('桌面端掉线时挂起调用立即失败', hangError != null, hangError?.message ?? '(没有失败)')

  hub.dispose()
  rmSync(outDir, { recursive: true, force: true })

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) {
    console.log('\n失败项：')
    for (const item of failed) console.log(`  - ${item.name}`)
  }
  // 中继客户端内部有心跳/重连定时器，等它们自然退出会一直挂着 → 显式收尾
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('\nsmoke crashed:', error)
  process.exit(1)
})
