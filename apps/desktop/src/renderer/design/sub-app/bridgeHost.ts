import { SPARK_APP_BRIDGE_INBOUND_SCHEMA, SUB_APP_PROTOCOL_VERSION } from '@spark/protocol'
import type {
  BrowserSubAppCloseRequest,
  BrowserSubAppCloseResponse,
  BrowserSubAppDownloadRequest,
  BrowserSubAppDownloadResponse,
  BrowserSubAppInspectMediaResponse,
  BrowserSubAppOpenDownloadRequest,
  BrowserSubAppOpenDownloadResponse,
  BrowserSubAppOpenDownloadFolderResponse,
  BrowserSubAppOpenRequest,
  BrowserSubAppOpenResponse,
  SparkAppBridgeInboundMessage,
  SparkAppBridgeOutboundMessage,
  SparkAppBridgeRequest,
  SparkAppBridgeResponse,
  SparkAppThemeState,
} from '@spark/protocol'

/** 沙箱 iframe 应用可调用的宿主 invoke 通道子集（data/files/browser 域）。 */
export type SubAppBridgeInvoke = <C extends SubAppBridgeChannel>(
  channel: C,
  request: SubAppBridgeChannelRequest<C>,
) => Promise<unknown>

/** 可信内部子应用可调用的完整宿主 IPC 面。 */
export type SubAppIpcInvoke = (channel: string, request: unknown) => Promise<unknown>

/** 可信内部子应用可订阅的宿主 stream。 */
export type SubAppIpcSubscribe = (
  channel: string,
  listener: (payload: unknown) => void,
) => () => void

export type SubAppDataChannel =
  | 'sub-app:data:get'
  | 'sub-app:data:list'
  | 'sub-app:data:upsert'
  | 'sub-app:data:delete'
  | 'sub-app:file:read'
  | 'sub-app:file:write'
  | 'sub-app:file:list'
  | 'sub-app:file:delete'

type SubAppDataChannelRequestMap = {
  'sub-app:data:get': { appId: string; namespace: string; key: string }
  'sub-app:data:list': {
    appId: string
    namespace: string
    prefix?: string
    limit?: number
    offset?: number
  }
  'sub-app:data:upsert': {
    appId: string
    namespace: string
    key: string
    value: unknown
    expectedRevision?: number
  }
  'sub-app:data:delete': {
    appId: string
    namespace: string
    key: string
    expectedRevision: number
  }
  'sub-app:file:read': { appId: string; path: string }
  'sub-app:file:write': { appId: string; path: string; content: string }
  'sub-app:file:list': { appId: string; prefix?: string }
  'sub-app:file:delete': { appId: string; path: string }
}

export type SubAppDataChannelRequest<C extends SubAppDataChannel> = SubAppDataChannelRequestMap[C]

export type SubAppBrowserChannel =
  | 'browser:sub-app-open'
  | 'browser:sub-app-inspect-media'
  | 'browser:sub-app-download'
  | 'browser:sub-app-close'
  | 'browser:sub-app-open-download'
  | 'browser:sub-app-open-download-folder'

type SubAppBrowserChannelRequestMap = {
  'browser:sub-app-open': BrowserSubAppOpenRequest
  'browser:sub-app-inspect-media': { windowId: string }
  'browser:sub-app-download': BrowserSubAppDownloadRequest
  'browser:sub-app-close': BrowserSubAppCloseRequest
  'browser:sub-app-open-download': BrowserSubAppOpenDownloadRequest
  'browser:sub-app-open-download-folder': Record<string, never>
}

export type SubAppBridgeChannel = SubAppDataChannel | SubAppBrowserChannel
export type SubAppBridgeChannelRequest<C extends SubAppBridgeChannel> = C extends SubAppDataChannel
  ? SubAppDataChannelRequest<C>
  : C extends SubAppBrowserChannel
    ? SubAppBrowserChannelRequestMap[C]
    : never

