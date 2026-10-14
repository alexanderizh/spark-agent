#!/usr/bin/env node
/**
 * 云端中继 · 生产环境端到端验证。
 *
 * 与 smoke-relay.mjs（本地 RelayHub）不同，这里连的是真实公网链路：
 *   本脚本(双端扮演) ──wss──> 1Panel openresty → edu-web nginx → edu-server RelayHub
 *
 * 覆盖：HTTPS 健康、WSS 无 token 拒绝、desktop 首帧认证（非 auth 首帧 4400、
 *       auth 通过 welcome、吊销身份 4403）、presence 上下线、
 *       req/res 调用转发、sub/event 事件订阅广播。
 *
 * 运行：
 *   node scripts/e2e-relay-prod.mjs                # 默认 wss://www.yiqibyte.com
 *   RELAY_URL=wss://xxx TOKEN=yyy node scripts/e2e-relay-prod.mjs
 *
 * TOKEN 在服务器容器内签发（JWT_SECRET 不出服务器）：
 *   sudo docker exec prod-edu-server node -e "require('jsonwebtoken').sign(...)"
 */

const RELAY_URL = process.env.RELAY_URL || 'wss://www.yiqibyte.com'
const TOKEN = process.env.TOKEN || ''
const HTTP_BASE = RELAY_URL.replace(/^wss/, 'https')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Peer {
  constructor(role, deviceId) {
    this.role = role
    this.deviceId = deviceId
    this.inbox = []
    this.ws = null
  }
  connect(query = '') {
    return new Promise((resolve, reject) => {
      const url = `${RELAY_URL}/ws/bridge/${this.role}?token=${encodeURIComponent(TOKEN)}${query}`
      const ws = new WebSocket(url)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('连接超时(8s)'))
      }, 8000)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        this.ws = ws
        ws.addEventListener('message', (ev) => this.inbox.push(JSON.parse(String(ev.data))))
        resolve(this)
      })
      ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('连接被拒绝'))
      })
      ws.addEventListener('close', () => this.ws?._markClosed?.())
    })
  }
  send(frame) {
    this.ws.send(JSON.stringify(frame))
  }
  async waitFor(predicate, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = this.inbox.find(predicate)
      if (hit) return hit
      await sleep(30)
    }
    return null
  }
  close() {
    this.ws?.close()
  }
}

