import React from 'react'
import { message as antdMessage } from 'antd'
import type {
  IpcChannel,
  IpcStreamChannel,
  SessionId,
  SubAppManifest,
  SubAppRelease,
} from '@spark/protocol'
import { useApp, type ViewId } from '../AppContext'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { buildAppRuntimeDocument } from './appRuntimeDocument'
import {
  fetchSubAppRuntimeSettings,
  readCachedSubAppRuntimeSettings,
  type SubAppRuntimeSettings,
} from './subAppRuntimeSettings'
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

/** SessionSidebarContext 持久化最近活跃会话的 localStorage key。 */
const LAST_ACTIVE_SESSION_KEY = 'spark-agent:last-active-session'

/** agent 域：复用最近活跃会话；无会话或 newSession 时新建（默认 Provider）。 */
async function resolveAgentSession(newSession: boolean): Promise<SessionId> {
  if (!newSession) {
    const last = window.localStorage.getItem(LAST_ACTIVE_SESSION_KEY)
    if (last != null && last.length > 0) return last as SessionId
  }
  const { profiles } = await window.spark.invoke('provider:list', {})
  const provider =
    profiles.find((item) => item.isDefault) ?? profiles.find((item) => item.enabled !== false)
  if (provider == null) throw new Error('未配置任何 AI Provider，无法发送给 Agent。')
  const { sessionId } = await window.spark.invoke('session:create', {
    providerProfileId: provider.id,
  })
  return sessionId
}

/** 应用就绪心跳超时：超时进入错误态并给出可执行提示。 */
const SUB_APP_READY_TIMEOUT_MS = 15_000

/** 设置更新事件里属于子应用分区的 detail.key（与 SubAppRuntimeSettingsCard 广播一致）。 */
const SUB_APP_SETTINGS_UPDATED_KEY = 'sub-app'