export interface SubAppBridgeHostOptions {
  /** 宿主裁决后的运行时信息；appId/versionId/instanceId 以此为准，不接受应用自报。 */
  runtimeInfo: {
    appId: string
    name: string
    description: string
    surface: string
    entry: string
    versionId: string
    instanceId: string
    mode: 'draft' | 'published'
    permissions: string[]
    /** 平台核心子应用默认开启；开启后不再按 manifest permissions 裁剪能力。 */
    trusted?: boolean
  }
  /** 取目标 iframe 的 contentWindow；每次消息时读取，避免悬挂引用。 */
  getFrameWindow: () => Window | null
  /** data 域转发使用的 invoke（renderer 内即 window.spark.invoke）。 */
  invoke: SubAppBridgeInvoke
  /** trusted 内部子应用的原始 IPC 转发。 */
  invokeIpc?: SubAppIpcInvoke
  /** trusted 内部子应用的原始 stream 订阅。 */
  subscribeIpc?: SubAppIpcSubscribe
  /** 当前主题状态；app/ready 与 theme/get 时读取。 */
  getThemeState: () => SparkAppThemeState
  /** ui 域：宿主内展示 toast。未提供时该域返回 CAPABILITY_NOT_IMPLEMENTED。 */
  notify?: (message: { type: 'info' | 'success' | 'warning' | 'error'; content: string }) => void
  /**
   * navigation 域：宿主导航。返回 false 表示目标被宿主拒绝（如视图不在白名单）。
   * 未提供时该域返回 CAPABILITY_NOT_IMPLEMENTED。
   */
  navigate?: (target: { kind: 'app' | 'view'; id: string }) => boolean
  /**
   * agent 域：把提示词交给宿主 Agent 会话执行（快捷 Agent / 桌面助手类应用）。
   * newSession=true 时宿主应新建会话而非复用最近会话。
   * 未提供时该域返回 CAPABILITY_NOT_IMPLEMENTED。
   */
  sendToAgent?: (input: {
    prompt: string
    newSession?: boolean
  }) => Promise<{ sessionId: string; delivered: boolean }>
  /**
   * media 域：提交媒体生成任务（异步，立即返回 taskId）。
   * operation 取画布媒体操作子集：text_to_image（文生图）/ text_to_video（文生视频）。
   */
  createMediaTask?: (input: {
    operation: 'text_to_image' | 'text_to_video'
    prompt: string
    negativePrompt?: string
    modelId?: string
  }) => Promise<{ taskId: string; status: string }>
  /** media 域：查询任务状态与产物（taskId 来自 createMediaTask 返回）。 */
  getMediaTask?: (taskId: string) => Promise<{
    status: string
    assets?: Array<{ type: string; url?: string; filePath?: string; previewDataUrl?: string }>
    error?: string
  }>
  /**
   * canvas 域：画布只读枚举与追加写（画布状态在 renderer，必须经宿主回调）。
   * listProjects 返回项目摘要；appendText 向指定项目追加文本节点。
   */
  canvasRequest?: (
    operation: 'listProjects' | 'appendText',
    payload: { projectId?: string; text?: string; boardId?: string },
  ) => Promise<unknown>
  /** browser 域：经宿主安全校验后打开外部链接（http/https）。返回 false 表示被拒绝。 */
  openExternal?: (url: string) => Promise<boolean>
  /** browser 域：打开可复用的持久化内置浏览器页面。 */
  openBrowser?: (request: BrowserSubAppOpenRequest) => Promise<BrowserSubAppOpenResponse>
  /** browser 域：读取页面真实 video/source 播放节点与已记录媒体请求。 */
  inspectBrowserMedia?: (windowId: string) => Promise<BrowserSubAppInspectMediaResponse>
  /** browser 域：使用该页面所属会话下载已抓取的媒体地址。 */
  downloadBrowserMedia?: (
    request: BrowserSubAppDownloadRequest,
  ) => Promise<BrowserSubAppDownloadResponse>
  /** browser 域：关闭由子应用打开的独立浏览器窗口。 */
  closeBrowser?: (request: BrowserSubAppCloseRequest) => Promise<BrowserSubAppCloseResponse>
  /** browser 域：打开 Downloads 目录中的已下载文件。 */
  openDownloadFile?: (
    request: BrowserSubAppOpenDownloadRequest,
  ) => Promise<BrowserSubAppOpenDownloadResponse>
  /** browser 域：打开系统 Downloads 目录。 */
  openDownloadFolder?: () => Promise<BrowserSubAppOpenDownloadFolderResponse>
}

