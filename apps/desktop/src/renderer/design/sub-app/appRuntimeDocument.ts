import type { HtmlRenderTheme } from '@spark/shared'
import { SUB_APP_PROTOCOL_VERSION } from '@spark/protocol'

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
}

export interface BuildAppRuntimeDocumentInput {
  source: string
  theme: HtmlRenderTheme
  config: SubAppBootstrapConfig
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
    `<style>html,body{min-height:100%;margin:0}html{color-scheme:${theme}}body{box-sizing:border-box;overflow:auto;background:transparent}</style>`,
    `<script>${buildBootstrapScript(config)}</script>`,
  ].join('')

  const documentMatch = source.match(/<html(?:\s[^>]*)?>/i)
  if (documentMatch != null) {
    const documentIndex = documentMatch.index ?? 0
    const htmlTag = documentMatch[0].includes('data-spark-theme=')
      ? documentMatch[0]
      : documentMatch[0].replace(/^<html/i, `<html data-spark-theme="${theme}"`)
    const themed = `${source.slice(0, documentIndex)}${htmlTag}${source.slice(documentIndex + documentMatch[0].length)}`
    const headMatch = themed.match(/<head(?:\s[^>]*)?>/i)
    if (headMatch?.index != null) {
      const insertAt = headMatch.index + headMatch[0].length
      return `${themed.slice(0, insertAt)}${head}${themed.slice(insertAt)}`
    }
    const themedTag = themed.match(/<html(?:\s[^>]*)?>/i)
    const insertAt =
      themedTag?.index != null ? themedTag.index + themedTag[0].length : documentIndex
    return `${themed.slice(0, insertAt)}<head>${head}</head>${themed.slice(insertAt)}`
  }
  return `<!doctype html><html data-spark-theme="${theme}"><head>${head}</head><body>${source}</body></html>`
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
