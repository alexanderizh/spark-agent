import { useEffect, useState } from 'react'
import snapshot from '../content/downloads.generated.json'

/** edu-server 那一侧的平台枚举（与 `desktop_release.platform` 完全一致） */
export type ApiPlatform = 'mac' | 'win' | 'linux'
export type ApiArch = 'arm64' | 'x64' | 'universal'

export interface LatestRelease {
  version: string
  channel: string
  platform: ApiPlatform
  arch: ApiArch
  fileName: string
  fileSize: number
  publicUrl: string
  releaseNotes: string | null
  publishedAt: string | null
}

export interface DownloadsSnapshot {
  /** 生成快照时的 ISO 时间，便于排查「为什么版本没更新」 */
  generatedAt: string | null
  /** 缺省 stable，未来若引入 beta/nightly 可加 */
  channel: string
  releases: LatestRelease[]
}

/**
 * 浏览器优先取的接口基地址。
 *
 *   1) 通过 Vite env 变量 `VITE_RELEASES_API_BASE` 注入（推荐）。
 *   2) 不配时回退到 `window.location.origin`（适合官网与 edu-server 部署在
 *      同一个反代下，路径前缀都是 `/api/...` 的情况）。
 *   3) 若以上都无法访问，自动降级到 build-time 烘焙的 snapshot，
 *      站点仍能渲染可用的下载链接。
 */
const API_BASE = (
  (import.meta.env.VITE_RELEASES_API_BASE as string | undefined) || ''
).replace(/\/$/, '')

const LATEST_ENDPOINT = '/api/v1/desktop/releases/latest'

/** 把构建期 JSON 强制成 DownloadsSnapshot 类型 */
const bakedSnapshot: DownloadsSnapshot = snapshot as DownloadsSnapshot

/** 暴露给 SSR/构建脚本：拿构建期烘焙的快照 */
export function getBakedSnapshot(): DownloadsSnapshot {
  return bakedSnapshot
}

/** 运行时拉一次最新版本；失败抛错，由调用方决定是否兜底 */
export async function fetchLatestReleases(channel = 'stable'): Promise<LatestRelease[]> {
  const base = API_BASE || window.location.origin.replace(/\/$/, '')
  const url = `${base}${LATEST_ENDPOINT}?channel=${encodeURIComponent(channel)}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  })
  if (!res.ok) {
    throw new Error(`releases api ${res.status}`)
  }
  const json = (await res.json()) as { code: number; message: string; data?: LatestRelease[] | LatestRelease | null }
  if (json.code !== 0) {
    throw new Error(json.message || 'releases api returned non-zero code')
  }
  const data = json.data
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

/**
 * React hook：组件优先用烘焙快照渲染（首屏无闪烁），
 * 同时在后台拉一次最新数据，成功就替换。失败保留快照。
 */
export function useLatestReleases(channel = 'stable'): {
  releases: LatestRelease[]
  /** 数据来自 'baked'（构建期快照）或 'live'（运行时刷新） */
  source: 'baked' | 'live'
  loading: boolean
  error: Error | null
} {
  const [releases, setReleases] = useState<LatestRelease[]>(bakedSnapshot.releases)
  const [source, setSource] = useState<'baked' | 'live'>('baked')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchLatestReleases(channel)
      .then((data) => {
        if (cancelled) return
        if (data.length > 0) {
          setReleases(data)
          setSource('live')
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // 静默失败：保留 baked 快照，控制台留痕便于排查
        // eslint-disable-next-line no-console
        console.warn('[releases] fetch failed, using baked snapshot:', e)
        setError(e instanceof Error ? e : new Error(String(e)))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [channel])

  return { releases, source, loading, error }
}
