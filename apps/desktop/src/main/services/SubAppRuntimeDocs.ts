import type { SubAppRuntimeDocPutRequest } from '@spark/protocol'
import { createRuntimeDocRegistry } from './RuntimeDocRegistry.js'

/**
 * 子应用沙箱文档内存注册表。
 *
 * 机制背景见 RuntimeDocRegistry.ts：合成文档登记到主进程，用
 * `capability-asset://subapp-runtime-<appId>-<format>/<token>` 导航加载，避开
 * srcdoc 继承 renderer CSP 导致内联脚本被拦的问题。按 appId 与格式分 origin，
 * 使运行页可使用正常源语义，并隔离不同应用及 V1/V2 的信任边界。
 *
 * 生命周期：renderer 在挂载/重载时 put-doc，卸载时 release-doc；
 * 兜底用容量上限 + TTL 防止渲染进程崩溃后的残留。
 */

const APP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SubAppRuntimeDocReleaseRequest {
  token: string
}
export interface SubAppRuntimeDocAck {
  ok: true
}

const registry = createRuntimeDocRegistry<{ appId: string; format: 'v1' | 'v2' }>({
  label: 'sub-app runtime doc',
  maxDocs: 64,
  ttlMs: 10 * 60 * 1000,
})

export function putSubAppRuntimeDoc(request: SubAppRuntimeDocPutRequest): SubAppRuntimeDocAck {
  if (!APP_ID_PATTERN.test(request.appId)) throw new Error('Invalid sub-app runtime appId')
  registry.put(request.token, request.document, {
    appId: request.appId.toLowerCase(),
    format: request.format,
  })
  return { ok: true }
}

export function releaseSubAppRuntimeDoc(
  request: SubAppRuntimeDocReleaseRequest,
): SubAppRuntimeDocAck {
  registry.release(request.token)
  return { ok: true }
}

/** 供协议 handler 查询；命中即续期，未命中返回 null（404）。 */
export function takeSubAppRuntimeDoc(
  appId: string,
  format: 'v1' | 'v2',
  token: string,
): string | null {
  if (!APP_ID_PATTERN.test(appId)) return null
  const metadata = registry.takeMeta(token)
  if (metadata?.appId !== appId.toLowerCase() || metadata.format !== format) return null
  return registry.take(token)
}
