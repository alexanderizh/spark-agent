/**
 * @module provider-export
 *
 * Provider 配置导入导出协议定义（versioned）
 *
 * 核心设计：
 *   - version 字段允许未来 schema 演进；导入端做版本校验
 *   - 导出 payload 包含 apiKey（方便迁移备份，导入时自动恢复）
 *   - 导入端对每个 profile 按 name 决定冲突处理（merge 跳过 / replace 覆盖）
 *   - 档位映射（haikuModel/sonnetModel/opusModel）随 profile 一起导出，
 *     导入时同样保留
 */

import { z } from 'zod'
import {
  MediaProviderKindSchema,
  MediaApiTypeSchema,
  MediaCapabilityIdSchema,
  ProviderMediaDefaultsSchema,
} from './media-config.js'
import { ProviderMediaModelRefSchema } from './media-model-manifest.js'
import {
  AUTO_ROUTER_PROVIDER_TYPE,
  AutoRouterConfigSchema,
  RouterReasoningEffortSchema,
} from './auto-router-config.js'
import { ProviderModelScheduleSchema } from './provider-model-schedule.js'

/**
 * 当前 schema 版本。导入时校验；不匹配则拒绝。
 *
 * 版本历史：
 *   - v1：最小渠道字段（无 apiKey）
 *   - v2：增加 apiKey（便于整机迁移备份）
 *   - v3：补齐决定请求地址与执行链路的开关（apiEndpointFullUrl / useSparkExecutor）
 *         以及模型定时禁用时段（modelSchedules）
 */
export const PROVIDER_EXPORT_VERSION = 3 as const

/**
 * 支持的导入版本白名单：v1 / v2 / v3 均可导入。
 *
 * 这里必须显式列出全部历史版本，不要写成「历史版本 + 当前常量」——那种写法在下次
 * 升版本时会把上一版静默挤出白名单，旧导出文件被误判为「版本不支持」。
 * 升到 v4 时在列表里追加 4、保留 3；导出恒用 `PROVIDER_EXPORT_VERSION`，
 * 两者是否一致由「ProviderService · 导入导出字段完整性」用例守护。
 *
 * 高于白名单的版本会在 zod 字面量处直接校验失败，避免旧版 App 静默丢弃
 * 决定请求地址的字段。
 */
export const ProviderExportVersionSchema = z.union([z.literal(1), z.literal(2), z.literal(3)])

const ProviderIconStyleSchema = z.enum(['avatar', 'mono'])
const ProviderIconConfigSchema = z.object({
  id: z.string().min(1).max(80),
  style: ProviderIconStyleSchema.default('avatar'),
})

/**
 * 导出文件中单个 profile 的 schema。
 *
 * 注意：与运行时 ProviderProfile 的差别：
 *   - apiKey 随 profile 一起导出（方便迁移备份）
 *   - 不导出 keystoreRef（导入时新建）
 *   - 不导出 createdAt（导入时新生成）
 *   - 不导出 mediaApiEndpoint / availableModelIds（仅平台受管渠道自动写入，而受管渠道不参与导出）
 *   - 不导出 mediaDynamicParamOptions（厂商同步的音色等动态候选，导入后可在渠道内一键重同步）
 *   - provider 保留 Spark 文本模型 provider kind，避免第三方 OpenAI-compatible 配置导出后丢语义
 */
