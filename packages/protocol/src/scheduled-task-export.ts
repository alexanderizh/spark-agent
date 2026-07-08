/**
 * @module scheduled-task-export
 *
 * 定时任务导入导出协议定义（versioned）
 *
 * 设计：
 *   - 与 Provider 导入导出协议一致：version 字段允许未来 schema 演进
 *   - 按 name 去重（运行时 id 是 Date.now() + random，不保证稳定）
 *   - 不导出运行时统计字段（executionCount/successCount/failureCount/lastRunAt/nextRunAt/lastError/status/currentExecutionId）
 *     这些会在导入后由调度器重新生成
 *   - 不导出 createdAt/updatedAt（导入时新生成）
 */

import { z } from 'zod'

/** 当前 schema 版本。导入时校验；不匹配则拒绝 */
export const SCHEDULED_TASK_EXPORT_VERSION = 1 as const

/** 支持的版本范围：仅 v1 */
export const ScheduledTaskExportVersionSchema = z.literal(SCHEDULED_TASK_EXPORT_VERSION)

// ─── Sub-Schemas ─────────────────────────────────────────────────────────────

const ScheduledTaskExportTriggerSchema = z.enum(['interval', 'cron', 'once'])

const ScheduledTaskExportNotificationSchema = z.object({
  id: z.string().min(1).max(200),
  url: z.string().min(1).max(2000),
  triggers: z.array(z.enum(['onSuccess', 'onFailure', 'onRetry', 'onDisabled'])).max(20),
  headers: z.record(z.string()).optional(),
  bodyTemplate: z.string().max(10000).optional(),
})

/**
 * 导出文件中单个任务的 schema。
 *
 * 必填字段：与 ScheduledTaskCreateRequest 对齐
 * 排除字段：id（导入时新建）、运行时统计字段
 */
export const ScheduledTaskExportTaskSchema = z.object({
  /** 源任务 name（仅作为元数据保留；导入时按 name 判断冲突） */
  name: z.string().min(1).max(200),
  description: z.string().max(2000),
  enabled: z.boolean(),
  triggerType: ScheduledTaskExportTriggerSchema,
  intervalSeconds: z.number().int().min(10).max(86400 * 365).nullable(),
  cronExpression: z.string().min(1).max(200).nullable(),
  runAt: z.string().min(1).nullable(),
  timezone: z.string().min(1).max(100),
  startAt: z.string().min(1).nullable(),
  endAt: z.string().min(1).nullable(),
  maxExecutions: z.number().int().min(0).max(1_000_000),
  agentId: z.string().min(1).max(200).nullable(),
  teamId: z.string().min(1).max(200).nullable(),
  modelId: z.string().min(1).max(200).nullable(),
  workspaceId: z.string().min(1).max(200).nullable(),
  promptTemplate: z.string().min(1).max(100_000),
  permissionMode: z.string().min(1).max(50),
  permissionProfileId: z.string().min(1).max(200).nullable(),
  timeoutSeconds: z.number().int().min(10).max(86400),
  maxRetries: z.number().int().min(0).max(100),
  retryDelaySeconds: z.number().int().min(0).max(86400),
  retryBackoff: z.enum(['fixed', 'linear', 'exponential']),
  notifications: z.array(ScheduledTaskExportNotificationSchema).max(50),
  concurrencyPolicy: z.enum(['skip', 'queue', 'cancel']),
  tags: z.array(z.string().min(1).max(80)).max(50),
  historyRetentionDays: z.number().int().min(1).max(3650),
})

export type ScheduledTaskExportTask = z.infer<typeof ScheduledTaskExportTaskSchema>

/**
 * 整个导出文件 schema。
 *
 * 格式示例：
 * {
 *   "version": 1,
 *   "exportedAt": "2026-06-09T12:00:00.000Z",
 *   "exportedBy": "spark-agent",
 *   "tasks": [ { "name": "...", "triggerType": "interval", ... } ]
 * }
 */
export const ScheduledTaskExportPayloadSchema = z.object({
  version: ScheduledTaskExportVersionSchema,
  exportedAt: z.string().min(1),
  exportedBy: z.literal('spark-agent'),
  tasks: z.array(ScheduledTaskExportTaskSchema).max(500),
})

export type ScheduledTaskExportPayload = z.infer<typeof ScheduledTaskExportPayloadSchema>

/**
 * 导入结果。UI 用来展示「已导入 N 个，跳过 M 个」等
 */
export interface ScheduledTaskImportResult {
  /** 实际写入数据库的任务数量（包含 replace 模式更新 + 新建） */
  imported: number
  /** 被跳过（merge 模式下 name 已存在）的任务数量 */
  skipped: number
  /** 单条错误信息（导入失败但未中断整个流程） */
  errors: string[]
}

/**
 * 导入模式
 *   - merge：按 name 判断，已存在则跳过
 *   - replace：按 name 判断，已存在则覆盖（更新字段、保留运行时统计）
 */
export const ScheduledTaskImportModeSchema = z.enum(['merge', 'replace'])
export type ScheduledTaskImportMode = z.infer<typeof ScheduledTaskImportModeSchema>