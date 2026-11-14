#!/usr/bin/env node
/**
 * 正式发布前自检（提审前必跑，无外部依赖）：
 *   1. 主包体积 ≤ 2MB（微信单包上限，超了传不上去）
 *   2. runtime config 的 baseUrl 必须是 https 公网地址（防误打包内网/localhost）
 *   3. 输出需在后台「开发管理 → 服务器域名」配置的 request / socket 合法域名
 *   4. 输出需在后台「设置 → 用户隐私保护指引」声明的隐私接口
 *   5. appid / 页面数 / sitemap / 主题 / darkmode 配置齐全
 *   6. dist 中不得残留 http:// 明文接口（小程序正式版强制 https）
 *
 * 用法：node scripts/preflight-release.mjs
 * 退出码：1 = 存在阻断项（必须先修），0 = 可上传
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

const MAIN_PACKAGE_LIMIT = 2 * 1024 * 1024
const blockers = []
const notes = []

function fail(msg) {
  blockers.push(msg)
}
function note(msg) {
  notes.push(msg)
}
function walk(dir, onFile) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, onFile)
    else onFile(full)
  }
}
function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

if (!existsSync(dist)) {
  console.error('[preflight] dist/ 不存在，先跑 `pnpm build`')
  process.exit(1)
}

// ── 0. 源码扫描（域名/隐私声明都从源码判断实际用到了什么） ────────────────
const srcDir = join(root, 'src')
const sourceText = []
let srcNewest = 0
walk(srcDir, (file) => {
  const st = statSync(file)
  if (st.mtimeMs > srcNewest) srcNewest = st.mtimeMs
  if (/\.(ts|wxml)$/.test(file)) sourceText.push(readFileSync(file, 'utf8'))
})
const allSource = sourceText.join('\n')

// ── 1. 主包体积（同时取 dist 最新 mtime 供新鲜度判断） ──────────────────────
let totalBytes = 0
let distNewest = 0
const offenders = []
walk(dist, (file) => {
  const st = statSync(file)
  const size = st.size
  if (st.mtimeMs > distNewest) distNewest = st.mtimeMs
  totalBytes += size
  if (size > 200 * 1024) offenders.push([file.slice(dist.length + 1), size])
})
const mb = (totalBytes / 1024 / 1024).toFixed(2)
if (totalBytes > MAIN_PACKAGE_LIMIT) {
  fail(`主包 ${mb}MB 超过 2MB 上限，需拆分分包或压缩资源`)
}

// dist 新鲜度：src 里有文件比「dist 里最新的那个」还新 → 忘了 build，结论不可信。
// 留 2s 容差，避免 build 过程中生成 theme-dark.wxss（写 src）与拷贝（写 dist）
// 的毫秒级先后差异造成误报。
const LAG_TOLERANCE_MS = 2000
if (srcNewest > distNewest + LAG_TOLERANCE_MS) {
  const lag = Math.round((srcNewest - distNewest) / 60000)
  fail(`dist 过期（src 比构建产物新 ${lag || '<1'} 分钟），先跑 pnpm build 再自检`)
}

// ── 2. 运行时 baseUrl ────────────────────────────────────────────────────────
const generated = join(dist, 'config.generated.js')
let baseUrl = ''
if (!existsSync(generated)) {
  fail('dist/config.generated.js 缺失，构建产物不完整')
} else {
  const src = readFileSync(generated, 'utf8')
  const m = src.match(/"baseUrl"\s*:\s*"([^"]*)"/)
  baseUrl = m ? m[1] : ''
  if (!baseUrl) {
    fail('config.generated.js 里读不到 baseUrl')
  } else if (!/^https:\/\//.test(baseUrl)) {
    fail(`baseUrl 不是 https：${baseUrl}（正式版强制 https + 白名单域名）`)
  } else if (
    /localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\./.test(baseUrl)
  ) {
    fail(`baseUrl 指向内网地址：${baseUrl}（真机不可达，且无法配置为合法域名）`)
  }
}

// ── 3. 合法域名清单（照抄到微信后台，只列源码里真的会发起请求的类型） ──────
const usesUpload = /\bwx\.uploadFile\b/.test(allSource)
const usesDownload = /\bwx\.downloadFile\b/.test(allSource)
const domains = []
if (baseUrl) {
  domains.push(['request 合法域名', baseUrl])
  domains.push(['socket 合法域名', baseUrl.replace(/^https:\/\//, 'wss://')])
  if (usesUpload) domains.push(['uploadFile 合法域名', baseUrl])
  if (usesDownload) domains.push(['downloadFile 合法域名', baseUrl])
}

// ── 4. 隐私接口 → 后台声明项映射 ────────────────────────────────────────────
const PRIVACY_MAP = [
  [/\bwx\.chooseMedia\b|\bwx\.chooseImage\b/g, '选中的照片或视频信息'],
  [/\bwx\.saveImageToPhotosAlbum\b/g, '相册（仅写入）权限'],
  [/\bwx\.chooseMessageFile\b/g, '选中的文件'],
  [/\bwx\.(set|get)ClipboardData\b/g, '剪切板'],
  [/\bwx\.getLocation\b|\bwx\.chooseLocation\b/g, '位置信息'],
  [/\bwx\.getPhoneNumber\b/g, '手机号'],
  [/\bwx\.(start|stop)Record\b|\brecorderManager\b/g, '麦克风'],
  // 只认 <camera> 组件 / createCameraContext；chooseMedia 的 sourceType: 'camera'
  // 走系统相机，不额外声明，别用裸 `camera` 判定（会命中 icon 类名）。
  [/createCameraContext|<camera[\s>]/g, '摄像头'],
]
const privacyHits = PRIVACY_MAP.filter(([re]) => {
  re.lastIndex = 0
  return re.test(allSource)
}).map(([, name]) => name)

// ── 5. 基础配置齐全性 ──────────────────────────────────────────────────────
const appJsonPath = join(dist, 'app.json')
if (!existsSync(appJsonPath)) {
  fail('dist/app.json 缺失')
}
let pageCount = 0
if (existsSync(appJsonPath)) {
  const appJson = readJson(appJsonPath)
  pageCount = (appJson.pages || []).length
  if (!appJson.sitemapLocation) fail('app.json 缺 sitemapLocation')
  if (!appJson.themeLocation) fail('app.json 缺 themeLocation（深色首帧会闪白）')
  if (appJson.darkmode !== true) note('app.json 未开启 darkmode')
  if (!existsSync(join(dist, appJson.sitemapLocation))) fail('sitemap.json 缺失')
  if (appJson.themeLocation && !existsSync(join(dist, appJson.themeLocation))) {
    fail('theme.json 缺失')
  }
}

const projectConfig = join(root, 'project.config.json')
let appid = ''
if (!existsSync(projectConfig)) {
  fail('project.config.json 缺失')
} else {
  const pc = readJson(projectConfig)
  appid = pc.appid || ''
  if (!appid) fail('project.config.json 缺 appid')
  if (pc.miniprogramRoot !== 'dist/') fail(`miniprogramRoot 应为 dist/，当前 ${pc.miniprogramRoot}`)
  if (pc.setting && pc.setting.urlCheck === true)
    note('project.config.json 开了 urlCheck（本地调试会拦未配域名，上传不影响）')
}

// ── 6. dist 里残留的 http:// 明文 ───────────────────────────────────────────
const httpHits = new Set()
walk(dist, (file) => {
  if (!/\.(js|json|wxss|wxml)$/.test(file)) return
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/http:\/\/[a-z0-9.-]+/gi)) {
    const url = m[0]
    // 排除命名空间 URL、本机调试地址、以及构建脚本注释里的 `192.168.x.x` 占位示例
    if (/w3\.org|localhost|127\.0\.0\.1|schemas|example\.com|192\.168\.x/.test(url)) continue
    httpHits.add(url)
  }
})
if (httpHits.size) fail(`dist 中残留 http:// 明文地址：${[...httpHits].join(', ')}`)

// ── 输出 ────────────────────────────────────────────────────────────────────
const line = (k, v) => console.log(`  ${k.padEnd(18)} ${v}`)
console.log('\n[preflight] 小程序正式发布自检\n')
console.log('── 包与产物 ──')
line('主包体积', `${mb} MB / 2.00 MB 上限`)
line('appid', appid || '(缺失)')
line('页面数', String(pageCount))
if (offenders.length) {
  line(
    '最大文件',
    offenders
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([f, s]) => `${f} ${(s / 1024).toFixed(0)}KB`)
      .join(', '),
  )
}

console.log('\n── 后台「服务器域名」需逐条配置 ──')
if (!domains.length) console.log('  (baseUrl 未解析)')
for (const [kind, value] of domains) line(kind, value)

console.log('\n── 后台「用户隐私保护指引」需勾选 ──')
console.log(privacyHits.length ? `  ${privacyHits.join(' / ')}` : '  (未检测到隐私接口)')

if (notes.length) {
  console.log('\n── 提示 ──')
  for (const n of notes) console.log(`  · ${n}`)
}

if (blockers.length) {
  console.log('\n── 阻断项（必须修）──')
  for (const b of blockers) console.log(`  ✗ ${b}`)
  console.log('\n[preflight] FAILED\n')
  process.exit(1)
}

console.log('\n[preflight] PASSED — 可上传；域名与隐私声明仍需人工在微信后台配置\n')
