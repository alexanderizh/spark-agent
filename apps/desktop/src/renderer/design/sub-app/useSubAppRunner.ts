import React from 'react'
import { message as antdMessage } from 'antd'
import type { SubAppManifest, SubAppRelease } from '@spark/protocol'
import { useApp, type ViewId } from '../AppContext'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { buildAppRuntimeDocument } from './appRuntimeDocument'
import { SubAppBridgeHost } from './bridgeHost'
import { subAppClient } from './subAppClient'
import { buildThemeState } from './themeTokens'

/**
 * navigation 域 openView 的宿主白名单：子应用能把主窗口带到哪些视图。
 * chat 不在内——会话是用户的主工作区，应用不应抢焦点。
 */
const SUB_APP_NAVIGABLE_VIEWS: readonly ViewId[] = [
  'canvas',
  'board',
  'workflows',
  'scheduled-tasks',
  'sub-apps',
]

/**
 * 子应用沙箱文档的加载地址协议：
 * 文档由 renderer 合成后登记到主进程（`sub-app:runtime:put-doc`），再以
 * capability-asset://subapp-runtime/<token> 导航。srcdoc 会继承 renderer
 * CSP（禁内联脚本），自定义 scheme 文档不继承——这是子应用能运行的前提。
 */
export function subAppRuntimeDocUrl(token: string, version: number): string {
  return `capability-asset://subapp-runtime/${token}?v=${version}`
}

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
  /** 沙箱 iframe 导航地址；文档登记完成后置位（见 subAppRuntimeDocUrl）。 */
  frameSrc: string | null
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
  const { t, setTweak } = useApp()
  const primary = t.primary
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
    // 文档只随源码/实例变化重建；主题走 postMessage 热推送。
    [source, instanceId, appId, versionId, mode],
  )

  const [frameSrc, setFrameSrc] = React.useState<string | null>(null)
  const docVersionRef = React.useRef(0)

  // 合成文档 → 主进程登记 → capability-asset 导航地址。
  // 源码变化时复用 token 覆盖登记，并用递增 version 强制 iframe 重新加载。
  React.useEffect(() => {
    let cancelled = false
    const token = instanceId
    docVersionRef.current += 1
    const version = docVersionRef.current
    void subAppClient
      .putRuntimeDoc({ token, document: sandboxDocument })
      .then(() => {
        if (!cancelled) setFrameSrc(subAppRuntimeDocUrl(token, version))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStatus('error')
        setErrorMessage(
          `子应用运行文档登记失败：${err instanceof Error ? err.message : String(err)}`,
        )
      })
    return () => {
      cancelled = true
      void subAppClient.releaseRuntimeDoc({ token }).catch(() => {})
    }
  }, [sandboxDocument, instanceId])

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
      // ui 域：应用 toast 在宿主以 antd message 展示（带应用名前缀便于归因）
      notify: ({ type, content }) => {
        const text = `[${manifest.name}] ${content}`
        if (type === 'success') antdMessage.success(text)
        else if (type === 'error') antdMessage.error(text)
        else if (type === 'warning') antdMessage.warning(text)
        else antdMessage.info(text)
      },
      // navigation 域：openApp 走运行页；openView 只放行白名单视图
      navigate: ({ kind, id }) => {
        if (kind === 'app') {
          setTweak('subAppOpenId', id)
          setTweak('view', 'sub-app')
          return true
        }
        if (!SUB_APP_NAVIGABLE_VIEWS.includes(id as ViewId)) return false
        setTweak('view', id as ViewId)
        return true
      },
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

  return { status, errorMessage, reload, frameSrc, instanceId, frameRef }
}
