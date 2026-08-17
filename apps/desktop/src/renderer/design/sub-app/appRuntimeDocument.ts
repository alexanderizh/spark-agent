import type { HtmlRenderTheme } from '@spark/shared'
import { SUB_APP_PROTOCOL_VERSION, type SubAppSurface } from '@spark/protocol'

export const MAX_SUB_APP_SOURCE_LENGTH = 200_000

/**
 * 功能型子应用运行文档 CSP。
 *
 * 与 HTML viewer 的差异（更严格）：
 *   - connect-src 'none'：应用不得自行 fetch/XHR 外部数据；
 *     数据交换只能走 Spark App Bridge（postMessage → 宿主 IPC），
 *     这是应用数据审计和权限控制的前提。
 *   - frame-src / object-src / base-uri / form-action 全部 'none'。
 * 后续“网络访问”作为独立权限能力放开时，再按 manifest 显式放宽。
 */
const SUB_APP_RUNTIME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' https: http:; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; media-src data: blob: https: http:; font-src data: https: http:; connect-src 'none'; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

export interface SubAppBootstrapConfig {
  appId: string
  versionId: string
  instanceId: string
  mode: 'draft' | 'published'
  surface: SubAppSurface
}

export interface BuildAppRuntimeDocumentInput {
  source: string
  theme: HtmlRenderTheme
  config: SubAppBootstrapConfig
}

/**
 * 小窗口 surface（panel / overlay / global-window / desktop-pet）的铺满兜底。
 *
 * 应用源码普遍不写「铺满容器」样式（根容器 max-width 居中、body 不设高度），
 * 在固定尺寸的浮窗/侧板里会出现应用主体比容器小一圈的观感。宿主在应用源码
 * 之后注入以下带 !important 的样式强制铺满：
 *   - html 锁定视口高度，body 至少铺满（保留内容超高的文档流滚动）；
 *   - body 的首个元素级子节点（应用根容器）横向铺满、去 max-width 与外边距、
 *     最小高度铺满——只兜底「没写铺满」的应用，不锁死固定高度，长内容仍可滚动。
 * content surface（全屏内容区）不注入：居中窄栏是全屏下的合理排版。
 */
const SURFACE_FILL_STYLE =
  '<style>html{height:100%!important}body{width:100%!important;min-height:100%!important;margin:0!important}body>*:first-child{width:100%!important;max-width:none!important;min-height:100%!important;margin:0!important}</style>'

/**
 * panel surface 的贴顶补充。
 *
 * 统一侧面板顶部已有 44px tab 栏（面板导航，所有面板 tab 共用），应用根容器
 * 普遍再自带 16px 级别的顶部 padding，两者叠加后 tab 栏与应用首行内容之间
 * 会出现一条「无主」的空白带（像素级复现确认：宿主链路本身 0 间距，空白全部
 * 来自应用自身 padding + 标题行高）。侧板场景额外清零 body padding 与根容器
 * 顶部 padding，让应用内容贴着 tab 栏开始；overlay / global-window /
 * desktop-pet 维持已认可的独立窗口观感，不做此覆盖。
 */
const PANEL_FLUSH_TOP_STYLE =
  '<style>body{padding:0!important}body>*:first-child{padding-top:0!important}</style>'

/** 在 `</body>` 前追加片段；无 body 闭合标签时追加到文档末尾。 */
function appendBeforeBodyEnd(doc: string, snippet: string): string {
  const bodyClose = doc.toLowerCase().lastIndexOf('</body>')
  if (bodyClose >= 0) return `${doc.slice(0, bodyClose)}${snippet}${doc.slice(bodyClose)}`
  return `${doc}${snippet}`
}

/**
 * 构建功能型子应用的沙箱运行文档。
 *
 * 安全边界：
 *   - 宿主组件必须把返回值放进 `sandbox="allow-scripts"` 的 iframe（opaque origin）；
 *   - bootstrap SDK 在用户源码之前注入，应用脚本执行时 `window.sparkApp` 已可用；
 *   - 注入的配置通过 JSON 转义防止 `</script>` 逃逸。
 */
