/**
 * 移动桥接（MobileBridge）协议。
 *
 * SparkWork 移动端（微信小程序）通过本协议直连桌面端：
 *   - 配对：小程序用 edu-server 账号 token 换桌面端设备令牌（同账号即授权）
 *   - 会话：列表 / 新建 / 历史 / 提交回合 / 取消
 *   - 流式：WebSocket 按 seq 增量推送 agent 事件
 *
 * 桌面端实现：apps/desktop/src/main/services/MobileBridgeService.ts
 * 小程序实现：apps/mobile/src/api/bridge.ts
 */

// ─── 配对 ─────────────────────────────────────────────────────────────────────

export interface MobileBridgePairRequest {
  /** 小程序登录后拿到的 edu-server JWT（与桌面端同一账号体系） */
  accountToken: string
  /** 设备展示名（如 "iPhone 15 · 微信"） */
  deviceLabel?: string
}

export interface MobileBridgePairResponse {
  deviceToken: string
  deviceId: string
  desktop: {
    name: string
    version: string
  }
  account: string
}

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
}

// ─── 回合 ─────────────────────────────────────────────────────────────────────

export interface MobileBridgeSubmitTurnRequest {
  text: string
}

export interface MobileBridgeSubmitTurnResponse {
  turnId: string
}

export interface MobileBridgeCancelResponse {
  cancelled: boolean
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

// ─── 桌面端设置 IPC（渲染端 ↔ 主进程） ────────────────────────────────────────

export interface MobileBridgeSettings {
  /** 总开关（关闭时停止 HTTP/WS 服务） */
  enabled: boolean
  /** 监听端口（0 表示随机；实际端口见 status） */
  port: number
}

export interface MobileBridgePairedDevice {
  deviceId: string
  deviceLabel: string
  account: string
  pairedAt: string
  lastSeenAt: string
}

export interface MobileBridgeStatus {
  running: boolean
  /** 实际监听端口（未运行为 null） */
  port: number | null
  /** 局域网访问地址（未运行为 null） */
  localUrl: string | null
  pairedDevices: MobileBridgePairedDevice[]
  settings: MobileBridgeSettings
}

export const DEFAULT_MOBILE_BRIDGE_SETTINGS: MobileBridgeSettings = {
  enabled: false,
  port: 3721,
}

export interface MobileBridgeIpcChannelMap {
  'mobile-bridge:get-status': [{}, MobileBridgeStatus]
  'mobile-bridge:update-settings': [Partial<MobileBridgeSettings>, MobileBridgeStatus]
  'mobile-bridge:revoke-device': [{ deviceId: string }, MobileBridgeStatus]
}