async function main() {
  console.log(`\n—— 云端中继生产链路验证：${RELAY_URL} ——\n`)
  let failed = false

  // 1) HTTPS 基础健康（openresty → edu-web → edu-server 全链通）
  try {
    const res = await fetch(`${HTTP_BASE}/api/v1/auth/captcha`)
    const body = await res.json().catch(() => ({}))
    check('HTTPS 公开接口可达', res.status === 200 && body.code === 0, `HTTP ${res.status}`)
  } catch (e) {
    check('HTTPS 公开接口可达', false, e.message)
  }

  // 2) WSS 无 token 必须无法建立连接（鉴权守卫：服务端 jwt.verify 失败即 socket.destroy）
  //    判定语义：只要握手失败（error/close/静默断开）都算「已拒绝」；
  //    只有 open 触发（连接真的建立）才是鉴权缺失。
  //    注：Node undici WS 对握手期连接重置可能不触发任何事件 → 超时未 open 也算通过。
  await new Promise((resolve) => {
    const ws = new WebSocket(`${RELAY_URL}/ws/bridge/client`)
    const timer = setTimeout(() => {
      check('WSS 无 token 无法建立连接', true, '8s 内握手未完成（已拒绝）')
      ws.close()
      resolve()
    }, 8000)
    ws.addEventListener('error', () => {})
    ws.addEventListener('close', () => {
      clearTimeout(timer)
      check('WSS 无 token 无法建立连接', true, '握手被拒')
      resolve()
    })
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      check('WSS 无 token 无法建立连接', false, '竟然握手成功了！')
      ws.close()
      resolve()
    })
  })
  if (results.some((r) => !r.ok)) failed = true

  if (!TOKEN) {
    console.log('\n⚠ 未提供 TOKEN，跳过双端用例（仅完成上面的无凭据检查）')
    process.exit(failed ? 1 : 0)
  }

  // 2.5) desktop 通道首帧必须是 auth（首帧认证协议：JWT 有效时 WS 可建立，
  //      但首帧非 auth 会被认证门立即 close 4400，不进中继 hub）
  await new Promise((resolve) => {
    const ws = new WebSocket(`${RELAY_URL}/ws/bridge/desktop?token=${TOKEN}&deviceId=e2e-badauth`)
    const timer = setTimeout(() => {
      check('desktop 首帧非 auth 被拒（4400）', false, '超时未 close')
      ws.close()
      resolve()
    }, 8000)
    ws.addEventListener('error', () => {})
    ws.addEventListener('close', (event) => {
      clearTimeout(timer)
      check(
        'desktop 首帧非 auth 被拒（4400）',
        Number(event?.code) === 4400,
        `close code=${event?.code}`,
      )
      resolve()
    })
    ws.addEventListener('open', () => {
      // WS 已建立（JWT 有效），故意把 hello 当首帧发出 → 认证门应 4400 拒绝
      ws.send(JSON.stringify({ t: 'hello', deviceId: 'e2e-badauth' }))
    })
  })

  // 3) 桌面端连接（临时设备身份，首次连接即授信）：
  //    首帧认证协议 —— query 只带 token+deviceId，open 后先发 auth 帧，
  //    服务端验证 deviceSecret 通过后回 welcome 并注册进 hub，之后才发业务帧
  const e2eDeviceId = `e2e-${crypto.randomUUID().slice(0, 12)}`
  const e2eSecret = crypto.randomUUID().replace(/-/g, '')
  const desktop = new Peer('desktop', e2eDeviceId)
  try {
    await desktop.connect(`&deviceId=${e2eDeviceId}`)
    check('桌面端 WSS 握手成功（query 无 secret）', true)
  } catch (e) {
    check('桌面端 WSS 握手成功（query 无 secret）', false, e.message)
  }
  desktop.send({
    t: 'auth',
    deviceId: e2eDeviceId,
    secret: e2eSecret,
    label: 'E2E测试桌面端',
    version: '0.0.0',
  })
  const welcomeD = await desktop.waitFor((f) => f.t === 'welcome')
  check(
    '桌面端首帧认证通过并收到 welcome',
    welcomeD != null,
    welcomeD ? `connId=${welcomeD.connId.slice(0, 8)}…` : '',
  )
  desktop.send({ t: 'hello', deviceId: e2eDeviceId, label: 'E2E测试桌面端', version: '0.0.0' })

  // 4) 小程序端连接：welcome 应报告桌面端在线
  const client = new Peer('client', 'e2e-mp-01')
  try {
    await client.connect()
    check('小程序端 WSS 握手成功', true)
  } catch (e) {
    check('小程序端 WSS 握手成功', false, e.message)
  }
  client.send({ t: 'hello', deviceId: 'e2e-mp-01', label: 'E2E小程序' })
  const welcomeC = await client.waitFor((f) => f.t === 'welcome')
  check('小程序端收到 welcome', welcomeC != null)
  check(
    'welcome 报告桌面端在线',
    welcomeC?.desktop?.online === true,
    JSON.stringify(welcomeC?.desktop ?? null),
  )

  // 5) 调用转发：client 发 req → desktop 收到 → 回 res → client 收到
  //    （req.id 由服务端生成；回程 res 才映射回客户端原始 id 'e2e-r1'）
  client.send({ t: 'req', id: 'e2e-r1', m: 'GET', p: '/v1/health' })
  const reqFrame = await desktop.waitFor((f) => f.t === 'req' && f.p === '/v1/health')
  check('桌面端收到调用转发 req', reqFrame != null, reqFrame ? `${reqFrame.m} ${reqFrame.p}` : '')
  check('req 保留 method/path', reqFrame?.m === 'GET' && reqFrame?.p === '/v1/health')
  check(
    'req id 由服务端生成（不透传客户端 id）',
    reqFrame != null && reqFrame.id !== 'e2e-r1',
    String(reqFrame?.id),
  )
  if (reqFrame) {
    desktop.send({ t: 'res', id: reqFrame.id, s: 200, b: { ok: true, running: true } })
    const resFrame = await client.waitFor((f) => f.t === 'res' && f.id === 'e2e-r1')
    check(
      '小程序端收到 res 应答',
      resFrame?.s === 200 && resFrame?.b?.ok === true,
      JSON.stringify(resFrame?.b ?? null),
    )
  }

  // 6) 事件订阅：client sub → desktop 收到 → desktop 推 event → client 收到
  client.send({ t: 'sub', sessionId: 'e2e-sess-1' })
  const subFrame = await desktop.waitFor((f) => f.t === 'sub')
  check(
    '桌面端收到订阅指令 sub',
    subFrame?.sessionId === 'e2e-sess-1',
    JSON.stringify(subFrame ?? null),
  )
  desktop.send({ t: 'event', sessionId: 'e2e-sess-1', events: [{ seq: 42, content: 'e2e 你好' }] })
  const eventFrame = await client.waitFor((f) => f.t === 'event' && f.sessionId === 'e2e-sess-1')
  check(
    '小程序端收到事件广播 event',
    eventFrame?.events?.[0]?.content === 'e2e 你好',
    JSON.stringify(eventFrame?.events ?? null),
  )

  // 7) 桌面端下线 → 小程序端收到 presence
  desktop.close()
  const presence = await client.waitFor(
    (f) => f.t === 'presence' && f.desktop?.online === false,
    8000,
  )
  check('桌面端下线广播 presence', presence != null, presence ? 'offline 已送达' : '8s 未收到')

  // 8) 授信设备管理接口：列表可见 + 吊销 + 吊销后该设备永久拒绝（4403）
  try {
    const listRes = await fetch(`${HTTP_BASE}/api/v1/mobile-bridge/devices`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const listBody = await listRes.json().catch(() => ({}))
    const found = (listBody?.data?.devices ?? []).some((d) => d.deviceId === e2eDeviceId)
    check('设备列表包含 e2e 临时设备', listRes.status === 200 && found, `HTTP ${listRes.status}`)
  } catch (e) {
    check('设备列表包含 e2e 临时设备', false, e.message)
  }

  try {
    const revokeRes = await fetch(
      `${HTTP_BASE}/api/v1/mobile-bridge/devices/${e2eDeviceId}/revoke`,
      { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } },
    )
    const revokeBody = await revokeRes.json().catch(() => ({}))
    check(
      '吊销 e2e 临时设备成功',
      revokeRes.status === 200 && revokeBody?.code === 0,
      `HTTP ${revokeRes.status}`,
    )
  } catch (e) {
    check('吊销 e2e 临时设备成功', false, e.message)
  }

  // 吊销后同 deviceId 重连必须被 4403 拒绝（不可逆）。
  // 首帧认证协议：WS 可建立（JWT 有效），auth 帧带已吊销身份 → 认证门 close 4403
  await new Promise((resolve) => {
    const ws = new WebSocket(
      `${RELAY_URL}/ws/bridge/desktop?token=${TOKEN}&deviceId=${e2eDeviceId}`,
    )
    const timer = setTimeout(() => {
      check('吊销后重连被拒（4403）', false, '超时未 close')
      ws.close()
      resolve()
    }, 8000)
    ws.addEventListener('error', () => {})
    ws.addEventListener('close', (event) => {
      clearTimeout(timer)
      check('吊销后重连被拒（4403）', Number(event?.code) === 4403, `close code=${event?.code}`)
      resolve()
    })
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'auth', deviceId: e2eDeviceId, secret: e2eSecret }))
    })
  })

  client.close()

  const failures = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failures.length}/${results.length} 通过`)
  if (failures.length > 0) {
    console.log('\n失败项：')
    for (const item of failures) console.log(`  - ${item.name}`)
  }
  process.exit(failures.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('\ne2e crashed:', error)
  process.exit(1)
})
