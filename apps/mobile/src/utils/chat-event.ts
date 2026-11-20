export type BridgeEventType =
  | 'user_message'
  | 'assistant_message'
  | 'agent_thinking'
  | 'tool_call'
  | 'tool_result'
  | 'agent_status'
  | 'agent_error'
  | 'presented_files'

export interface BridgeEvent {
  id: string
  seq: number
  turnId: string
  type: BridgeEventType
  timestamp: string
  content?: string
  mode?: 'delta' | 'complete'
  isFinal?: boolean
  segmentId?: string
  toolName?: string
  toolCallId?: string
  toolStatus?: 'success' | 'error'
  status?: string
  statusMessage?: string
  /** presented_files：agent 呈现的产物文件（端上按扩展名过滤图片后走本地缓存展示） */
  files?: { path: string; title?: string }[]
  /**
   * user_message：随消息提交的附件（旧版桌面端不透出，缺省 undefined）。
   * 端上渲染历史附件缩略图（图片经本地缓存解析），文件仅显名。
   */
  attachments?: { type: 'image' | 'file'; path: string; name?: string }[]
}