function sameRuntimeSettings(a: SubAppRuntimeSettings, b: SubAppRuntimeSettings): boolean {
  return (
    a.allowNetworkAccess === b.allowNetworkAccess &&
    a.allowUnsafeEval === b.allowUnsafeEval &&
    a.sourceLengthLimit === b.sourceLengthLimit
  )
}

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
  // media 域实例级任务缓存：clientTaskId → repoll 所需的完整参数。
  const mediaTasksRef = React.useRef<
    Map<
      string,
      {
        projectId: string
        clientTaskId: string
        providerProfileId: string
        providerTaskId: string
        status: string
        assets: Array<{
          type: string
          url?: string
          filePath?: string
          previewDataUrl?: string
        }>
        error?: string
      }
    >
  >(new Map())

  // instanceId 只在 reload 时更换；主题变化不得重载应用。
  const instanceId = React.useMemo(
    () =>
      globalThis.crypto?.randomUUID?.() ??
      `inst-${Math.random().toString(36).slice(2)}-${Math.floor(Math.random() * 1e6)}`,
    [reloadCounter],
  )
  const versionId = release?.id ?? `draft-${appId}`

  // 运行时安全选项：localStorage 同步首屏 + IPC 权威值；设置页改动经
  // spark-settings-updated 事件热更新（文档重建 -> iframe 随版本号重载）。
  const [runtimeSecurity, setRuntimeSecurity] = React.useState<SubAppRuntimeSettings>(
    readCachedSubAppRuntimeSettings,
  )
  React.useEffect(() => {
    let cancelled = false
    void fetchSubAppRuntimeSettings().then((value) => {
      if (!cancelled)
        setRuntimeSecurity((prev) => (sameRuntimeSettings(prev, value) ? prev : value))
    })
    const onSettingsUpdated = (event: Event): void => {
      const detail = (event as CustomEvent<{ key?: string }>).detail
      if (detail?.key !== SUB_APP_SETTINGS_UPDATED_KEY) return
      setRuntimeSecurity((prev) => {
        const next = readCachedSubAppRuntimeSettings()
        return sameRuntimeSettings(prev, next) ? prev : next
      })
    }
    window.addEventListener('spark-settings-updated', onSettingsUpdated)
    return () => {
      cancelled = true
      window.removeEventListener('spark-settings-updated', onSettingsUpdated)
    }
  }, [])

  const sandboxDocument = React.useMemo(
    () =>
      buildAppRuntimeDocument({
        source,
        theme: resolvedThemeRef.current,
        config: {
          appId,
          versionId,
          instanceId,
          mode,
          surface: manifest.surface,
          trusted: true,
        },
        security: runtimeSecurity,
      }),
    // 文档只随源码/实例/surface/安全设置变化重建；主题走 postMessage 热推送。
    [source, instanceId, appId, versionId, mode, manifest.surface, runtimeSecurity],
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
        trusted: true,
      },
      getFrameWindow: () => frameRef.current?.contentWindow ?? null,
      invoke: (channel, request) => window.spark.invoke(channel, request),
      invokeIpc: (channel, request) => window.spark.invoke(channel as IpcChannel, request as never),
      subscribeIpc: (channel, callback) =>
        window.spark.on(channel as IpcStreamChannel, callback as never),
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
      // agent 域：复用最近活跃会话（无则新建）；newSession 强制新会话
      sendToAgent: async ({ prompt, newSession }) => {
        const sessionId = await resolveAgentSession(newSession === true)
        await window.spark.invoke('session:submit-turn', { sessionId, message: prompt })
        return { sessionId, delivered: true }
      },
      // media 域：异步提交画布媒体任务（合成 clientTaskId/projectId 仅供 stream 路由）
      createMediaTask: async (input) => {
        const clientTaskId = `subapp-${instanceId}-${mediaTasksRef.current.size + 1}`
        const projectId = `subapp-${appId}`
        const response = await window.spark.invoke('canvas:task:create-media', {
          operation: input.operation,
          prompt: input.prompt,
          ...(input.negativePrompt != null ? { negativePrompt: input.negativePrompt } : {}),
          ...(input.modelId != null ? { modelId: input.modelId } : {}),
          projectId,
          clientTaskId,
          waitForCompletion: false,
        })
        const status = response.status ?? 'running'
        mediaTasksRef.current.set(clientTaskId, {
          projectId,
          clientTaskId,
          providerProfileId: response.providerProfileId,
          providerTaskId: response.providerTaskId ?? '',
          status,
          assets: (response.assets ?? []).map((asset) => ({
            type: asset.type,
            ...(asset.url != null ? { url: asset.url } : {}),
            ...(asset.filePath != null ? { filePath: asset.filePath } : {}),
            ...(asset.previewDataUrl != null ? { previewDataUrl: asset.previewDataUrl } : {}),
          })),
          ...(response.error != null
            ? { error: `${response.error.code}: ${response.error.message}` }
            : {}),
        })
        return { taskId: clientTaskId, status }
      },
      // media 域：终态直接回缓存；进行中经 repoll 拉最新状态
      getMediaTask: async (taskId) => {
        const cached = mediaTasksRef.current.get(taskId)
        if (cached == null) throw new Error('未找到该媒体任务，请重新发起生成。')
        if (
          cached.status === 'succeeded' ||
          cached.status === 'failed' ||
          cached.status === 'cancelled'
        ) {
          return {
            status: cached.status,
            assets: cached.assets,
            ...(cached.error != null ? { error: cached.error } : {}),
          }
        }
        const response = await window.spark.invoke('canvas:task:repoll-media', {
          projectId: cached.projectId,
          clientTaskId: cached.clientTaskId,
          providerProfileId: cached.providerProfileId,
          providerTaskId: cached.providerTaskId,
        })
        cached.status = response.status ?? cached.status
        cached.assets = (response.assets ?? cached.assets).map((asset) => ({
          type: asset.type,
          ...(asset.url != null ? { url: asset.url } : {}),
          ...(asset.filePath != null ? { filePath: asset.filePath } : {}),
          ...(asset.previewDataUrl != null ? { previewDataUrl: asset.previewDataUrl } : {}),
        }))
        if (response.error != null)
          cached.error = `${response.error.code}: ${response.error.message}`
        return {
          status: cached.status,
          assets: cached.assets,
          ...(cached.error != null ? { error: cached.error } : {}),
        }
      },
      // canvas 域：画布状态在 renderer，经画布 API 单例读写（懒加载避免拉入画布 chunk）
      canvasRequest: async (operation, payload) => {
        const { canvasApi } = await import('../views/canvas/canvas.api')
        if (operation === 'listProjects') {
          const projects = await canvasApi.listProjects()
          return {
            projects: projects.map((project) => ({
              id: project.id,
              title: project.title,
              description: project.description,
              updatedAt: project.updatedAt,
            })),
          }
        }
        if (payload.projectId == null || payload.text == null) {
          throw new Error('appendText 需要 projectId 与 text。')
        }
        let boardId = payload.boardId ?? null
        if (boardId == null) {
          const snapshot = await canvasApi.openSnapshot(payload.projectId)
          boardId = snapshot.activeBoardId ?? snapshot.board.id
        }
        const node = await canvasApi.createTextNode({
          projectId: payload.projectId,
          boardId,
          text: payload.text,
          x: 0,
          y: 0,
        })
        return { nodeId: node.id, boardId }
      },
      // browser 域：仅放行 http/https，经宿主 shell 打开（不暴露 file:// 等）
      openExternal: async (url) => {
        let parsed: URL
        try {
          parsed = new URL(url)
        } catch {
          return false
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
        await window.spark.invoke('browser:open-external', { url: parsed.toString() })
        return true
      },
      openBrowser: async (request) => window.spark.invoke('browser:sub-app-open', request),
      inspectBrowserMedia: async (windowId) =>
        window.spark.invoke('browser:sub-app-inspect-media', { windowId }),
      downloadBrowserMedia: async (request) =>
        window.spark.invoke('browser:sub-app-download', request),
      closeBrowser: async (request) => window.spark.invoke('browser:sub-app-close', request),
      openDownloadFile: async (request) =>
        window.spark.invoke('browser:sub-app-open-download', request),
      openDownloadFolder: async () =>
        window.spark.invoke('browser:sub-app-open-download-folder', {}),
      revealDownloadFile: async (request) =>
        window.spark.invoke('browser:sub-app-reveal-download', request),
      previewDownloadFile: async (request) =>
        window.spark.invoke('browser:sub-app-preview-download', request),
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
