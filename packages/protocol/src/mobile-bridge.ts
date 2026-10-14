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
}

export interface MobileBridgeCreateSessionResponse {
  session: MobileBridgeSessionSummary
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
