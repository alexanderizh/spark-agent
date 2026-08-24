import { createLogger } from '@spark/shared'

/**
 * 沙箱文档内存注册表工厂。
 *
 * 为什么不用 iframe srcdoc：srcdoc 文档按 CSP 规范继承父文档（renderer）的
 * 策略容器，而 renderer 的 CSP 是 `script-src 'self' capability-asset:`，
 * 会拦掉合成文档的内联脚本。改为把合成文档登记到主进程内存，用
 * `capability-asset://<host>/<token>` 导航加载——自定义 scheme 的文档有
 * 独立（空）策略容器，只受文档自带 meta CSP 约束，且 renderer CSP 的
 * frame-src 已放行 capability-asset:。
 *
 * 该工厂被子应用（subapp-runtime）与内容区 HTML 渲染块（html-render）
 * 两个域分别实例化：容量互不挤占，生命周期语义一致——renderer 在
 * 挂载/重载时 put，卸载时 release；兜底用容量上限 + TTL 防止渲染进程
 * 崩溃后的残留。
 */

const log = createLogger('runtime-doc-registry')

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/

export interface RuntimeDocRegistryOptions {
  /** 错误消息与日志中的域标签，如 'sub-app runtime doc'。 */
  label: string
  maxDocs: number
  ttlMs: number
}

export interface RuntimeDocRegistry {
  put(token: string, document: string): void
  release(token: string): void
  /** 命中即续期，未命中返回 null（协议层 404）。 */
  take(token: string): string | null
}

export function createRuntimeDocRegistry(options: RuntimeDocRegistryOptions): RuntimeDocRegistry {
  const docs = new Map<string, { html: string; expiresAt: number }>()

  const evictExpired = (now: number): void => {
    for (const [key, entry] of docs) {
      if (entry.expiresAt <= now) docs.delete(key)
    }
  }

  return {
    put(token: string, document: string): void {
      if (!TOKEN_PATTERN.test(token)) throw new Error(`Invalid ${options.label} token`)
      const now = Date.now()
      evictExpired(now)
      // 覆盖同 token（reload 复用 token 的场景）不额外占用容量。
      if (!docs.has(token) && docs.size >= options.maxDocs) {
        const oldest = [...docs.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]
        if (oldest != null) {
          docs.delete(oldest[0])
          log.warn(`${options.label} registry reached ${options.maxDocs}, evicted oldest token`)
        }
      }
      docs.set(token, { html: document, expiresAt: now + options.ttlMs })
    },
    release(token: string): void {
      if (!TOKEN_PATTERN.test(token)) throw new Error(`Invalid ${options.label} token`)
      docs.delete(token)
    },
    take(token: string): string | null {
      if (!TOKEN_PATTERN.test(token)) return null
      const entry = docs.get(token)
      if (entry == null) return null
      entry.expiresAt = Date.now() + options.ttlMs
      return entry.html
    },
  }
}
