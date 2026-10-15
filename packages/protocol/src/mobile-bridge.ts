/**
 * 移动桥接（MobileBridge）协议。
 *
 * SparkWork 移动端（微信小程序）通过云端中继访问桌面端：
 *   - 同一 Spark 平台账号即授权（无需配对；桌面端以「授信设备」身份连中继）
 *   - 会话：项目 / 列表 / 新建 / 历史 / 提交回合 / 取消等
 *   - 流式：WebSocket 按 seq 增量推送 agent 事件
 *   - 多电脑：同一账号允许多台桌面端同时在线，调用与订阅按 deviceId 定向
 *
 * 桌面端实现：apps/desktop/src/main/services/MobileBridgeService.ts（请求处理）
 *            apps/desktop/src/main/services/MobileBridgeRelayClient.ts（中继长连接）
 * 小程序实现：apps/mobile/src/api/relay.ts + apps/mobile/src/api/bridge.ts
 */

// ─── 项目（workspace 的移动端投影） ───────────────────────────────────────────

export interface MobileBridgeProjectSummary {
  id: string
  name: string
  /** 项目根路径（未打开过文件的项目可能为空串） */
  rootPath: string
  projectKind: string
  pinnedAt: string | null
  updatedAt: string
  /** 项目下会话数（列表页角标用） */
  sessionCount: number
}

export interface MobileBridgeProjectListResponse {
  projects: MobileBridgeProjectSummary[]
  total: number
}

// ─── 会话 ─────────────────────────────────────────────────────────────────────

/** 会话运行配置摘要（列表/详情共用；移动端配置条的数据源） */
export interface MobileBridgeSessionRuntime {
  providerProfileId?: string
  modelId?: string | null
  agentAdapter?: string
  agentId?: string | null
  permissionMode?: string
  reasoningEffort?: string
  chatMode?: string
  /** 所属项目（workspace）id；'default' = 未归属 */
  projectId?: string
  /** 工作流绑定摘要（null = 未绑定） */
  workflowBinding?: { mode: 'inherit' | 'override' | 'disabled'; workflowId: string | null } | null
}

export interface MobileBridgeSessionSummary {
  id: string
  title: string
  status: string
  updatedAt: string
  /** 最近一条用户消息预览（截断） */
  preview: string
  /** 所属项目 id（project_id 即主 workspace id，'default' 表示未归属项目） */
  projectId?: string
  pinnedAt?: string | null
  /** 当前运行配置（配置条展示/回显；缺省表示桌面端旧版本） */
  runtime?: MobileBridgeSessionRuntime
}

export interface MobileBridgeSessionListResponse {
  sessions: MobileBridgeSessionSummary[]
  total: number
}

export interface MobileBridgeCreateSessionRequest {
  title?: string
  /** 创建时归属的项目（workspace）id；缺省落 default */
  projectId?: string
}

/** PATCH /v1/sessions/:id 请求体：全部可选，仅传需要修改的字段 */
export interface MobileBridgeUpdateSessionRequest {
  title?: string
  pinned?: boolean
  archived?: boolean
  // ── 运行时配置（会话内切换，与桌面端 session:update 同语义） ──
  providerProfileId?: string
  /** null = 跟随渠道默认模型 */
  modelId?: string | null
  agentAdapter?: string
  agentId?: string | null
  permissionMode?: string
  reasoningEffort?: string
  chatMode?: string
  /** 切换所属项目（workspace id） */
  projectId?: string
}

export interface MobileBridgeCreateSessionResponse {
  session: MobileBridgeSessionSummary
}

// ─── 选项目录（聊天页进入时一次拉全） ─────────────────────────────────────────

export interface MobileBridgeCatalogAgent {
  id: string
  name: string
  description: string
  agentAdapter: string
  providerProfileId?: string | null
  modelId?: string | null
  permissionMode?: string
  reasoningEffort?: string
  isDefault: boolean
}

export interface MobileBridgeCatalogWorkflow {
  id: string
  name: string
  description: string
  enabled: boolean
}

export interface MobileBridgeCatalogProvider {
  id: string
  name: string
  providerType: string
  /** 是否自动路由渠道（AutoRouter 本身不可手选单模型） */
  isAutoRouter: boolean
  models: { id: string; name: string }[]
}

