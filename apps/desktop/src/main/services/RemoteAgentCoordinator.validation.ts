import { randomUUID } from 'node:crypto'
import type { RemoteAgentTaskDispatchRequest } from '@spark/protocol'
import { REMOTE_AGENT_MAX_ATTACHMENT_BYTES } from '@spark/protocol'

const MAX_TASK_TEXT_BYTES = 256 * 1024
const MAX_TASK_BODY_BYTES = 12 * 1024 * 1024
const MAX_ATTACHMENT_TOTAL_BYTES = 8 * 1024 * 1024
const MAX_ATTACHMENT_COUNT = 20
const MAX_CONTEXT_ITEMS = 100
const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface RemoteAgentDispatchInput extends RemoteAgentTaskDispatchRequest {
  taskId: string
}

export function validateDispatchInput(value: unknown): RemoteAgentDispatchInput {
  if (!isRecord(value) || !Array.isArray(value.sharedContext)) {
    throw new Error('远程任务请求格式无效')
  }
  const taskId =
    value.taskId == null ? randomUUID() : requireBoundedString(value.taskId, 'taskId', 64)
  if (!isValidRemoteAgentTaskId(taskId)) throw new Error('taskId 必须是 UUID')
  const sourceSessionId = requireBoundedString(value.sourceSessionId, 'sourceSessionId', 256)
  const targetDeviceId = requireBoundedString(value.targetDeviceId, 'targetDeviceId', 256)
  const targetProjectId = requireBoundedString(value.targetProjectId, 'targetProjectId', 256)
  const targetAgentId = requireBoundedString(value.targetAgentId, 'targetAgentId', 256)
  const instruction = requireBoundedString(value.instruction, 'instruction', MAX_TASK_TEXT_BYTES)
  if (
    !sourceSessionId.trim() ||
    !targetDeviceId.trim() ||
    !targetProjectId.trim() ||
    !targetAgentId.trim()
  ) {
    throw new Error('来源会话、目标设备、项目和 Agent 均不能为空')
  }
  if (!instruction.trim()) throw new Error('任务说明不能为空')
  if (value.sharedContext.length > MAX_CONTEXT_ITEMS) throw new Error('显式共享上下文数量超出上限')

  const context = value.sharedContext.map((item, index) => {
    if (!isRecord(item)) throw new Error(`共享上下文第 ${index + 1} 项无效`)
    const sourceMessageId = requireBoundedString(item.sourceMessageId, 'sourceMessageId', 256)
    if (!sourceMessageId.trim()) throw new Error('共享上下文缺少来源消息 ID')
    if (item.kind === 'message') {
      return {
        kind: 'message' as const,
        sourceMessageId,
        text: requireBoundedString(item.text, 'message text', MAX_TASK_TEXT_BYTES),
      }
    }
    if (item.kind !== 'attachment') throw new Error(`共享上下文第 ${index + 1} 项类型无效`)
    const name = requireBoundedString(item.name, 'attachment name', 255)
    const mimeType = requireBoundedString(item.mimeType, 'attachment mimeType', 128)
    const dataBase64 = requireBoundedString(item.dataBase64, 'attachment data', MAX_TASK_BODY_BYTES)
    const data = decodeBase64(dataBase64)
    if (!name.trim() || data.length > REMOTE_AGENT_MAX_ATTACHMENT_BYTES) {
      throw new Error('共享附件名称或大小无效')
    }
    return {
      kind: 'attachment' as const,
      sourceMessageId,
      name,
      mimeType,
      dataBase64,
      byteLength: data.length,
    }
  })
  const attachments = context.filter(
    (
      item,
    ): item is Extract<
      RemoteAgentTaskDispatchRequest['sharedContext'][number],
      { kind: 'attachment' }
    > & { byteLength: number } => item.kind === 'attachment',
  )
  if (attachments.length > MAX_ATTACHMENT_COUNT) throw new Error('单次最多共享 20 个附件')
  if (attachments.reduce((sum, item) => sum + item.byteLength, 0) > MAX_ATTACHMENT_TOTAL_BYTES) {
    throw new Error('共享附件总大小不能超过 8 MiB')
  }
  const textBytes = Buffer.byteLength(
    [instruction, ...context.flatMap((item) => (item.kind === 'message' ? [item.text] : []))].join(
      '\n',
    ),
    'utf8',
  )
  if (textBytes > MAX_TASK_TEXT_BYTES) throw new Error('任务说明与共享消息总长度超出上限')
  const sharedContext = context.map((item) => {
    if (item.kind === 'message') return item
    const { byteLength: _byteLength, ...attachment } = item
    return attachment
  })
  const request: RemoteAgentDispatchInput = {
    taskId,
    sourceSessionId,
    targetDeviceId,
    targetProjectId,
    targetAgentId,
    instruction,
    sharedContext,
  }
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_TASK_BODY_BYTES) {
    throw new Error('远程任务请求体超过 12 MiB')
  }
  return request
}

export function isValidRemoteAgentTaskId(value: string): boolean {
  return TASK_ID_PATTERN.test(value)
}

export function requireBoundedString(value: unknown, name: string, maxBytes: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${name} 无效或超出长度限制`)
  }
  return value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function decodeBase64(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('附件数据格式无效')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 0 || decoded.toString('base64') !== value) {
    throw new Error('附件数据为空或不完整')
  }
  return decoded
}