export function buildAppRuntimeDocument(input: BuildAppRuntimeDocumentInput): string {
  const { source, theme, config } = input
  if (source.length > MAX_SUB_APP_SOURCE_LENGTH) {
    throw new Error(`子应用源码超过 ${MAX_SUB_APP_SOURCE_LENGTH} 字符上限，请精简后再运行。`)
  }

  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${SUB_APP_RUNTIME_CSP}">`,
    `<meta name="color-scheme" content="${theme}">`,
    `<meta name="spark-app-mode" content="${config.mode}">`,
    // html 锁定视口高度后 body 的 min-height:100% 才能解析（否则标准模式下按 auto 处理）
    `<style>html{height:100%}body{min-height:100%;margin:0}html{color-scheme:${theme}}body{box-sizing:border-box;overflow:auto;background:transparent}</style>`,
    `<script>${buildBootstrapScript(config)}</script>`,
  ].join('')

  const documentMatch = source.match(/<html(?:\s[^>]*)?>/i)
  let doc: string
  if (documentMatch != null) {
    const documentIndex = documentMatch.index ?? 0
    const htmlTag = documentMatch[0].includes('data-spark-theme=')
      ? documentMatch[0]
      : documentMatch[0].replace(/^<html/i, `<html data-spark-theme="${theme}"`)
    const themed = `${source.slice(0, documentIndex)}${htmlTag}${source.slice(documentIndex + documentMatch[0].length)}`
    const headMatch = themed.match(/<head(?:\s[^>]*)?>/i)
    if (headMatch?.index != null) {
      const insertAt = headMatch.index + headMatch[0].length
      doc = `${themed.slice(0, insertAt)}${head}${themed.slice(insertAt)}`
    } else {
      const themedTag = themed.match(/<html(?:\s[^>]*)?>/i)
      const insertAt =
        themedTag?.index != null ? themedTag.index + themedTag[0].length : documentIndex
      doc = `${themed.slice(0, insertAt)}<head>${head}</head>${themed.slice(insertAt)}`
    }
  } else {
    doc = `<!doctype html><html data-spark-theme="${theme}"><head>${head}</head><body>${source}</body></html>`
  }
  // 小窗口 surface 的铺满兜底放在应用源码之后：!important 需后置于应用声明才能稳定生效
  if (config.surface === 'content') return doc
  const fill =
    config.surface === 'panel' ? SURFACE_FILL_STYLE + PANEL_FLUSH_TOP_STYLE : SURFACE_FILL_STYLE
  return appendBeforeBodyEnd(doc, fill)
}

/**
 * 沙箱内 bootstrap SDK：提供 `window.sparkApp` 客户端。
 * 约束：
 *   - 只与 parent 通过 postMessage 通信，不访问任何 DOM 之外的宿主能力；
 *   - 请求带超时，避免应用端悬挂 Promise 累积；
 *   - theme 推送缓存最近一次，应用可同步读取。
 */