export interface MobileBridgeCatalog {
  agents: MobileBridgeCatalogAgent[]
  workflows: MobileBridgeCatalogWorkflow[]
  /** 仅对话可用渠道（剔除 embedding/纯多媒体），模型选择器数据源 */
  providers: MobileBridgeCatalogProvider[]
  /** 各 adapter 合法的权限策略枚举（权限面板按当前 adapter 过滤） */
  permissionModes: Record<string, string[]>
  /** 推理强度枚举（面板滑块） */
  reasoningEfforts: string[]
}

// ─── 工作流绑定 ───────────────────────────────────────────────────────────────

export interface MobileBridgeWorkflowBindingResponse {
  binding: { mode: 'inherit' | 'override' | 'disabled'; workflowId: string | null } | null
  /** 生效摘要（inherit 时为继承来源） */
  effectiveName: string | null
  canChange: boolean
  error: string | null
}

export interface MobileBridgeSetWorkflowBindingRequest {
  mode: 'inherit' | 'override' | 'disabled'
  workflowId?: string
}

// ─── 附件 ─────────────────────────────────────────────────────────────────────

export interface MobileBridgeAttachment {
  type: 'image' | 'file'
  path: string
  name?: string
}

export interface MobileBridgeUploadAttachmentsRequest {
  files: { name: string; mimeType?: string; dataBase64: string }[]
}

export interface MobileBridgeUploadAttachmentsResponse {
  attachments: MobileBridgeAttachment[]
}

// ─── 语音转写 ─────────────────────────────────────────────────────────────────

export interface MobileBridgeTranscribeRequest {
  /** 音频 base64（wav/mp3/m4a/ogg…，桌面端 ffmpeg 解码） */
  audioBase64: string
  mimeType?: string
}

export interface MobileBridgeTranscribeResponse {
  text: string
  engine: 'local' | 'cloud'
}

// ─── 会话内定时任务（session 作用域） ──────────────────────────────────────────

export interface MobileBridgeScheduledTask {
  id: string
  name: string
  description: string
  enabled: boolean
  triggerType: 'interval' | 'cron' | 'once'
  intervalSeconds?: number | null
  cronExpression?: string | null
  runAt?: string | null
  prompt: string
  status: string
  executionCount: number
  lastRunAt?: string | null
  nextRunAt?: string | null
  lastError?: string | null
}

export interface MobileBridgeScheduledTaskListResponse {
  tasks: MobileBridgeScheduledTask[]
}

export interface MobileBridgeCreateScheduledTaskRequest {
  name: string
  prompt: string
  triggerType: 'interval' | 'cron' | 'once'
  intervalSeconds?: number
  cronExpression?: string
  runAt?: string
  /** 模型限制 LLM；缺省跟随会话当前模型 */
  modelId?: string | null
  timeoutSeconds?: number
  maxRetries?: number
}

export interface MobileBridgeUpdateScheduledTaskRequest {
  name?: string
  prompt?: string
  triggerType?: 'interval' | 'cron' | 'once'
  intervalSeconds?: number | null
  cronExpression?: string | null
  runAt?: string | null
  enabled?: boolean
}

export interface MobileBridgeScheduledTaskMutationResponse {
  task: MobileBridgeScheduledTask
}

// ─── 斜杠命令 ─────────────────────────────────────────────────────────────────

export interface MobileBridgeCommandItem {
  name: string
  description: string
  /** 命令层级（builtin/sdk/skill/custom） */
  layer: string
  usage?: string
}

export interface MobileBridgeCommandListResponse {
  commands: MobileBridgeCommandItem[]
}

export interface MobileBridgeExecuteCommandRequest {
  /** 以 / 开头的完整命令文本 */
  raw: string
}

export interface MobileBridgeExecuteCommandResponse {
  /** 命令已识别并执行（false = 不是命令，按普通消息处理） */
  isCommand: boolean
  /** true = 命令转发给 agent 执行（如技能命令），事件经流推送 */
  forwardToAgent: boolean
  message?: string
}

// ─── 回合 ─────────────────────────────────────────────────────────────────────

export interface MobileBridgeSubmitTurnRequest {
  text: string
  /** 附件路径（必须来自本服务 POST /attachments 返回的 path，拒绝任意路径注入） */
  attachmentPaths?: string[]
}

export interface MobileBridgeSubmitTurnResponse {
  turnId: string
}

export interface MobileBridgeCancelResponse {
  cancelled: boolean
}

// ─── 对话事件（AgentEvent 的移动端子集） ──────────────────────────────────────

export type MobileBridgeEventType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'agent_status'
  | 'agent_error'

