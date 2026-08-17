import React from 'react'
import type { SubAppManifest, SubAppRelease } from '@spark/protocol'
import { useApp } from '../AppContext'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { buildAppRuntimeDocument } from './appRuntimeDocument'
import { SubAppBridgeHost } from './bridgeHost'
import { buildThemeState } from './themeTokens'

/** 应用就绪心跳超时：超时进入错误态并给出可执行提示。 */
const SUB_APP_READY_TIMEOUT_MS = 15_000

export interface SubAppRunnerProps {
  appId: string
  manifest: SubAppManifest
  source: string
  /** `draft` 运行草稿源码；`published` 运行发布快照源码。 */
  mode: 'draft' | 'published'
  /** 发布运行时传发布记录（versionId 取 release.id）；草稿运行传 undefined。 */
  release?: SubAppRelease | null
  className?: string
}

export type SubAppRunnerStatus = 'loading' | 'ready' | 'error'

export interface SubAppRunnerState {
  status: SubAppRunnerStatus
  errorMessage: string | null
  reload: () => void
  /** 沙箱 iframe 的 srcdoc（memo 化，只随源码/实例变化重建）。 */
  document: string
  instanceId: string
  frameRef: React.RefObject<HTMLIFrameElement | null>
}

/**
 * 功能型子应用运行时核心（P1：content surface）。
 *
 * - iframe `sandbox="allow-scripts"`（opaque origin），源码经
 *   buildAppRuntimeDocument 注入 CSP 与 bootstrap SDK；
 * - Bridge 宿主按消息校验 → 权限 → 路由顺序处理，appId 强制取宿主裁决；
 * - 主题热切换通过 postMessage 推送 token，不重载 iframe（文档内
 *   color-scheme 保持初次加载值，视觉一致性由 token 驱动）；
 * - 卸载时 detach Bridge 宿主，iframe 随组件销毁，无残留监听；
 * - hostRef 是实例内 ref：多应用同时运行时实例互不干扰。
 */
export function useSubAppRunner(props: SubAppRunnerProps): SubAppRunnerState {
  const { appId, manifest, source, mode, release } = props
  const resolvedTheme = useResolvedTheme()
  const primary = useApp().t.primary
  const [reloadCounter, setReloadCounter] = React.useState(0)
  const [status, setStatus] = React.useState<SubAppRunnerStatus>('loading')
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const frameRef = React.useRef<HTMLIFrameElement | null>(null)
  const hostRef = React.useRef<SubAppBridgeHost | null>(null)
  const resolvedThemeRef = React.useRef(resolvedTheme)
  const primaryRef = React.useRef(primary)

  // instanceId 只在 reload 时更换；主题变化不得重载应用。
  const instanceId = React.useMemo(
    () =>
      globalThis.crypto?.randomUUID?.() ??
      `inst-${Math.random().toString(36).slice(2)}-${Math.floor(Math.random() * 1e6)}`,
    [reloadCounter],
  )
  const versionId = release?.id ?? `draft-${appId}`

  const sandboxDocument = React.useMemo(
    () =>
      buildAppRuntimeDocument({
        source,
        theme: resolvedThemeRef.current,
        config: { appId, versionId, instanceId, mode },
      }),
    // srcdoc 只随源码/实例变化重建；主题走 postMessage 热推送。
    [source, instanceId, appId, versionId, mode],
  )

  React.useEffect(() => {
    setStatus('loading')
    setErrorMessage(null)
    const host = new SubAppBridgeHost({
      runtimeInfo: {
        appId,
        name: manifest.name,
        description: manifest.description,
        surface: manifest.surface,
        entry: manifest.entry,
        versionId,
        instanceId,
        mode,
        permissions: manifest.permissions,
      },
      getFrameWindow: () => frameRef.current?.contentWindow ?? null,
      invoke: (channel, request) => window.spark.invoke(channel, request),
      getThemeState: () => buildThemeState(resolvedThemeRef.current, primaryRef.current),
    })
    hostRef.current = host
    host.attach()

    const readyTimer = window.setTimeout(() => {
      if (!host.isReady()) {
        setStatus('error')
        setErrorMessage('应用未在 15 秒内完成启动。请检查应用源码是否阻塞，然后点击重新加载。')
      }
    }, SUB_APP_READY_TIMEOUT_MS)
    const readyPoll = window.setInterval(() => {
      if (host.isReady()) {
        window.clearInterval(readyPoll)
        window.clearTimeout(readyTimer)
        setStatus('ready')
      }
    }, 120)

    return () => {
      window.clearInterval(readyPoll)
      window.clearTimeout(readyTimer)
      host.detach()
      if (hostRef.current === host) hostRef.current = null
    }
  }, [appId, manifest, versionId, mode, instanceId])

  // 主题热切换：只推送 token，不重建文档。
  React.useEffect(() => {
    resolvedThemeRef.current = resolvedTheme
    primaryRef.current = primary
    hostRef.current?.pushTheme()
  }, [resolvedTheme, primary])

  const reload = React.useCallback(() => setReloadCounter((n) => n + 1), [])

  return { status, errorMessage, reload, document: sandboxDocument, instanceId, frameRef }
}
