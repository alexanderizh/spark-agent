import { useCallback, useEffect, useState } from 'react'
import type {
  FontAssetsInstallResponse,
  FontAssetsStatusResponse,
  ManagedFontFaceSource,
} from '@spark/protocol'

const INITIAL_STATUS: FontAssetsStatusResponse = {
  state: 'missing',
  version: null,
  percent: null,
  message: '正在检查字体资源',
  lastError: null,
  fonts: [],
}

let loadedKey = ''
let loadedFaces: FontFace[] = []

function sourceKey(source: ManagedFontFaceSource): string {
  return [source.family, source.weight, source.style, source.url].join('|')
}

export async function loadManagedFontFaces(status: FontAssetsStatusResponse): Promise<void> {
  if (status.state !== 'ready' || status.fonts.length === 0) return
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return
  const nextKey = `${status.version ?? 'unknown'}:${status.fonts.map(sourceKey).join(';')}`
  if (nextKey === loadedKey) return

  const nextFaces = await Promise.all(
    status.fonts.map((source) =>
      new FontFace(
        source.family,
        `url("${source.url}") format("${source.format}")`,
        { weight: source.weight, style: source.style, display: 'swap' },
      ).load(),
    ),
  )

  for (const face of nextFaces) document.fonts.add(face)
  for (const face of loadedFaces) document.fonts.delete(face)
  loadedFaces = nextFaces
  loadedKey = nextKey
  document.documentElement.dataset.managedFonts = 'ready'
  window.dispatchEvent(new CustomEvent('spark:managed-fonts-ready', {
    detail: { version: status.version },
  }))
}

export function useManagedFontAssets(): {
  status: FontAssetsStatusResponse
  install: (force?: boolean) => Promise<FontAssetsInstallResponse>
} {
  const [status, setStatus] = useState<FontAssetsStatusResponse>(INITIAL_STATUS)

  const acceptStatus = useCallback((next: FontAssetsStatusResponse) => {
    setStatus(next)
    if (next.state === 'ready') {
      void loadManagedFontFaces(next).catch((error) => {
        setStatus({
          ...next,
          state: 'error',
          message: '字体文件加载失败，已回退系统字体',
          lastError: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }, [])

  useEffect(() => {
    let active = true
    void window.spark.invoke('font-assets:status', {}).then((next) => {
      if (active) acceptStatus(next)
    }).catch((error) => {
      if (!active) return
      setStatus({
        ...INITIAL_STATUS,
        state: 'error',
        message: '无法检查字体资源，已回退系统字体',
        lastError: error instanceof Error ? error.message : String(error),
      })
    })
    const unsubscribe = window.spark.on('stream:font-assets:status', acceptStatus)
    return () => {
      active = false
      unsubscribe()
    }
  }, [acceptStatus])

  const install = useCallback(async (force = true) => {
    const result = await window.spark.invoke('font-assets:install', { force })
    acceptStatus(result.status)
    return result
  }, [acceptStatus])

  return { status, install }
}