export interface MobileBridgeEvent {
  id: string
  /** 会话内单调递增序号（增量同步游标） */
  seq: number
  turnId: string
  type: MobileBridgeEventType
  timestamp: string
  /** user_message / assistant_message 的文本 */
  content?: string
  /** assistant_message：增量或完整文本（delta 由端上拼接） */
  mode?: 'delta' | 'complete'
  /** assistant_message：是否为最终完整消息 */
  isFinal?: boolean
  /** 同一 turn 内assistant 文本段标识（delta 拼接键） */
  segmentId?: string
  /** tool_call / tool_result */
  toolName?: string
  toolCallId?: string
  /** tool_result 执行状态 */
  toolStatus?: 'success' | 'error'
  /** agent_status：running / idle / completed / cancelled / error */
  status?: string
  statusMessage?: string
}

export interface MobileBridgeHistoryResponse {
  sessionId: string
  events: MobileBridgeEvent[]
  /** 会话是否仍在运行（决定端上是否继续跟流） */
  running: boolean
  /**
   * 是否还有更早的历史（事件级分页，排除流式 delta）。
   * 携带 GET /messages?beforeSeq= 向上翻页；缺省 = 旧版桌面端不支持分页。
   */
  hasMore?: boolean
}

// ─── 错误 ─────────────────────────────────────────────────────────────────────

export interface MobileBridgeErrorBody {
  error: {
    code:
      | 'UNAUTHORIZED'
      | 'NOT_PAIRED'
      | 'BAD_REQUEST'
      | 'NOT_FOUND'
      | 'INTERNAL'
      | 'BRIDGE_DISABLED'
    message: string
  }
}

// ─── 授信设备（REST：小程序管理同一账号下的桌面端） ───────────────────────────

/** 账号下一台桌面端（授信设备）的信息 */
export interface MobileBridgeDeviceInfo {
  deviceId: string
  /** 展示名（桌面端主机名，连接时上报） */
  name: string
  version: string | null
  online: boolean
  lastSeenAt: string | null
  /** 首次授信时间 */
  trustedAt: string
}

export interface MobileBridgeDeviceListResponse {
  devices: MobileBridgeDeviceInfo[]
}

// ─── 桌面端设置 IPC（渲染端 ↔ 主进程；仅云端中继，局域网直连已移除） ──────────

export interface MobileBridgeIpcChannelMap {
  'mobile-bridge:get-relay-status': [{}, MobileBridgeRelayStatus]
  'mobile-bridge:update-relay-settings': [
    Partial<MobileBridgeRelaySettings>,
    MobileBridgeRelayStatus,
  ]
  /** 设备被吊销后重新授信：生成全新设备身份并立即重连 */
  'mobile-bridge:reset-relay-identity': [{}, MobileBridgeRelayStatus]
}

// ─── 云端中继（跨网络：桌面端与小程序都只连 edu-server） ───────────────────────
//
// 中继模式：桌面端**出网**连 edu-server（无需公网 IP、无需开端口），
// 小程序也连 edu-server，服务端按 userId 配对转发 → 账户即达、跨网络可用。
// 局域网直连模式已整体移除（体验版强制 https/wss + 域名白名单，真机不可用）。
//
// 多电脑：同一账号可有多台桌面端同时在线（各自持有独立授信身份）。
//   - 小程序的 req/sub 帧可带 d=<deviceId> 定向到某台桌面端；
//     缺省 d 时服务端选「主桌面端」（最近活跃的在线桌面端），兼容旧版小程序。
//   - 服务端下发的 event 帧带 d=<来源 deviceId>，订阅按 (deviceId, sessionId) 维度隔离，
//     两台电脑上同名 id 的会话不会串流。
//
// 帧协议（JSON，两端对称）：
//   → auth     桌面端连接后第一帧：设备凭据认证（deviceSecret 不走 URL query，
//              避免 nginx access log 落盘长期凭据）；通过后服务端才注册进中继
//   → hello    认证通过（收到 welcome）后发送，带设备展示名（仅可更新 label）
//   ← welcome  服务端回连接 id + 当前在线桌面端列表（对桌面端 = 认证已通过）
//   ← req      服务端→桌面端：转发小程序的调用（m=HTTP method，p=path，b=body）
//   → res      桌面端→服务端：{ id, s: HTTP 状态码, b: 响应体 }
//   → sub      小程序→服务端：订阅某会话的事件流（可带 d 定向；unsub 取消）
//   ← event    服务端→小程序：{ sessionId, d=来源设备, events }
//   ← presence 桌面端上下线时广播给该用户所有小程序连接（携带完整设备列表）
//   ↔ ping/pong
//
// ⚠️ 帧结构必须与 edu-server `src/service/mobile-bridge/relay-hub.ts` 保持一致。

