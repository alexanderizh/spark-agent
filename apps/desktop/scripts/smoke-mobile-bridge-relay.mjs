#!/usr/bin/env node
/**
 * 桌面端中继客户端冒烟（不依赖 Electron）。
 *
 * 把真实的 MobileBridgeRelayClient 接到真实的 edu-server RelayHub 上跑一遍：
 *   建连 → 首帧 auth（deviceSecret 不走 URL query）→ welcome → hello →
 *   收到 req 并应答 → 订阅事件并推送 → 桌面端掉线后自动重连 → 停止后不再重连。
 *
 * 服务端用的是 edu-server 生产同款首帧认证门（gateDesktopAuth + 真实
 * BridgeDeviceTrustService + 内存 repo），验证「客户端 ↔ 认证门 ↔ hub」全链路。
 *
 * 这里用的是 Node 22 的全局 WebSocket（Electron 43 同样是 Node 22，行为一致）。
 *
 * 运行：node scripts/smoke-mobile-bridge-relay.mjs
 */

import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')
const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, '..')
const repoRoot = resolve(desktopDir, '..', '..')
const eduServer =
  process.env.SPARK_EDUGEN_DIR?.trim() || resolve(repoRoot, '..', 'spark-edugen', 'edu-server')
// 编译产物放在 edu-server 项目内（而非系统临时目录）：device-trust 依赖
// @midwayjs/core / typeorm，需要向上解析 edu-server 的 node_modules。
// 目录已被 edu-server/scripts/.gitignore 覆盖，不会污染其工作树。
const outDir = join(eduServer, 'scripts', '.relay-smoke-build-desktop')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── 编译：edu-server 真实 RelayHub + 认证门 + 桌面端真实 RelayClient ─────────

rmSync(outDir, { recursive: true, force: true })
console.log('编译 edu-server relay-hub + device-trust + desktop-handshake …')
execFileSync(
  join(eduServer, 'node_modules', '.bin', 'tsc'),
  [
    join(eduServer, 'src/service/mobile-bridge/relay-hub.ts'),
    join(eduServer, 'src/service/mobile-bridge/device-trust.service.ts'),
    join(eduServer, 'src/service/mobile-bridge/desktop-handshake.ts'),
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
    '--experimentalDecorators',
    '--emitDecoratorMetadata',
  ],
  { cwd: eduServer, stdio: 'pipe' },
)
const mobileBridgeDir = join(outDir, 'service', 'mobile-bridge')
const { RelayHub } = require(join(mobileBridgeDir, 'relay-hub.js'))
const { BridgeDeviceTrustService } = require(join(mobileBridgeDir, 'device-trust.service.js'))
const { gateDesktopAuth } = require(join(mobileBridgeDir, 'desktop-handshake.js'))

/** 内存版设备信任 repo（与 edu-server smoke-relay 同款，覆盖 find/count/save） */
function mockDeviceRepo() {
  const rows = new Map()
  let nextId = 1
  return {
    async findOne({ where }) {
      return rows.get(`${where.userId}:${where.deviceId}`) ?? null
    },
    async find({ where }) {
      return [...rows.values()].filter((r) => r.userId === where.userId)
    },
    async count({ where }) {
      let n = 0
      for (const r of rows.values()) {
        if (r.userId !== where.userId) continue
        if (where.status != null && r.status !== where.status) continue
        n += 1
      }
      return n
    },
    create(data) {
      return { ...data }
    },
    async save(entity) {
      for (const [key, row] of rows) {
        if (row.id === entity.id) {
          const merged = { ...row, ...entity, updatedAt: new Date() }
          rows.set(key, merged)
          return merged
        }
      }
      const row = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...entity }
      rows.set(`${row.userId}:${row.deviceId}`, row)
      return row
    },
  }
}

console.log('打包 MobileBridgeRelayClient.ts …')
const clientBundle = join(outDir, 'relay-client.cjs')
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(desktopDir, 'src/main/services/MobileBridgeRelayClient.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:@spark/shared',
    '--external:@spark/protocol',
    '--log-level=warning',
    `--outfile=${clientBundle}`,
  ],
  { cwd: desktopDir, stdio: 'inherit' },
)