function buildBootstrapScript(config: SubAppBootstrapConfig): string {
  const injected = escapeScriptJson({
    protocolVersion: SUB_APP_PROTOCOL_VERSION,
    appId: config.appId,
    versionId: config.versionId,
    instanceId: config.instanceId,
  })
  return `(function () {
  'use strict'
  var cfg = ${injected}
  var seq = 0
  var pending = {}
  var themeListeners = []
  var latestTheme = null
  var REQUEST_TIMEOUT_MS = 30000

  function post(message) { parent.postMessage(message, '*') }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || typeof data !== 'object' || data.instanceId !== cfg.instanceId) return
    if (data.type === 'host/theme') {
      latestTheme = data.theme
      applyTheme(data.theme)
      for (var i = 0; i < themeListeners.length; i++) {
        try { themeListeners[i](data.theme) } catch (e) { /* 应用监听器异常不影响宿主 */ }
      }
      return
    }
    if (data.type === 'host/response') {
      var response = data.response
      if (!response || typeof response !== 'object') return
      var entry = pending[response.requestId]
      if (!entry) return
      delete pending[response.requestId]
      clearTimeout(entry.timer)
      if (response.ok) {
        entry.resolve(response.data === undefined ? null : response.data)
      } else {
        var error = new Error((response.error && response.error.message) || 'Spark App Bridge 调用失败')
        if (response.error && response.error.code) error.code = response.error.code
        entry.reject(error)
      }
    }
  })

  // 主题不要求应用先写一套框架适配代码：宿主 token 同步映射到只读的
  // --spark-* CSS 变量，应用只要使用这些变量即可自动跟随 SparkWork。
  function toCssVariable(name) {
    return '--spark-' + name.replace(/[A-Z]/g, function (letter) {
      return '-' + letter.toLowerCase()
    })
  }

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return
    var root = document.documentElement
    if (theme.theme === 'light' || theme.theme === 'dark') {
      root.setAttribute('data-spark-theme', theme.theme)
      root.style.colorScheme = theme.theme
    }
    if (theme.tokens && typeof theme.tokens === 'object') {
      Object.keys(theme.tokens).forEach(function (name) {
        var value = theme.tokens[name]
        if (typeof value === 'string') root.style.setProperty(toCssVariable(name), value)
      })
    }
    if (typeof theme.primaryColor === 'string') {
      root.style.setProperty('--spark-primary-color', theme.primaryColor)
    }
    if (typeof theme.fontSize === 'number' && isFinite(theme.fontSize)) {
      root.style.setProperty('--spark-font-size', theme.fontSize + 'px')
    }
    root.style.setProperty('--spark-reduced-motion', theme.reducedMotion ? '1' : '0')
  }

  function call(capability, operation, payload) {
    return new Promise(function (resolve, reject) {
      seq += 1
      var requestId = cfg.instanceId + '-' + seq
      var timer = setTimeout(function () {
        delete pending[requestId]
        reject(new Error('Spark App Bridge 请求超时: ' + capability + '/' + operation))
      }, REQUEST_TIMEOUT_MS)
      pending[requestId] = { resolve: resolve, reject: reject, timer: timer }
      post({
        type: 'app/request',
        instanceId: cfg.instanceId,
        request: {
          protocolVersion: cfg.protocolVersion,
          appId: cfg.appId,
          versionId: cfg.versionId,
          instanceId: cfg.instanceId,
          requestId: requestId,
          capability: capability,
          operation: operation,
          payload: payload === undefined ? null : payload,
        },
      })
    })
  }

  window.sparkApp = {
    runtime: {
      getInfo: function () { return call('runtime', 'getInfo', null) },
    },
    theme: {
      get: function () { return call('theme', 'get', null) },
      current: function () { return latestTheme },
      onChange: function (listener) {
        if (typeof listener !== 'function') return function () {}
        themeListeners.push(listener)
        return function () {
          var index = themeListeners.indexOf(listener)
          if (index >= 0) themeListeners.splice(index, 1)
        }
      },
    },
    data: {
      get: function (namespace, key) { return call('data', 'get', { namespace: namespace, key: key }) },
      list: function (namespace, options) {
        var payload = { namespace: namespace }
        if (options && options.prefix !== undefined) payload.prefix = options.prefix
        if (options && options.limit !== undefined) payload.limit = options.limit
        if (options && options.offset !== undefined) payload.offset = options.offset
        return call('data', 'list', payload)
      },
      upsert: function (namespace, key, value, expectedRevision) {
        var payload = { namespace: namespace, key: key, value: value }
        if (expectedRevision !== undefined) payload.expectedRevision = expectedRevision
        return call('data', 'upsert', payload)
      },
      delete: function (namespace, key, expectedRevision) {
        return call('data', 'delete', {
          namespace: namespace,
          key: key,
          expectedRevision: expectedRevision,
        })
      },
    },
    ui: {
      toast: function (content, type) {
        var payload = { content: content }
        if (type !== undefined) payload.type = type
        return call('ui', 'toast', payload)
      },
    },
    navigation: {
      openApp: function (appId) { return call('navigation', 'openApp', { appId: appId }) },
      openView: function (view) { return call('navigation', 'openView', { view: view }) },
    },
    files: {
      read: function (path) { return call('files', 'read', { path: path }) },
      write: function (path, content) {
        return call('files', 'write', { path: path, content: content })
      },
      list: function (prefix) {
        var payload = {}
        if (prefix !== undefined) payload.prefix = prefix
        return call('files', 'list', payload)
      },
      delete: function (path) { return call('files', 'delete', { path: path }) },
    },
    agent: {
      send: function (prompt, options) {
        var payload = { prompt: prompt }
        if (options && options.newSession) payload.newSession = true
        return call('agent', 'send', payload)
      },
    },
    media: {
      generate: function (options) {
        var payload = { operation: options.operation, prompt: options.prompt }
        if (options.negativePrompt !== undefined) payload.negativePrompt = options.negativePrompt
        if (options.modelId !== undefined) payload.modelId = options.modelId
        return call('media', 'generate', payload)
      },
      get: function (taskId) { return call('media', 'get', { taskId: taskId }) },
    },
    canvas: {
      listProjects: function () { return call('canvas', 'listProjects', {}) },
      appendText: function (projectId, text, options) {
        var payload = { projectId: projectId, text: text }
        if (options && options.boardId !== undefined) payload.boardId = options.boardId
        return call('canvas', 'appendText', payload)
      },
    },
    browser: {
      openUrl: function (url) { return call('browser', 'openUrl', { url: url }) },
    },
  }

  post({ type: 'app/ready', instanceId: cfg.instanceId, protocolVersion: cfg.protocolVersion })
})()`
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
}