export interface SubAppBridgeAuditEntry {
  at: string
  capability: string
  operation: string
  ok: boolean
  errorCode?: string
}

/** 单实例并发在途请求上限：防失序/失控应用以请求洪水拖垮宿主或 IPC。 */
const BRIDGE_MAX_IN_FLIGHT = 8

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 单个沙箱 iframe 实例的 Spark App Bridge 宿主。
 *
 * 安全顺序（不可调换）：
 *   1. event.source 必须是本实例的 iframe contentWindow；
 *   2. zod envelope 校验（instanceId/appId/versionId/protocolVersion 必须与宿主裁决一致）；
 *   3. 能力权限检查（runtime/theme 只读默认放行；其余能力需 manifest 声明）；
 *   4. 并发限流（RATE_LIMITED，可重试）；
 *   5. 操作路由；appId 强制取 runtimeInfo，payload 只提供 namespace/key/value 等。
 *
 * 审计只记录 capability/operation/ok/errorCode，不记录 payload——
 * 应用数据可能包含敏感内容，审计环不落明文。
 */
export class SubAppBridgeHost {
  private readonly options: SubAppBridgeHostOptions
  private readonly audit: SubAppBridgeAuditEntry[] = []
  private ready = false
  private detached = false
  private inFlight = 0
  private subscriptionSequence = 0
  private readonly subscriptions = new Map<string, () => void>()

  constructor(options: SubAppBridgeHostOptions) {
    this.options = options
  }

  attach(target: Window | typeof globalThis = window): void {
    target.addEventListener('message', this.handleMessage as EventListener)
  }

  detach(target: Window | typeof globalThis = window): void {
    this.detached = true
    target.removeEventListener('message', this.handleMessage as EventListener)
    for (const unsubscribe of this.subscriptions.values()) {
      try {
        unsubscribe()
      } catch {
        // 卸载阶段忽略已失效的 renderer stream 订阅。
      }
    }
    this.subscriptions.clear()
  }

  isReady(): boolean {
    return this.ready
  }

  /** 宿主主动推送主题（初始 ready 后、主题热切换时各推一次）。 */
  pushTheme(): void {
    const frameWindow = this.options.getFrameWindow()
    if (frameWindow == null) return
    const message: SparkAppBridgeOutboundMessage = {
      type: 'host/theme',
      instanceId: this.options.runtimeInfo.instanceId,
      theme: this.options.getThemeState(),
    }
    frameWindow.postMessage(message, '*')
  }

  /** 最近 200 条审计记录（观测用，宿主 UI 可读取展示）。 */
  getAuditEntries(): readonly SubAppBridgeAuditEntry[] {
    return this.audit.slice(-200)
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    if (this.detached) return
    const frameWindow = this.options.getFrameWindow()
    if (frameWindow == null || event.source !== frameWindow) return

    const parsed = SPARK_APP_BRIDGE_INBOUND_SCHEMA.safeParse(event.data)
    if (!parsed.success) return // 非法消息直接丢弃，不回发（避免被用于探测宿主）

    const message = parsed.data as SparkAppBridgeInboundMessage
    if (message.instanceId !== this.options.runtimeInfo.instanceId) return

    if (message.type === 'app/ready') {
      if (message.protocolVersion !== SUB_APP_PROTOCOL_VERSION) {
        this.respond(message.instanceId, {
          protocolVersion: SUB_APP_PROTOCOL_VERSION,
          requestId: 'ready',
          ok: false,
          retryable: false,
          error: {
            code: 'PROTOCOL_VERSION_MISMATCH',
            message: `应用协议版本 ${message.protocolVersion} 与宿主 ${SUB_APP_PROTOCOL_VERSION} 不一致，请更新应用。`,
          },
        })
        return
      }
      this.ready = true
      this.pushTheme()
      return
    }

    void this.dispatchRequest(message.request)
  }