export interface MobileBridgeRelaySettings {
  /** 总开关（关闭时桌面端不连中继，小程序将显示桌面端离线） */
  enabled: boolean
  /** 中继服务地址（https/wss 基址，缺省取账号服务 baseUrl） */
  baseUrl: string
}

export interface MobileBridgeRelayStatus {
  /** 中继开关 */
  enabled: boolean
  /** 实际使用的 wss 基址 */
  baseUrl: string
  /** 是否已与 edu-server 建立长连接 */
  connected: boolean
  /** 最近一次连接失败原因（连接成功时为 null） */
  lastError: string | null
  /** 服务端为该连接分配的 id */
  connectionId: string | null
  /** 服务端最近一次心跳/交互时间 */
  lastSeenAt: string | null
  /** 本机授信设备 ID（账号下的设备身份，可在小程序端管理） */
  deviceId: string | null
  /** 本机设备展示名（主机名，连接时上报；设置页展示用） */
  label: string | null
  /**
   * 设备是否被吊销（close 4403）。吊销后不再自动重连，
   * 需用户在桌面端「重新授信」（生成全新设备身份）。
   */
  revoked: boolean
}

/**
 * 单台在线桌面端的实时信息（welcome / presence / devices 携带）。
 * REST 的 MobileBridgeDeviceInfo 额外含 offline 项（授信表合并），字段语义一致。
 */
export interface MobileBridgeRelayDesktopInfo {
  deviceId: string
  label: string
  version: string | null
  online: boolean
  lastSeenAt: string | null
}

/** 旧版单桌面 presence 投影（兼容 1.1.0 小程序；新代码请用 devices 列表） */
export interface MobileBridgeRelayDesktopPresence {
  online: boolean
  deviceId: string | null
  label: string | null
  version: string | null
  lastSeenAt: string | null
}

export type MobileBridgeRelayFrame =
  | {
      /** 首帧认证：WS 建立后、任何业务帧之前发送（服务端默认 10s 未收到即断开） */
      t: 'auth'
      deviceId: string
      /** 设备密钥（授信凭据）。绝不放进 URL query，只走本帧 */
      secret: string
      label?: string
      version?: string
    }
  | {
      t: 'hello'
      deviceId?: string
      label?: string
      version?: string
    }
  | {
      t: 'welcome'
      connId: string
      /** 兼容旧版的单桌面投影（= 主桌面端） */
      desktop: MobileBridgeRelayDesktopPresence
      /** 当前该账号全部在线桌面端 */
      devices: MobileBridgeRelayDesktopInfo[]
    }
  | {
      t: 'req'
      id: string
      m: string
      p: string
      b?: unknown
      /** 目标桌面端 deviceId；缺省 = 主桌面端（最近活跃的在线桌面端） */
      d?: string
    }
  | { t: 'res'; id: string; s: number; b?: unknown }
  | {
      t: 'sub'
      sessionId: string
      /** 定向到某台桌面端；缺省 = 主桌面端 */
      d?: string
    }
  | {
      t: 'unsub'
      /** 要取消的会话；缺省 = 取消全部订阅（兼容旧版无参 unsub） */
      sessionId?: string
      d?: string
    }
  | {
      t: 'event'
      sessionId: string
      events: unknown[]
      /** 下行（→小程序）时由服务端盖上的来源桌面端 deviceId；桌面上行不带 */
      d?: string
    }
  | {
      t: 'presence'
      /** 兼容旧版的单桌面投影（= 主桌面端） */
      desktop: MobileBridgeRelayDesktopPresence
      /** 该账号全部在线桌面端（上下线、label 变化时广播） */
      devices: MobileBridgeRelayDesktopInfo[]
    }
  | { t: 'ping' }
  | { t: 'pong' }
  | { t: 'error'; code?: string; message: string }

/** 中继错误码（小程序侧据此给出可执行的提示） */
export type MobileBridgeRelayErrorCode =
  | 'DESKTOP_OFFLINE'
  | 'UNAUTHORIZED'
  | 'TIMEOUT'
  | 'BAD_REQUEST'
  | 'INTERNAL'

export const DEFAULT_MOBILE_BRIDGE_RELAY_SETTINGS: MobileBridgeRelaySettings = {
  enabled: true,
  baseUrl: '',
}