// ─── 运行时桩：@spark/shared 只要 createLogger ────────────────────────────────

const Module = require('node:module')
const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === '@spark/shared') {
    const noop = () => {}
    return { createLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) }
  }
  return originalLoad.call(this, request, ...rest)
}

const { MobileBridgeRelayClient } = require(clientBundle)

async function main() {
  console.log('\n—— 桌面端中继客户端 ——\n')

  const hub = new RelayHub(null)
  // 真实设备信任服务（内存 repo）：与生产同一验证代码路径
  const deviceRepo = mockDeviceRepo()
  const deviceTrust = new BridgeDeviceTrustService()
  deviceTrust.dataSource = { getRepository: () => deviceRepo }
  const server = createServer((_req, res) => {
    res.writeHead(200)
    res.end('{}')
  })
  const wss = new WebSocket.Server({ noServer: true })

  /** 服务端侧收到的桌面端帧（观察用） */
  const desktopFrames = []
  let desktopSocket = null
  /** 每次桌面端 upgrade 的完整 URL（断言 query 不含 secret 用） */
  const desktopUpgradeUrls = []

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', 'http://localhost')
    const m = /^\/ws\/bridge\/(desktop|client)$/.exec(url.pathname)
    if (!m) {
      socket.destroy()
      return
    }
    const userId = url.searchParams.get('userId') || 'u1'
    wss.handleUpgrade(req, socket, head, (ws) => {
      const meta = {
        deviceId: url.searchParams.get('deviceId') ?? undefined,
        label: url.searchParams.get('label') ?? undefined,
        version: url.searchParams.get('version') ?? undefined,
      }
      if (m[1] === 'client') {
        hub.attach('client', userId, ws, meta)
        return
      }
      // 桌面端：与生产 configuration.ts 一致的首帧认证门，
      // 验证通过才 attach 进 hub（未认证连接不进广播、不收业务帧）。
      desktopUpgradeUrls.push(req.url)
      desktopSocket = ws
      ws.on('message', (raw) => {
        try {
          desktopFrames.push(JSON.parse(raw.toString('utf8')))
        } catch {
          /* ignore */
        }
      })
      const numericUserId = Number(userId.replace(/\D+/g, '')) || 1
      gateDesktopAuth({
        trust: deviceTrust,
        userId: numericUserId,
        ws,
        meta,
        onVerified: (finalMeta) => hub.attach('desktop', userId, ws, finalMeta),
      })
    })
  })

  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  // ─── 桌面端客户端 ──────────────────────────────────────────────────────────

  const invokeCalls = []
  const pushedEvents = []
  let relaySettings = { enabled: true, baseUrl: `http://127.0.0.1:${port}` }
  let accessToken = 'jwt-abc'
  let subscribeCount = 0

  const clientDeps = {
    getSettings: () => relaySettings,
    getDefaultBaseUrl: () => `http://127.0.0.1:${port}`,
    getAccessToken: async () => accessToken,
    getDeviceId: () => 'mac-01',
    getDeviceSecret: () => 'test-secret-hex',
    getDeviceLabel: () => 'MacBook',
    getVersion: () => '1.2.3',
    invoke: async (method, path, body) => {
      invokeCalls.push({ method, path, body })
      if (path === '/v1/health') return { status: 200, body: { ok: true, running: true } }
      if (path.startsWith('/v1/sessions') && method === 'GET') {
        return { status: 200, body: { sessions: [{ id: 's1' }], total: 1 } }
      }
      if (path === '/v1/boom') throw new Error('桌面端内部错误')
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no route' } } }
    },
    subscribe: (sessionId, sendEvents) => {
      subscribeCount += 1
      pushedEvents.push({ sessionId, sendEvents })
      return () => {}
    },
  }
  const client = new MobileBridgeRelayClient(clientDeps)

  // 1) 未登录时不建连
  accessToken = null
  await client.start()
  await sleep(200)
  check(
    '未登录时不建连',
    client.getStatus().connected === false,
    JSON.stringify(client.getStatus()),
  )
  check(
    '未登录给出明确原因',
    /未登录/.test(client.getStatus().lastError ?? ''),
    client.getStatus().lastError ?? '',
  )

  // 2) 登录后自动连上（退避重连会自己捞起来）
  accessToken = 'jwt-abc'
  await client.restart()
  await sleep(600)
  check('登录后连上中继', client.getStatus().connected === true, JSON.stringify(client.getStatus()))
  check(
    '服务端拿到 connId',
    client.getStatus().connectionId != null,
    String(client.getStatus().connectionId),
  )
  check(
    '握手带上设备信息',
    desktopFrames.some((f) => f.t === 'hello' && f.deviceId === 'mac-01' && f.version === '1.2.3'),
    JSON.stringify(desktopFrames.slice(0, 2)),
  )
  const presence = await hub.presence('u1')
  check(
    '服务端登记桌面端在线',
    presence.online === true && presence.deviceId === 'mac-01',
    JSON.stringify(presence),
  )
  check(
    '握手 URL 不含 secret（凭据不落 nginx 日志回归）',
    desktopUpgradeUrls.length > 0 && desktopUpgradeUrls.every((u) => !/[?&]secret=/.test(u)),
    JSON.stringify(desktopUpgradeUrls.at(-1)),
  )
  check(
    '首帧为 auth 且携带设备凭据',
    desktopFrames[0]?.t === 'auth' &&
      desktopFrames[0]?.deviceId === 'mac-01' &&
      desktopFrames[0]?.secret === 'test-secret-hex',
    JSON.stringify(desktopFrames[0]),
  )
  check(
    '业务帧在 auth 之后（hello 等 welcome 才发）',
    desktopFrames[1]?.t === 'hello',
    JSON.stringify(desktopFrames.slice(0, 2)),
  )

  // 2.5) 密钥错误 → 服务端 close 4401，客户端感知「身份被拒」并停止自动重连
  clientDeps.getDeviceSecret = () => 'wrong-secret'
  await client.restart()
  await sleep(700)
  const badSecretStatus = client.getStatus()
  check('错误密钥被拒后断开', badSecretStatus.connected === false, JSON.stringify(badSecretStatus))
  check(
    '错误密钥给出 4401 提示',
    /4401/.test(badSecretStatus.lastError ?? ''),
    badSecretStatus.lastError ?? '',
  )
  await sleep(1500) // 超过一个退避周期，验证确实不再自动重连
  check(
    '密钥被拒后不自动重连',
    client.getStatus().connected === false && hub.stats().desktops === 0,
    JSON.stringify(hub.stats()),
  )
  // 恢复正确密钥并重新授信（resetIdentity 解锁身份拒绝标志）
  clientDeps.getDeviceSecret = () => 'test-secret-hex'
  await client.resetIdentity()
  await sleep(700)
  check(
    '恢复密钥后重新连上',
    client.getStatus().connected === true,
    JSON.stringify(client.getStatus()),
  )

  // 3) 服务端发起调用 → 客户端应答
  const result = await hub.call('u1', 'GET', '/v1/sessions?limit=20', null, 5000)
  check(
    '客户端应答了服务端调用',
    result.status === 200 && result.body?.total === 1,
    JSON.stringify(result),
  )
  check(
    '调用参数原样送达',
    invokeCalls.some((c) => c.method === 'GET' && c.path === '/v1/sessions?limit=20'),
    JSON.stringify(invokeCalls.at(-1)),
  )

  // 4) 处理器抛异常 → 转成 500 而不是挂住
  const boom = await hub.call('u1', 'POST', '/v1/boom', {}, 5000)
  check('处理器抛异常转成 500', boom.status === 500, JSON.stringify(boom))
  check('500 带错误体', boom.body?.error?.message === '桌面端内部错误', JSON.stringify(boom.body))

  // 5) 订阅事件 → 客户端把事件推给服务端
  hub.sendToDesktopSubForTest = null
  // 直接构造一条 client 连接来发 sub（模拟小程序）
  const clientWs = new WebSocket(`ws://127.0.0.1:${port}/ws/bridge/client?userId=u1&deviceId=mp-01`)
  await new Promise((r, j) => {
    clientWs.on('open', r)
    clientWs.on('error', j)
  })
  const clientFrames = []
  clientWs.on('message', (raw) => clientFrames.push(JSON.parse(raw.toString('utf8'))))
  clientWs.send(JSON.stringify({ t: 'sub', sessionId: 'sess-9' }))
  await sleep(200)
  check(
    '桌面端收到订阅',
    subscribeCount === 1 && pushedEvents[0]?.sessionId === 'sess-9',
    String(subscribeCount),
  )
  // 回归：同一账号只能有一条桌面端连接，否则订阅/调用会被重复下发
  const stats = hub.stats()
  check('服务端只看到一条桌面端连接', stats.desktops === 1, JSON.stringify(stats))

  pushedEvents[0]?.sendEvents([{ seq: 1, content: '你好' }])
  await sleep(200)
  check(
    '事件经中继推给小程序',
    clientFrames.some((f) => f.t === 'event' && f.events?.[0]?.content === '你好'),
    JSON.stringify(clientFrames.filter((f) => f.t === 'event')),
  )

  // 6) 服务端踢掉连接 → 客户端自动重连（并恢复订阅）
  desktopSocket?.terminate()
  await sleep(1500)
  check('断开后自动重连', client.getStatus().connected === true, JSON.stringify(client.getStatus()))
  check('重连后恢复订阅', subscribeCount >= 2, `subscribeCount=${subscribeCount}`)

  // 7) 关闭开关 → 主动断开且不再重连
  relaySettings = { enabled: false, baseUrl: `http://127.0.0.1:${port}` }
  await client.restart()
  await sleep(400)
  check(
    '关闭后不再连接',
    client.getStatus().connected === false,
    JSON.stringify(client.getStatus()),
  )

  // 8) stop() 后彻底清理
  relaySettings = { enabled: true, baseUrl: `http://127.0.0.1:${port}` }
  await client.restart()
  await sleep(500)
  check('重新开启后连上', client.getStatus().connected === true)
  client.stop()
  await sleep(1500)
  check(
    'stop() 后不再重连',
    client.getStatus().connected === false,
    JSON.stringify(client.getStatus()),
  )

  // 9) 设备被吊销（close 4403）→ 停止自动重连 + 状态可感知 + 重新授信恢复
  await client.start()
  await sleep(600)
  check('重新启动后连上（为吊销做准备）', client.getStatus().connected === true)

  hub.kickDevice('mac-01', 'device revoked')
  await sleep(1200)
  const revokedStatus = client.getStatus()
  check('被吊销后断开', revokedStatus.connected === false, JSON.stringify(revokedStatus))
  check('revoked 标志置位', revokedStatus.revoked === true, String(revokedStatus.revoked))
  check(
    '给出吊销原因提示',
    /吊销/.test(revokedStatus.lastError ?? ''),
    revokedStatus.lastError ?? '',
  )
  await sleep(2000) // 超过一个退避周期，验证确实不再自动重连
  check(
    '吊销后不再自动重连',
    client.getStatus().connected === false && hub.stats().desktops === 0,
    JSON.stringify(hub.stats()),
  )

  // 重新授信：装配层会换新身份（这里以新 deviceId 模拟），resetIdentity 后应恢复
  clientDeps.getDeviceId = () => 'mac-01-new'
  clientDeps.getDeviceSecret = () => 'fresh-secret'
  await client.resetIdentity()
  await sleep(800)
  const reStatus = client.getStatus()
  check('重新授信后恢复连接', reStatus.connected === true, JSON.stringify(reStatus))
  check('revoked 标志清除', reStatus.revoked === false)
  check('状态里暴露新设备号', reStatus.deviceId === 'mac-01-new', String(reStatus.deviceId))

  clientWs.close()
  hub.dispose()
  await new Promise((r) => server.close(r))
  rmSync(outDir, { recursive: true, force: true })

  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) {
    console.log('\n失败项：')
    for (const item of failed) console.log(`  - ${item.name}`)
  }
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('\nsmoke crashed:', error)
  process.exit(1)
})
