#!/usr/bin/env node
/**
 * 云端中继端到端冒烟（小程序侧）。
 *
 * 不是「协议对不对」的单元测试，而是把三样真东西接起来跑一遍：
 *   小程序 api/bridge.ts + api/relay.ts（真实源码）
 *     ↔ edu-server src/service/mobile-bridge/relay-hub.ts（真实中继实现）
 *       ↔ 一个假桌面端（脚本扮演，按桌面端协议回 res / 推 event）
 *
 * 覆盖：握手、调用转发与应答、503 离线提示、事件订阅与广播、
 *       关闭中继后回落局域网直连、断线时挂起调用立即失败。
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
const httpCalls = []

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
    let openFired = false

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
      openFired = true
      for (const cb of handlers.open) cb({})
    }, 0)
    void openFired
    void parsed
    return task
  },
  /** 直连回落的 HTTP 桩：记录调用，返回固定的健康响应 */
  request: ({ url, method, success }) => {
    httpCalls.push({ url, method })
    setTimeout(() => success({ statusCode: 200, data: { ok: true, running: true } }), 0)
  },
}

const bridge = require(bridgeBundle)

// ─── 5. 扮演桌面端：按协议回 res / 推 event ──────────────────────────────────

function attachDesktop() {
  const socket = new FakeSocket()
  const inbox = []
  socket.on('out', (data) => inbox.push(JSON.parse(data)))
  hub.attach('desktop', USER_ID, socket, { deviceId: 'mac-01', label: 'MacBook', version: '1.2.3' })
  return {
    socket,
    inbox,
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

function main() {
  console.log('\n—— 云端中继端到端 ——\n')

  storage.set('spark-mobile:token', 'fake-jwt')

  // 1) 默认开启中继
  check('默认启用云端中继', bridge.isRelayEnabled() === true)
  check('中继模式下 isReady 只看登录态', bridge.isReady() === true)

  const desktop = attachDesktop()

  // 2) 一次真实调用：bridge.listSessions → WS → hub → 桌面端 → 原路返回
  bridge
    .listSessions(50)
    .then((result) => {
      check(
        '经中继拉到会话列表',
        Array.isArray(result.sessions) && result.sessions[0]?.id === 's1',
        JSON.stringify(result).slice(0, 90),
      )
    })
    .catch((error) => check('经中继拉到会话列表', false, error.message))

  const req = desktop.waitFor((f) => f.t === 'req')
  return req.then(async (frame) => {
    check('桌面端收到 req 帧', frame != null)
    check('req 保留 path 与 query', frame?.p === '/v1/sessions?limit=50', String(frame?.p))
    check('req 保留 method', frame?.m === 'GET', String(frame?.m))

    desktop.socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          t: 'res',
          id: frame.id,
          s: 200,
          b: { sessions: [{ id: 's1', title: '测试会话' }], total: 1 },
        }),
      ),
    )
    await sleep(80)

    // 3) 新建会话走 POST + body 透传
    const createPromise = bridge.createSession('中继新建')
    const createFrame = await desktop.waitFor((f) => f.t === 'req' && f.m === 'POST')
    check('新建会话 method=POST', createFrame?.m === 'POST', String(createFrame?.m))
    check(
      '新建会话 body 透传',
      createFrame?.b?.title === '中继新建',
      JSON.stringify(createFrame?.b),
    )
    desktop.socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          t: 'res',
          id: createFrame.id,
          s: 200,
          b: { session: { id: 's-new' } },
        }),
      ),
    )
    const created = await createPromise
    check('新建会话返回体透传', created.session?.id === 's-new', JSON.stringify(created))

    // 4) 桌面端离线：503 DESKTOP_OFFLINE 要变成可读的中文原因
    desktop.socket.terminate()
    await sleep(120)
    let offlineError = null
    try {
      await bridge.listSessions(10)
    } catch (error) {
      offlineError = error
    }
    check('桌面端离线时抛错', offlineError != null)
    check(
      '离线错误原因是 OFFLINE',
      offlineError?.reason === 'OFFLINE',
      `${offlineError?.reason} / ${offlineError?.message}`,
    )
    check(
      '离线提示给出可执行动作',
      /云端中继/.test(offlineError?.hint ?? ''),
      offlineError?.hint ?? '',
    )

    // 5) 事件订阅与广播
    const desktop2 = attachDesktop()
    const events = []
    const unsubscribe = bridge.connectStream('sess-1', {
      onEvent: (list) => events.push(...list),
      onError: () => {},
      onClose: () => {},
    })
    await sleep(150)
    const subFrame = await desktop2.waitFor((f) => f.t === 'sub')
    check('桌面端收到订阅指令', subFrame?.sessionId === 'sess-1', JSON.stringify(subFrame))
    desktop2.socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          t: 'event',
          sessionId: 'sess-1',
          events: [{ seq: 1, content: '你好' }],
        }),
      ),
    )
    await sleep(120)
    check(
      '小程序收到事件广播',
      events.length === 1 && events[0]?.content === '你好',
      JSON.stringify(events),
    )
    unsubscribe()

    // 6) 桌面端中途掉线：挂起的调用立即失败，不能干等超时
    const hangPromise = bridge.listSessions(5)
    await sleep(150)
    desktop2.socket.terminate()
    let hangError = null
    try {
      await hangPromise
    } catch (error) {
      hangError = error
    }
    check('桌面端掉线时挂起调用立即失败', hangError != null, hangError?.message ?? '(没有失败)')

    // 7) 关闭中继 → 回落局域网直连（走 wx.request）
    bridge.setServerUrl('http://192.168.1.5:3721')
    bridge.setRelayEnabled(false)
    check('关闭后 isRelayEnabled=false', bridge.isRelayEnabled() === false)
    httpCalls.length = 0
    const pingOk = await bridge.ping()
    check(
      '关闭中继后回落直连 HTTP',
      pingOk === true && httpCalls.length === 1,
      JSON.stringify(httpCalls),
    )

    // 8) 重新开启中继：不再走 HTTP
    bridge.setRelayEnabled(true)
    const desktop3 = attachDesktop()
    httpCalls.length = 0
    bridge.ping().then(() => {
      check('重开中继后不再走直连 HTTP', httpCalls.length === 0, JSON.stringify(httpCalls))
    })
    await sleep(150)
    const healthFrame = await desktop3.waitFor((f) => f.t === 'req' && f.p === '/v1/health')
    check('健康检查经中继到达桌面端', healthFrame != null)
    desktop3.socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          t: 'res',
          id: healthFrame?.id,
          s: 200,
          b: { ok: true, running: true },
        }),
      ),
    )
    await sleep(120)

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
  })
}

main().catch((error) => {
  console.error('\nsmoke crashed:', error)
  process.exit(1)
})