  private async dispatchRequest(request: SparkAppBridgeRequest): Promise<void> {
    const envelopeError = this.validateEnvelope(request)
    if (envelopeError != null) {
      this.respond(request.instanceId, this.failure(request.requestId, envelopeError))
      return
    }

    const permissionError = this.checkPermission(request.capability)
    if (permissionError != null) {
      this.auditCall(request, false, permissionError.code)
      this.respond(request.instanceId, this.failure(request.requestId, permissionError))
      return
    }

    if (this.inFlight >= BRIDGE_MAX_IN_FLIGHT) {
      const error: BridgeError = {
        code: 'RATE_LIMITED',
        message: `并发请求超过 ${BRIDGE_MAX_IN_FLIGHT} 条上限，请等待在途请求完成后再试。`,
      }
      this.auditCall(request, false, error.code)
      this.respond(request.instanceId, this.failure(request.requestId, error))
      return
    }

    this.inFlight += 1
    try {
      const data = await this.route(request)
      this.auditCall(request, true)
      this.respond(request.instanceId, {
        protocolVersion: SUB_APP_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        retryable: false,
        data: data === undefined ? null : data,
      })
    } catch (error) {
      const code = readErrorCode(error)
      this.auditCall(request, false, code)
      this.respond(
        request.instanceId,
        this.failure(request.requestId, {
          code,
          message: error instanceof Error ? error.message : 'Spark App Bridge 调用失败。',
        }),
      )
    } finally {
      this.inFlight -= 1
    }
  }

  /** envelope 字段必须与宿主裁决完全一致；应用自报的 id 不被信任。 */
  private validateEnvelope(request: SparkAppBridgeRequest): BridgeError | null {
    if (request.protocolVersion !== SUB_APP_PROTOCOL_VERSION) {
      return {
        code: 'PROTOCOL_VERSION_MISMATCH',
        message: `应用协议版本 ${request.protocolVersion} 与宿主 ${SUB_APP_PROTOCOL_VERSION} 不一致。`,
      }
    }
    if (
      request.appId !== this.options.runtimeInfo.appId ||
      request.versionId !== this.options.runtimeInfo.versionId ||
      request.instanceId !== this.options.runtimeInfo.instanceId
    ) {
      return { code: 'IDENTITY_MISMATCH', message: '请求身份与当前运行实例不一致。' }
    }
    return null
  }

  private checkPermission(capability: string): BridgeError | null {
    // 平台子应用是一等内部应用：manifest permissions 仅保留为旧版本兼容字段，
    // trusted 运行时不再以它裁剪宿主能力。
    if (this.options.runtimeInfo.trusted === true) return null
    // legacy runtime/theme 为只读宿主信息，所有应用可用；其余能力必须显式声明。
    if (capability === 'runtime' || capability === 'theme') return null
    if (!this.options.runtimeInfo.permissions.includes(capability)) {
      return {
        code: 'PERMISSION_DENIED',
        message: `应用未声明 "${capability}" 权限，请在应用 manifest permissions 中申请后重新发布。`,
      }
    }
    return null
  }

