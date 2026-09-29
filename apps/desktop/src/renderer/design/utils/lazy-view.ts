/**
 * lazy-view — 视图懒加载的失败自愈封装
 *
 * 背景：React.lazy 的加载器只会在首次挂载时调用一次；一旦 import() 因
 * dev server 重启、网络瞬断或产物缺失而 reject，该 lazy 实例会永久缓存
 * rejected promise，之后无论错误边界怎么重置状态都会重新抛出同一错误，
 * 应用只能靠整页 reload 恢复。
 *
 * 本文件提供两层防御：
 * 1. `lazyView`：包一层带退避的自动重试，让「vite 重启空窗」这类瞬态
 *    失败在 Suspense 期间自愈，不打到错误页；
 * 2. `isDynamicImportFetchError`：供 ErrorBoundary 识别动态导入失败，
 *    将「重试」升级为整页 reload（对这类错误是唯一可靠的恢复手段）。
 */
import React from 'react'

/** Chromium / WebKit 对动态导入网络失败抛出的 TypeError 特征 */
const DYNAMIC_IMPORT_ERROR_PATTERNS: RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
]

/** 判断错误是否为动态导入的网络/资源级失败（可靠恢复手段是整页 reload） */
export function isDynamicImportFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message ?? ''
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * 退避序列：前三次快速退避覆盖 HMR 抖动 / 连接瞬断；之后以 2.5s 稳态间隔
 * 持续等待，总自愈窗口约 20s——实测 `pnpm dev` 整链重启（prepare 脚本 +
 * electron-vite 冷启 + vite server 就绪）约 10–15s，20s 足以让重启空窗内
 * 触发的懒加载在 Suspense 加载态里自愈，而不是打到错误页。
 */
const RETRY_DELAYS_MS = [400, 900, 1600, 2500, 2500, 2500, 2500, 2500, 2500] as const

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 对懒加载器做有限次带退避的重试。
 * 仅用于瞬态失败（server 重启空窗、连接重置）；确定性失败（模块不存在）
 * 立即如实抛出；瞬态失败持续约 20s 仍不恢复时，也如实抛出交由错误边界接管
 * （错误边界对这类错误的「重试」是整页 reload）。
 */
export async function withDynamicImportRetry<T>(load: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await load()
    } catch (error) {
      lastError = error
      // 确定性失败不必重试，直接交给错误边界
      if (!isDynamicImportFetchError(error)) throw error
      const waitMs = RETRY_DELAYS_MS[attempt]
      if (typeof waitMs === 'number') await delay(waitMs)
    }
  }
  throw lastError
}

/** React.lazy 的自愈版本：所有视图懒加载统一走这里 */
export function lazyView<T extends React.ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(() => withDynamicImportRetry(load))
}