export const ProviderExportProfileSchema = z.object({
  /** 源 profile id（仅作为元数据保留，导入时不复用 id） */
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  provider: z.enum([
    'anthropic',
    'openai',
    'deepseek',
    'ollama',
    'openai-compatible',
    AUTO_ROUTER_PROVIDER_TYPE,
  ]),
  /** 全局可用状态；旧版导出文件缺省时按启用处理。 */
  enabled: z.boolean().optional(),
  /** 自定义 API Endpoint；null 表示使用默认 */
  apiEndpoint: z.string().min(1).max(500).nullable(),
  /** apiEndpoint 为完整请求地址：各调用点跳过自动拼裁，原样请求 */
  apiEndpointFullUrl: z.boolean().optional(),
  /** AutoRouter 行无默认模型（恒为空串）；普通渠道始终非空。 */
  defaultModel: z.string().min(0).max(200),
  modelIds: z.array(z.string().min(1).max(200)).max(200),
  /** Provider 列表和模型配置表单里展示的图标配置 */
  providerIcon: ProviderIconConfigSchema.optional(),
  supportsMillionContext: z.boolean(),
  /** 自定义上下文窗口（tokens）；优先级高于 supportsMillionContext */
  contextWindow: z.number().int().min(0).max(10_000_000).optional(),
  /** 模型级上下文窗口（tokens）；未配置模型回落到 contextWindow */
  modelContextWindows: z
    .record(z.string().min(1).max(200), z.number().int().min(1_024).max(10_000_000))
    .optional(),
  /** 模型级设置覆盖（推理强度默认/选择器显隐）；模型级上下文见 modelContextWindows */
  modelSettings: z
    .record(
      z.string().min(1).max(200),
      z
        .object({
          reasoningEffort: RouterReasoningEffortSchema.optional(),
          hidden: z.boolean().optional(),
        })
        .strict(),
    )
    .optional(),
  /** 模型定时禁用时段（峰谷定价规避）；缺省视为无定时 */
  modelSchedules: z.array(ProviderModelScheduleSchema).max(200).optional(),
  /** 文本任务默认最大输出 tokens */
  maxTokens: z.number().int().min(0).max(10_000_000).optional(),
  isDefault: z.boolean(),
  /** 档位映射；缺失则回落 defaultModel */
  haikuModel: z.string().min(1).max(200).nullable().optional(),
  sonnetModel: z.string().min(1).max(200).nullable().optional(),
  opusModel: z.string().min(1).max(200).nullable().optional(),
  /** OpenAI/Codex API 风格 */
  codexApiKind: z.enum(['chat', 'responses', 'embedding']).optional(),
  /** 该渠道会话默认使用 Spark 执行器（自研 spark-engine） */
  useSparkExecutor: z.boolean().optional(),
  /** 模型能力类型 */
  modelType: z
    .enum(['image', 'text', 'multimodal', 'voice', 'video'])
    .optional()
    .default('multimodal'),
  /** 图片模型供应商类型 */
  imageProvider: z.string().min(1).max(80).nullable().optional(),
  /** 图片模型调用方式 */
  imageApiType: z.enum(['sync', 'async', 'auto']).nullable().optional(),
  /** 多媒体平台 adapter 种类（图片/语音/视频统一） */
  mediaProvider: MediaProviderKindSchema.nullable().optional(),
  /** 多媒体调用方式 */
  mediaApiType: MediaApiTypeSchema.nullable().optional(),
  /** 已声明支持的多媒体能力列表 */
  mediaCapabilities: z.array(MediaCapabilityIdSchema).max(20).optional(),
  /** 多媒体能力默认值 */
  mediaDefaults: ProviderMediaDefaultsSchema.optional(),
  /** 启用的多媒体模型 manifest 引用 */
  mediaModelRefs: z.array(ProviderMediaModelRefSchema).max(200).optional(),
  /** AutoRouter 行专用：完整路由配置（dispatcher + executors）。 */
  autoRouterConfig: AutoRouterConfigSchema.optional(),
  /**
   * AutoRouter 行专用：config 中引用的渠道名清单（顺序 = dispatcher 在前、
   * executors 其后），导入端据此按 name 重建本机 providerProfileId 引用。
   */
  autoRouterReferencedNames: z.array(z.string().min(1).max(100)).max(40).optional(),
  /** API Key（导出时从 Keychain 读取；导入时写入 Keychain） */
  apiKey: z.string().min(1).max(500).optional(),
})

export type ProviderExportProfile = z.infer<typeof ProviderExportProfileSchema>

/**
 * 整个导出文件 schema。
 *
 * 格式示例：
 * {
 *   "version": 3,
 *   "exportedAt": "2026-06-03T12:00:00.000Z",
 *   "exportedBy": "spark-agent",
 *   "profiles": [ { ..., "apiKey": "sk-..." }, ... ]
 * }
 */
export const ProviderExportPayloadSchema = z.object({
  version: ProviderExportVersionSchema,
  exportedAt: z.string().min(1),
  exportedBy: z.literal('spark-agent'),
  profiles: z.array(ProviderExportProfileSchema).max(500),
})

export type ProviderExportPayload = z.infer<typeof ProviderExportPayloadSchema>

/**
 * 导入结果条目。UI 用来展示"已导入 N 个，跳过 M 个"
 */
export interface ProviderImportResult {
  /** 实际写入数据库的 profile 数量 */
  imported: number
  /** 被跳过（merge 模式下 name 已存在）的 profile 数量 */
  skipped: number
  /** 单条错误信息（导入失败但未中断整个流程） */
  errors: string[]
}

/**
 * 导入模式
 *   - merge：按 name 判断，已存在则跳过
 *   - replace：按 name 判断，已存在则覆盖（更新字段但保留本地 keystoreRef）
 */
export const ProviderImportModeSchema = z.enum(['merge', 'replace'])
export type ProviderImportMode = z.infer<typeof ProviderImportModeSchema>
