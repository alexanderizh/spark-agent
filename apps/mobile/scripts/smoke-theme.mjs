#!/usr/bin/env node
/** 主题专项冒烟：真实加载 dist 的 App、主题模块与个人中心，验证三态和原生窗口同步。 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const require = createRequire(import.meta.url)
const storage = new Map()
const systemInfo = { platform: 'devtools', windowWidth: 375, theme: 'dark' }
const navigationCalls = []
const backgroundCalls = []
const backgroundTextCalls = []
let themeListener = null
let listenerCount = 0
let appOptions = null
let profileOptions = null

const currentPage = {
  data: {},
  setData(patch) {
    Object.assign(this.data, patch)
  },
}

const noop = () => {}
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getSystemInfoSync: () => ({ ...systemInfo }),
  onThemeChange: (listener) => {
    themeListener = listener
    listenerCount += 1
  },
  setNavigationBarColor: (options) => navigationCalls.push(options),
  setBackgroundColor: (options) => backgroundCalls.push(options),
  setBackgroundTextStyle: (options) => backgroundTextCalls.push(options),
  getFileSystemManager: () => ({
    readdirSync: () => { throw new Error('no cache dir') },
    statSync: () => { throw new Error('no cache file') },
    unlinkSync: noop,
  }),
  request: () => ({ abort: noop }),
  reLaunch: noop,
  showToast: noop,
}
globalThis.getCurrentPages = () => [currentPage]
globalThis.App = (options) => { appOptions = options }
globalThis.Page = (options) => { profileOptions = options }
globalThis.Component = noop

let pass = 0
function check(name, fn) {
  fn()
  pass += 1
  console.log(`✅ ${name}`)
}

function emitSystemTheme(theme) {
  systemInfo.theme = theme
  themeListener?.({ theme })
}

const themePath = join(dist, 'utils', 'theme.js')
storage.set('spark-mobile:theme-preference', 'invalid-value')
require(join(dist, 'app.js'))
let appError = null
try {
  appOptions?.onLaunch()
} catch (error) {
  appError = error
}
const theme = require(themePath)

check('App.onLaunch 初始化主题不抛异常', () => assert.equal(appError, null))
check('非法缓存回退为跟随系统', () => assert.equal(theme.getThemeState().preference, 'system'))
check('跟随系统解析为深色', () => assert.equal(theme.getThemeState().resolved, 'dark'))
check('当前页面收到深色类和原生控件色', () => {
  assert.equal(currentPage.data.themeClass, 'theme-dark')
  assert.equal(currentPage.data.themePlaceholderColor, '#79766f')
})
check('原生导航栏同步深色前景背景', () => {
  assert.equal(navigationCalls.at(-1).backgroundColor, '#171716')
  assert.equal(navigationCalls.at(-1).frontColor, '#ffffff')
  assert.equal(backgroundCalls.at(-1).backgroundColor, '#171716')
  assert.equal(backgroundTextCalls.at(-1).textStyle, 'light')
})

appOptions.onShow()
appOptions.onShow()
check('重复进入前台不重复注册系统监听', () => assert.equal(listenerCount, 1))

emitSystemTheme('light')
check('跟随系统响应浅色切换', () => {
  assert.equal(theme.getThemeState().resolved, 'light')
  assert.equal(currentPage.data.themeClass, 'theme-light')
  assert.equal(navigationCalls.at(-1).frontColor, '#000000')
})

theme.setThemePreference('dark')
check('手动深色写入本地并立即生效', () => {
  assert.equal(storage.get('spark-mobile:theme-preference'), 'dark')
  assert.equal(currentPage.data.themeClass, 'theme-dark')
  assert.equal(theme.getThemeTextColor(), '#f2f1ef')
})

emitSystemTheme('light')
check('手动模式下系统事件不覆盖选择', () => assert.equal(theme.getThemeState().resolved, 'dark'))

theme.setThemePreference('light')
check('手动浅色立即更新页面', () => {
  assert.equal(theme.getThemeState().resolved, 'light')
  assert.equal(currentPage.data.themeResolvedLabel, '浅色')
})

theme.setThemePreference('system')
check('恢复跟随系统采用当前系统外观', () => {
  assert.equal(theme.getThemeState().preference, 'system')
  assert.equal(theme.getThemeState().resolved, 'light')
})

require(join(dist, 'pages', 'profile', 'index.js'))
const profileContext = {
  data: { ...profileOptions.data },
  setData(patch) { Object.assign(this.data, patch) },
}
profileOptions.onSelectTheme.call(profileContext, { currentTarget: { dataset: { mode: 'dark' } } })
check('个人中心三档入口可切换深色', () => {
  assert.equal(theme.getThemeState().preference, 'dark')
  assert.equal(currentPage.data.themeModeLabel, '深色')
  assert.equal(storage.get('spark-mobile:theme-preference'), 'dark')
})

delete require.cache[themePath]
const restoredTheme = require(themePath)
themeListener = null
systemInfo.theme = 'light'
restoredTheme.initTheme()
check('冷启动恢复手动深色而不跟随系统', () => {
  assert.equal(restoredTheme.getThemeState().preference, 'dark')
  assert.equal(restoredTheme.getThemeState().resolved, 'dark')
  assert.equal(navigationCalls.at(-1).frontColor, '#ffffff')
})

console.log(`\n${pass}/${pass} 通过`)
