import { createRuntimeDocRegistry } from './RuntimeDocRegistry.js'

/**
 * 子应用沙箱文档内存注册表。
 *
 * 机制背景见 RuntimeDocRegistry.ts：合成文档登记到主进程，用
 * `capability-asset://subapp-runtime/<token>` 导航加载，避开 srcdoc
 * 继承 renderer CSP 导致内联脚本被拦的问题。
 *
 * 生命周期：renderer 在挂载/重载时 put-doc，卸载时 release-doc；
 * 兜底用容量上限 + TTL 防止渲染进程崩溃后的残留。
 */

export const SUB_APP_RUNTIME_HOST = 'subapp-runtime'

export interface SubAppRuntimeDocPutRequest {
  token: string
  document: string
}
export interface SubAppRuntimeDocReleaseRequest {
  token: string
}
export interface SubAppRuntimeDocAck {
  ok: true
}

const registry = createRuntimeDocRegistry({
  label: 'sub-app runtime doc',
  maxDocs: 64,
  ttlMs: 10 * 60 * 1000,
})

export function putSubAppRuntimeDoc(request: SubAppRuntimeDocPutRequest): SubAppRuntimeDocAck {
  registry.put(request.token, request.document)
  return { ok: true }
}

export function releaseSubAppRuntimeDoc(
  request: SubAppRuntimeDocReleaseRequest,
): SubAppRuntimeDocAck {
  registry.release(request.token)
  return { ok: true }
}

/** 供协议 handler 查询；命中即续期，未命中返回 null（404）。 */
export function takeSubAppRuntimeDoc(token: string): string | null {
  return registry.take(token)
}