  private async route(request: SparkAppBridgeRequest): Promise<unknown> {
    const { runtimeInfo, invoke, getThemeState } = this.options
    if (request.capability === 'runtime') {
      if (request.operation !== 'getInfo') throw new BridgeRouteError('UNSUPPORTED_OPERATION')
      return runtimeInfo
    }
    if (request.capability === 'theme') {
      if (request.operation !== 'get') throw new BridgeRouteError('UNSUPPORTED_OPERATION')
      return getThemeState()
    }
    if (request.capability === 'ipc') {
      return this.routeIpc(request)
    }
    if (request.capability === 'data') {
      const payload = asRecord(request.payload)
      const namespace = readString(payload.namespace, 'namespace')
      if (request.operation === 'get') {
        const key = readString(payload.key, 'key')
        return invoke('sub-app:data:get', { appId: runtimeInfo.appId, namespace, key })
      }
      if (request.operation === 'list') {
        const limit = readOptionalNumber(payload.limit)
        const offset = readOptionalNumber(payload.offset)
        const listRequest: SubAppDataChannelRequest<'sub-app:data:list'> = {
          appId: runtimeInfo.appId,
          namespace,
        }
        if (typeof payload.prefix === 'string') listRequest.prefix = payload.prefix
        if (limit !== undefined) listRequest.limit = limit
        if (offset !== undefined) listRequest.offset = offset
        return invoke('sub-app:data:list', listRequest)
      }
      const key = readString(payload.key, 'key')
      if (request.operation === 'upsert') {
        if (!('value' in payload)) throw new BridgeRouteError('INVALID_PAYLOAD')
        const upsertRequest: SubAppDataChannelRequest<'sub-app:data:upsert'> = {
          appId: runtimeInfo.appId,
          namespace,
          key,
          value: payload.value,
        }
        const expectedRevision = readOptionalNumber(payload.expectedRevision)
        if (expectedRevision !== undefined) upsertRequest.expectedRevision = expectedRevision
        return invoke('sub-app:data:upsert', upsertRequest)
      }
      if (request.operation === 'delete') {
        const expectedRevision = readRequiredPositiveNumber(
          payload.expectedRevision,
          'expectedRevision',
        )
        return invoke('sub-app:data:delete', {
          appId: runtimeInfo.appId,
          namespace,
          key,
          expectedRevision,
        })
      }
      throw new BridgeRouteError('UNSUPPORTED_OPERATION')
    }
    if (request.capability === 'ui') {
      const notify = this.options.notify
      if (notify == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
      if (request.operation !== 'toast') throw new BridgeRouteError('UNSUPPORTED_OPERATION')
      const payload = asRecord(request.payload)
      const content = readString(payload.content, 'content')
      const type = readToastType(payload.type)
      notify({ type, content })
      return null
    }
    if (request.capability === 'navigation') {
      const navigate = this.options.navigate
      if (navigate == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
      const payload = asRecord(request.payload)
      if (request.operation === 'openApp') {
        const appId = readString(payload.appId, 'appId')
        if (!UUID_PATTERN.test(appId)) throw new BridgeRouteError('INVALID_PAYLOAD:appId')
        if (!navigate({ kind: 'app', id: appId })) {
          throw new BridgeRouteError('NAVIGATION_REJECTED')
        }
        return null
      }
      if (request.operation === 'openView') {
        const view = readString(payload.view, 'view')
        if (!navigate({ kind: 'view', id: view })) {
          throw new BridgeRouteError('NAVIGATION_REJECTED')
        }
        return null
      }
      throw new BridgeRouteError('UNSUPPORTED_OPERATION')
    }
    if (request.capability === 'files') {
      const payload = asRecord(request.payload)
      // path 仅对单文件操作必填；list 只接受可选 prefix。
      if (request.operation === 'read') {
        const path = readString(payload.path, 'path')
        return invoke('sub-app:file:read', { appId: runtimeInfo.appId, path })
      }
      if (request.operation === 'write') {
        const path = readString(payload.path, 'path')
        if (typeof payload.content !== 'string') {
          throw new BridgeRouteError('INVALID_PAYLOAD:content')
        }
        return invoke('sub-app:file:write', {
          appId: runtimeInfo.appId,
          path,
          content: payload.content,
        })
      }
      if (request.operation === 'list') {
        const listRequest: SubAppDataChannelRequest<'sub-app:file:list'> = {
          appId: runtimeInfo.appId,
        }
        if (typeof payload.prefix === 'string' && payload.prefix.length > 0) {
          listRequest.prefix = payload.prefix
        }
        return invoke('sub-app:file:list', listRequest)
      }
      if (request.operation === 'delete') {
        const path = readString(payload.path, 'path')
        return invoke('sub-app:file:delete', { appId: runtimeInfo.appId, path })
      }
      throw new BridgeRouteError('UNSUPPORTED_OPERATION')
    }
    if (request.capability === 'agent') {
      const sendToAgent = this.options.sendToAgent
      if (sendToAgent == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
      if (request.operation !== 'send') throw new BridgeRouteError('UNSUPPORTED_OPERATION')
      const payload = asRecord(request.payload)
      const prompt = readString(payload.prompt, 'prompt')
      const newSession = payload.newSession === true
      return sendToAgent({ prompt, ...(newSession ? { newSession: true } : {}) })
    }
    if (request.capability === 'media') {
      const payload = asRecord(request.payload)
      if (request.operation === 'generate') {
        // payload 校验先于实现存在性检查：非法输入无论宿主是否实现都报 INVALID_PAYLOAD
        const operation = readMediaOperation(payload.operation)
        const prompt = readString(payload.prompt, 'prompt')
        const createMediaTask = this.options.createMediaTask
        if (createMediaTask == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
        const request2: {
          operation: 'text_to_image' | 'text_to_video'
          prompt: string
          negativePrompt?: string
          modelId?: string
        } = { operation, prompt }
        if (typeof payload.negativePrompt === 'string' && payload.negativePrompt.length > 0) {
          request2.negativePrompt = payload.negativePrompt
        }
        if (typeof payload.modelId === 'string' && payload.modelId.length > 0) {
          request2.modelId = payload.modelId
        }
        return createMediaTask(request2)
      }
      if (request.operation === 'get') {
        const getMediaTask = this.options.getMediaTask
        if (getMediaTask == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
        return getMediaTask(readString(payload.taskId, 'taskId'))
      }
      throw new BridgeRouteError('UNSUPPORTED_OPERATION')
    }
    if (request.capability === 'canvas') {
      const canvasRequest = this.options.canvasRequest
      if (canvasRequest == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
      const payload = asRecord(request.payload)
      if (request.operation === 'listProjects') {
        return canvasRequest('listProjects', {})
      }
      if (request.operation === 'appendText') {
        const projectId = readString(payload.projectId, 'projectId')
        const text = readString(payload.text, 'text')
        const appendPayload: { projectId: string; text: string; boardId?: string } = {
          projectId,
          text,
        }
        if (typeof payload.boardId === 'string' && payload.boardId.length > 0) {
          appendPayload.boardId = payload.boardId
        }
        return canvasRequest('appendText', appendPayload)
      }
      throw new BridgeRouteError('UNSUPPORTED_OPERATION')
    }
    if (request.capability === 'browser') {
      const payload = asRecord(request.payload)
      if (request.operation === 'openUrl') {
        const openExternal = this.options.openExternal
        if (openExternal == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
        const url = readHttpUrl(payload.url, 'url')
        const opened = await openExternal(url)
        if (!opened) throw new BridgeRouteError('NAVIGATION_REJECTED')
        return { opened: true }
      }
      if (request.operation === 'open') {
        const openBrowser = this.options.openBrowser
        if (openBrowser == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
        const request2: BrowserSubAppOpenRequest = {
          url: readHttpUrl(payload.url, 'url'),
          ...(typeof payload.profileId === 'string' ? { profileId: payload.profileId } : {}),
          ...(typeof payload.reuse === 'boolean' ? { reuse: payload.reuse } : {}),
          ...(typeof payload.show === 'boolean' ? { show: payload.show } : {}),
          ...(payload.backend === 'system' ||
          payload.backend === 'internal' ||
          payload.backend === 'auto'
            ? { backend: payload.backend }
            : {}),
        }
        return openBrowser(request2)
      }
      if (request.operation === 'inspectMedia') {
        const inspectBrowserMedia = this.options.inspectBrowserMedia
        if (inspectBrowserMedia == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
        return inspectBrowserMedia(readString(payload.windowId, 'windowId'))
      }
      if (request.operation === 'download') {
        const downloadBrowserMedia = this.options.downloadBrowserMedia
        if (downloadBrowserMedia == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
        const request2: BrowserSubAppDownloadRequest = {
          windowId: readString(payload.windowId, 'windowId'),
          url: readHttpUrl(payload.url, 'url'),
          ...(typeof payload.filename === 'string' ? { filename: payload.filename } : {}),
        }
        return downloadBrowserMedia(request2)
      }
      if (request.operation === 'close') {
        const closeBrowser = this.options.closeBrowser
        if (closeBrowser == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
        return closeBrowser({ windowId: readString(payload.windowId, 'windowId') })
      }
      if (request.operation === 'openDownload') {
        const openDownloadFile = this.options.openDownloadFile
        if (openDownloadFile == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
        return openDownloadFile({ filePath: readString(payload.filePath, 'filePath') })
      }
      if (request.operation === 'openDownloadFolder') {
        const openDownloadFolder = this.options.openDownloadFolder
        if (openDownloadFolder == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
        return openDownloadFolder()
      }
      throw new BridgeRouteError('UNSUPPORTED_OPERATION')
    }
    // 已过权限检查但宿主尚未实现的能力域。
    throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
  }

  private routeIpc(request: SparkAppBridgeRequest): unknown | Promise<unknown> {
    const payload = asRecord(request.payload)
    if (request.operation === 'invoke') {
      const invokeIpc = this.options.invokeIpc
      if (invokeIpc == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
      const channel = readIpcInvokeChannel(payload.channel)
      return invokeIpc(channel, payload.request === undefined ? null : payload.request)
    }
    if (request.operation === 'subscribe') {
      const subscribeIpc = this.options.subscribeIpc
      if (subscribeIpc == null) throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
      const channel = readIpcStreamChannel(payload.channel)
      const subscriptionId = `${this.options.runtimeInfo.instanceId}-sub-${++this.subscriptionSequence}`
      const unsubscribe = subscribeIpc(channel, (eventPayload) => {
        this.pushEvent(subscriptionId, channel, eventPayload)
      })
      this.subscriptions.set(subscriptionId, unsubscribe)
      return { subscriptionId, channel }
    }
    if (request.operation === 'unsubscribe') {
      const subscriptionId = readStringMax(payload.subscriptionId, 'subscriptionId', 160)
      const unsubscribe = this.subscriptions.get(subscriptionId)
      if (unsubscribe == null) return { unsubscribed: false }
      this.subscriptions.delete(subscriptionId)
      unsubscribe()
      return { unsubscribed: true }
    }
    throw new BridgeRouteError('UNSUPPORTED_OPERATION')
  }

  private respond(instanceId: string, response: SparkAppBridgeResponse): void {
    const frameWindow = this.options.getFrameWindow()
    if (frameWindow == null) return
    const message: SparkAppBridgeOutboundMessage = { type: 'host/response', instanceId, response }
    frameWindow.postMessage(message, '*')
  }

  private pushEvent(subscriptionId: string, channel: string, payload: unknown): void {
    if (this.detached) return
    const frameWindow = this.options.getFrameWindow()
    if (frameWindow == null) return
    const message: SparkAppBridgeOutboundMessage = {
      type: 'host/event',
      instanceId: this.options.runtimeInfo.instanceId,
      subscriptionId,
      channel,
      payload,
    }
    frameWindow.postMessage(message, '*')
  }

  private failure(requestId: string, error: BridgeError): SparkAppBridgeResponse {
    return {
      protocolVersion: SUB_APP_PROTOCOL_VERSION,
      requestId,
      ok: false,
      // UNKNOWN（宿主瞬时故障）与 RATE_LIMITED（并发限流）值得应用侧重试；
      // 权限/身份/协议/参数类错误重试无意义。
      retryable: error.code === 'UNKNOWN' || error.code === 'RATE_LIMITED',
      error: { code: error.code, message: error.message },
    }
  }

  private auditCall(request: SparkAppBridgeRequest, ok: boolean, errorCode?: string): void {
    this.audit.push({
      at: new Date().toISOString(),
      capability: request.capability,
      operation: request.operation,
      ok,
      ...(errorCode !== undefined ? { errorCode } : {}),
    })
    if (this.audit.length > 400) this.audit.splice(0, this.audit.length - 200)
  }
}

interface BridgeError {
  code: string
  message: string
}

class BridgeRouteError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'BridgeRouteError'
    this.code = code
  }
}

function readErrorCode(error: unknown): string {
  if (error instanceof BridgeRouteError) return error.code
  if (error != null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  // contextBridge 克隆会丢自定义属性，但 name 保留——preload 把 IPC 错误码
  // 编码为 `SparkIpcError:<code>`，从这里恢复。
  if (error instanceof Error) {
    const match = /^SparkIpcError:([A-Z_]+)$/.exec(error.name)
    if (match != null) return match[1] ?? 'UNKNOWN'
  }
  return 'UNKNOWN'
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BridgeRouteError('INVALID_PAYLOAD')
  }
  return value as Record<string, unknown>
}

function readString(value: unknown, label: string): string {
  return readStringMax(value, label, 240)
}

function readStringMax(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new BridgeRouteError(`INVALID_PAYLOAD:${label}`)
  }
  return value
}

function readHttpUrl(value: unknown, label: string): string {
  const text = readStringMax(value, label, 20_000)
  try {
    const parsed = new URL(text)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    return parsed.toString()
  } catch {
    throw new BridgeRouteError(`INVALID_PAYLOAD:${label}`)
  }
}

function readIpcInvokeChannel(value: unknown): string {
  const channel = readStringMax(value, 'channel', 160)
  if (channel.startsWith('stream:')) {
    throw new BridgeRouteError('INVALID_PAYLOAD:channel')
  }
  return channel
}

function readIpcStreamChannel(value: unknown): string {
  const channel = readStringMax(value, 'channel', 160)
  if (!channel.startsWith('stream:')) {
    throw new BridgeRouteError('INVALID_PAYLOAD:channel')
  }
  return channel
}

function readOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BridgeRouteError('INVALID_PAYLOAD')
  }
  return value
}

function readRequiredPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new BridgeRouteError(`INVALID_PAYLOAD:${label}`)
  }
  return value
}

const TOAST_TYPES = new Set(['info', 'success', 'warning', 'error'])

function readToastType(value: unknown): 'info' | 'success' | 'warning' | 'error' {
  if (value === undefined || value === null) return 'info'
  if (typeof value !== 'string' || !TOAST_TYPES.has(value)) {
    throw new BridgeRouteError('INVALID_PAYLOAD:type')
  }
  return value as 'info' | 'success' | 'warning' | 'error'
}

/** media 域生成操作白名单：只放开纯文本生成，输入文件类操作不暴露给子应用。 */
const MEDIA_OPERATIONS = new Set(['text_to_image', 'text_to_video'])

function readMediaOperation(value: unknown): 'text_to_image' | 'text_to_video' {
  if (typeof value !== 'string' || !MEDIA_OPERATIONS.has(value)) {
    throw new BridgeRouteError('INVALID_PAYLOAD:operation')
  }
  return value as 'text_to_image' | 'text_to_video'
}
