#!/usr/bin/env node
/**
 * 请求层冒烟测试（不依赖测试框架，node 直接跑）：
 *   1. 登录成功 → token 落 storage
 *   2. 业务 code !== 0 → 以 message 抛错
 *   3. 401 → refresh 成功 → 自动重试原请求
 *   4. 401 → refresh 失败 → 清会话 + 触发 session-expired
 *
 * 运行：node scripts/smoke-api.mjs（需先 node scripts/build.mjs）
 */

import { createServer } from 'node:http'
import http from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const require = createRequire(import.meta.url)

// ─── wx 全局桩 ────────────────────────────────────────────────────────────────

const storage = new Map()
let expiredHandlerCalled = false
const requestLog = []

global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  showLoading: () => {},
  hideLoading: () => {},
  reLaunch: () => {},
  showToast: () => {},
  getFileSystemManager: () => ({ writeFile: () => {} }),
  uploadFile: () => {},
  request: ({ url, method, header, data, success, fail }) => {
    requestLog.push({ url, method, auth: header.Authorization })
    const parsed = new URL(url)
    const req = createRequest(parsed, method, header, data, success, fail)
    req.end?.()
  },
}

function createRequest(parsed, method, header, data, success, fail) {
  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname,
    method,
    headers: { 'Content-Type': 'application/json', ...header },
  }
  const client = http.request(options, (res) => {
    let body = ''
    res.on('data', (chunk) => (body += chunk))
    res.on('end', () => {
      success({ statusCode: res.statusCode, data: body ? JSON.parse(body) : null })
    })
  })
  client.on('error', (err) => fail({ errMsg: err.message }))
  if (data) client.write(JSON.stringify(data))
  return client
}

// ─── mock edu-server ──────────────────────────────────────────────────────────

let refreshShouldFail = false

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const payload = body ? JSON.parse(body) : {}
    const json = (code, data, message) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code, message, data }))
    }

    if (req.url === '/api/v1/auth/login' && req.method === 'POST') {
      if (payload.password === 'wrong') return json(1, null, '账号或密码错误')
      return json(0, { token: 'tok-1', refreshToken: 'rt-1', userId: '42' })
    }
    if (req.url === '/api/v1/auth/refresh' && req.method === 'POST') {
      if (refreshShouldFail) return json(1, null, 'refresh 已失效')
      return json(0, { token: 'tok-2', refreshToken: 'rt-2', userId: '42' })
    }
    if (req.url === '/api/v1/me' && req.method === 'GET') {
      if (req.headers.authorization === 'Bearer expired') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ code: 401, message: 'unauthorized' }))
      }
      return json(0, { id: 42, account: 'a@b.com', nickname: '测试', role: 'user' })
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ code: 404, message: 'not found' }))
  })
})

// ─── 用例 ─────────────────────────────────────────────────────────────────────

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  const requestModule = require(join(dist, 'api/request.js'))
  const authModule = require(join(dist, 'api/auth.js'))
  const storeModule = require(join(dist, 'store/auth.js'))

  // dist/config.js 里内联的是默认 baseUrl，冒烟测试改指 mock 服务端
  const configModule = require(join(dist, 'config.js'))
  configModule.getConfig = () => ({ baseUrl: `http://127.0.0.1:${port}`, apiPrefix: '/api/v1' })

  requestModule.setSessionExpiredHandler(() => {
    expiredHandlerCalled = true
  })

  // 1. 登录成功
  const session = await authModule.login({
    account: 'a@b.com',
    loginMode: 'password',
    password: 'ok',
  })
  check('登录成功返回 session', session?.token === 'tok-1')

  // 1b. store.loginWithSession 持久化 token 并加载用户
  const user = await storeModule.loginWithSession(session)
  check('token 已持久化', storage.get('spark-mobile:token') === 'tok-1')
  check('refreshToken 已持久化', storage.get('spark-mobile:refresh-token') === 'rt-1')
  check('用户信息已加载', user?.id === 42)

  // 2. 业务错误抛 message
  let bizError = null
  try {
    await authModule.login({ account: 'a@b.com', loginMode: 'password', password: 'wrong' })
  } catch (error) {
    bizError = error
  }
  check('业务错误透传 message', bizError?.message === '账号或密码错误', bizError?.message)

  // 3. 401 → refresh → 重试
  storage.set('spark-mobile:token', 'expired')
  storage.set('spark-mobile:refresh-token', 'rt-1')
  const me = await authModule.getMe()
  check('401 后刷新并重试成功', me?.id === 42 && storage.get('spark-mobile:token') === 'tok-2')
  check(
    '重试用了新 token',
    requestLog.some((r) => r.auth === 'Bearer tok-2'),
  )

  // 4. 401 → refresh 失败 → 清会话 + 回调
  refreshShouldFail = true
  storage.set('spark-mobile:token', 'expired')
  storage.set('spark-mobile:refresh-token', 'rt-1')
  let expiredError = null
  try {
    await authModule.getMe()
  } catch (error) {
    expiredError = error
  }
  check('刷新失败抛出登录过期', expiredError?.message === '登录已过期，请重新登录')
  check('会话已清理', storage.get('spark-mobile:token') === undefined)
  check('session-expired 回调已触发', expiredHandlerCalled === true)

  server.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('smoke test crashed:', error)
  server.close()
  process.exit(1)
})
