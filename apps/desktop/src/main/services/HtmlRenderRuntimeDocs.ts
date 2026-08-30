import { createRuntimeDocRegistry } from './RuntimeDocRegistry.js'

/**
 * 内容区 HTML 渲染块（mcp__spark_ui__render_html）的沙箱文档注册表。
 *
 * 与子应用共用 capability-asset 沙箱文档机制（见 RuntimeDocRegistry.ts），
 * 但独立存储：会话内容区可能同时展示大量 HTML 块，不能挤占子应用的
 * 容量。token 由 renderer 从 block 派生（见 renderer 的 render-html.ts），
 * inline / 侧面板 / 全屏多个展示入口共用同一 token，put 幂等覆盖。
 */

export const HTML_RENDER_RUNTIME_HOST = 'html-render'

export interface HtmlRuntimeDocPutRequest {
  token: string
  document: string
}
export interface HtmlRuntimeDocReleaseRequest {
  token: string
}
export interface HtmlRuntimeDocAck {
  ok: true
}

const registry = createRuntimeDocRegistry({
  label: 'HTML render runtime doc',
  maxDocs: 256,
  ttlMs: 10 * 60 * 1000,
})

export function putHtmlRenderRuntimeDoc(request: HtmlRuntimeDocPutRequest): HtmlRuntimeDocAck {
  registry.put(request.token, request.document)
  return { ok: true }
}

export function releaseHtmlRenderRuntimeDoc(
  request: HtmlRuntimeDocReleaseRequest,
): HtmlRuntimeDocAck {
  registry.release(request.token)
  return { ok: true }
}

/** 供协议 handler 查询；命中即续期，未命中返回 null（404）。 */
export function takeHtmlRenderRuntimeDoc(token: string): string | null {
  return registry.take(token)
}
