#!/usr/bin/env node
/**
 * 启动冒烟：mock 小程序运行时，真实 require dist 下每个入口（app.js + 全部页面 js）。
 *
 * 目的：抓出「白屏」类问题 —— 模块加载期就抛错（循环依赖、未定义引用、缺产物文件等），
 * 这类错误在开发者工具里常表现为整页空白 + 控制台一行红字，不跑一遍很难定位。
 *
 * 用法：node scripts/smoke-boot.mjs（需先 build）
 */
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')

let pass = 0
let fail = 0
const failures = []

function assert(ok, name, extra = '') {
  if (ok) {
    pass += 1
    console.log(`✅ ${name}`)
  } else {
    fail += 1
    failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
    console.log(`❌ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

// ─── mock 小程序运行时 ────────────────────────────────────────────────────────
const noop = () => {}
const storage = new Map()
const wxMock = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  removeStorageSync: (k) => storage.delete(k),
  request: () => ({}),
  connectSocket: () => ({
    onOpen: noop,
    onMessage: noop,
    onClose: noop,
    onError: noop,
    send: noop,
    close: noop,
  }),
  showToast: noop,
  showModal: noop,
  navigateTo: noop,
  redirectTo: noop,
  reLaunch: noop,
  switchTab: noop,
  navigateBack: noop,
  setNavigationBarTitle: noop,
  getSystemInfoSync: () => ({ platform: 'devtools', windowWidth: 375 }),
  getFileSystemManager: () => ({ writeFile: noop, readFile: noop, unlink: noop }),
  env: { USER_DATA_PATH: '/tmp' },
}

/** 记录页面注册，便于断言「每个页面都成功调用了 Page()」 */
const registeredPages = new Map()
let appRegistered = false
const jsErrors = []

/** wx 调用记录：用于行为级断言（如「是否真的发起了 reLaunch」） */
const wxCalls = { reLaunch: [], switchTab: [], navigateTo: [], redirectTo: [] }

let currentEntry = ''

globalThis.wx = {
  ...wxMock,
  request: (options) => {
    // 异步回调一次「业务失败」，模拟离线/服务端拒绝，验证页面不会因未捕获异常崩溃
    setTimeout(() => {
      try {
        options?.success?.({ statusCode: 200, data: { code: 1, message: 'mock offline' } })
      } catch {
        /* 回调自身异常由调用方负责 */
      }
    }, 0)
    return { abort: noop }
  },
  reLaunch: (options) => {
    wxCalls.reLaunch.push(options?.url)
    options?.success?.({ errMsg: 'reLaunch:ok' })
  },
  switchTab: (options) => {
    wxCalls.switchTab.push(options?.url)
    options?.success?.({ errMsg: 'switchTab:ok' })
  },
  navigateTo: (options) => {
    wxCalls.navigateTo.push(options?.url)
    options?.success?.({ errMsg: 'navigateTo:ok' })
  },
  redirectTo: (options) => {
    wxCalls.redirectTo.push(options?.url)
    options?.success?.({ errMsg: 'redirectTo:ok' })
  },
}
globalThis.getApp = () => ({ globalData: { appName: 'SparkWork' } })
globalThis.App = () => {
  appRegistered = true
}
globalThis.Page = (options) => {
  registeredPages.set(currentEntry, options)
}
globalThis.Component = () => {}
globalThis.getCurrentPages = () => []

/**
 * 最小 Page 实例上下文。
 * 小程序运行时会把 Page(options) 上的**自定义方法**挂到页面实例（所以 wxml 的
 * bindtap="go" 与 ts 里的 this.go() 都能用），这里同样挂载，否则演练会误报
 * "this.xxx is not a function"。
 */
function makePageContext(options) {
  const data = { ...(options?.data ?? {}) }
  const ctx = {
    data,
    setData(patch) {
      Object.assign(data, patch)
    },
  }
  for (const [key, value] of Object.entries(options ?? {})) {
    if (typeof value === 'function') ctx[key] = value.bind(ctx)
  }
  return ctx
}

// ─── 逐个 require ────────────────────────────────────────────────────────────
async function loadEntry(relPath, label) {
  const abs = join(distDir, relPath)
  if (!existsSync(abs)) {
    assert(false, `${label} 产物存在`, relPath)
    return null
  }
  currentEntry = relPath
  try {
    await import(pathToFileURL(abs).href)
    return true
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    jsErrors.push(`${label}: ${msg}`)
    assert(false, `${label} 加载无异常`, error instanceof Error ? error.message : String(error))
    return null
  }
}

async function main() {
  if (!existsSync(distDir)) {
    console.error('dist/ 不存在，请先 node scripts/build.mjs')
    process.exit(1)
  }

  await loadEntry('app.js', 'app.js')
  assert(appRegistered === true, 'app.js 调用 App() 注册')

  const pages = JSON.parse(await readFile(join(distDir, 'app.json'), 'utf8')).pages ?? []
  for (const page of pages) {
    const ok = await loadEntry(`${page}.js`, `${page}.js`)
    if (ok === null) continue
    const options = registeredPages.get(`${page}.js`)
    assert(options != null && typeof options === 'object', `${page} 调用 Page() 注册`)
  }

  // 组件
  const componentsDir = join(distDir, 'components')
  if (existsSync(componentsDir)) {
    for (const name of await readdir(componentsDir)) {
      const file = join(componentsDir, name, 'index.js')
      if (existsSync(file)) {
        await loadEntry(`components/${name}/index.js`, `组件 ${name}`)
      }
    }
  }

  // ─── 阶段二：启动链路演练（行为级，而非只验证 import 成功） ────────────────
  // 真实调用 entry.onLoad / login.onLoad / home.onShow，断言它们按预期跳转且不抛错。
  console.log('\n—— 启动链路演练 ——')

  const entryOptions = registeredPages.get('pages/entry/index.js')
  if (entryOptions && typeof entryOptions.onLoad === 'function') {
    wxCalls.reLaunch.length = 0
    const ctx = makePageContext(entryOptions)
    let threw = null
    try {
      entryOptions.onLoad.call(ctx)
    } catch (error) {
      threw = error
    }
    assert(threw === null, 'entry.onLoad 不抛异常', threw ? String(threw.message ?? threw) : '')
    // 本地无 token → 应跳登录页
    assert(
      wxCalls.reLaunch.length === 1 && wxCalls.reLaunch[0] === '/pages/login/index',
      '未登录时 entry 跳转到登录页',
      `实际: ${JSON.stringify(wxCalls.reLaunch)}`,
    )
  }

  const loginOptions = registeredPages.get('pages/login/index.js')
  if (loginOptions && typeof loginOptions.onLoad === 'function') {
    const ctx = makePageContext(loginOptions)
    let threw = null
    try {
      loginOptions.onLoad.call(ctx)
    } catch (error) {
      threw = error
    }
    assert(threw === null, 'login.onLoad 不抛异常', threw ? String(threw.message ?? threw) : '')
    assert(ctx.data && typeof ctx.data === 'object', 'login 页面 data 可初始化')
  }

  const homeOptions = registeredPages.get('pages/home/index.js')
  if (homeOptions) {
    wxCalls.reLaunch.length = 0
    const ctx = makePageContext(homeOptions)
    const hook = typeof homeOptions.onShow === 'function' ? 'onShow' : 'onLoad'
    if (typeof homeOptions[hook] === 'function') {
      let threw = null
      try {
        homeOptions[hook].call(ctx)
      } catch (error) {
        threw = error
      }
      assert(threw === null, `home.${hook} 不抛异常`, threw ? String(threw.message ?? threw) : '')
      // 未登录访问首页 → 登录守卫应拦回登录页
      assert(
        wxCalls.reLaunch.includes('/pages/login/index') ||
          wxCalls.redirectTo.includes('/pages/login/index'),
        '未登录访问工作台被守卫拦回登录页',
        `实际: ${JSON.stringify({ reLaunch: wxCalls.reLaunch, redirectTo: wxCalls.redirectTo })}`,
      )
    }
  }

  console.log('')
  if (jsErrors.length > 0) {
    console.log('—— 加载期异常堆栈 ——')
    jsErrors.forEach((e) => console.log(e))
    console.log('')
  }
  console.log(`${pass}/${pass + fail} 通过`)
  if (fail > 0) process.exit(1)
}

main().catch((error) => {
  console.error('[smoke-boot] 崩溃:', error)
  process.exit(1)
})
