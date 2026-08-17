import { SPARK_APP_BRIDGE_INBOUND_SCHEMA, SUB_APP_PROTOCOL_VERSION } from '@spark/protocol'
import type {
  SparkAppBridgeInboundMessage,
  SparkAppBridgeOutboundMessage,
  SparkAppBridgeRequest,
  SparkAppBridgeResponse,
  SparkAppThemeState,
} from '@spark/protocol'

/** 沙箱 iframe 应用可调用的宿主 invoke 通道子集（当前只有 data 域）。 */
export type SubAppBridgeInvoke = <C extends SubAppDataChannel>(
  channel: C,
  request: SubAppDataChannelRequest<C>,
) => Promise<unknown>

export type SubAppDataChannel =
  | 'sub-app:data:get'
  | 'sub-app:data:list'
  | 'sub-app:data:upsert'
  | 'sub-app:data:delete'

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
  'sub-app:data:delete': { appId: string; namespace: string; key: string }
}

export type SubAppDataChannelRequest<C extends SubAppDataChannel> = SubAppDataChannelRequestMap[C]

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
  }
  /** 取目标 iframe 的 contentWindow；每次消息时读取，避免悬挂引用。 */
  getFrameWindow: () => Window | null
  /** data 域转发使用的 invoke（renderer 内即 window.spark.invoke）。 */
  invoke: SubAppBridgeInvoke
  /** 当前主题状态；app/ready 与 theme/get 时读取。 */
  getThemeState: () => SparkAppThemeState
  /** ui 域：宿主内展示 toast。未提供时该域返回 CAPABILITY_NOT_IMPLEMENTED。 */
  notify?: (message: { type: 'info' | 'success' | 'warning' | 'error'; content: string }) => void
  /**
   * navigation 域：宿主导航。返回 false 表示目标被宿主拒绝（如视图不在白名单）。
   * 未提供时该域返回 CAPABILITY_NOT_IMPLEMENTED。
   */
  navigate?: (target: { kind: 'app' | 'view'; id: string }) => boolean
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

  constructor(options: SubAppBridgeHostOptions) {
    this.options = options
  }

  attach(target: Window | typeof globalThis = window): void {
    target.addEventListener('message', this.handleMessage as EventListener)
  }

  detach(target: Window | typeof globalThis = window): void {
    this.detached = true
    target.removeEventListener('message', this.handleMessage as EventListener)
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
    // runtime/theme 为只读宿主信息，所有应用可用；其余能力必须显式声明。
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
    if (request.capability === 'data') {
      const payload = asRecord(request.payload)
      const namespace = readString(payload.namespace, 'namespace')
      const key = readString(payload.key, 'key')
      if (request.operation === 'get') {
        return invoke('sub-app:data:get', { appId: runtimeInfo.appId, namespace, key })
      }
      if (request.operation === 'list') {
        const limit = readOptionalNumber(payload.limit)
        const offset = readOptionalNumber(payload.offset)
        const listRequest: SubAppDataChannelRequest<'sub-app:data:list'> = {
          appId: runtimeInfo.appId,
          namespace,
        }
        if (limit !== undefined) listRequest.limit = limit
        if (offset !== undefined) listRequest.offset = offset
        return invoke('sub-app:data:list', listRequest)
      }
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
        return invoke('sub-app:data:delete', { appId: runtimeInfo.appId, namespace, key })
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
    // 已过权限检查但宿主尚未实现的能力域。
    throw new BridgeRouteError('CAPABILITY_NOT_IMPLEMENTED')
  }

  private respond(instanceId: string, response: SparkAppBridgeResponse): void {
    const frameWindow = this.options.getFrameWindow()
    if (frameWindow == null) return
    const message: SparkAppBridgeOutboundMessage = { type: 'host/response', instanceId, response }
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
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) {
    throw new BridgeRouteError(`INVALID_PAYLOAD:${label}`)
  }
  return value
}

function readOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BridgeRouteError('INVALID_PAYLOAD')
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
