import { z } from 'zod'

/**
 * 工作流包(Workflow Bundle)协议
 *
 * `.sparkflow` = zip 容器:
 *   manifest.json      本文件 schema 的实例(包清单)
 *   workflows/<n>.json 主工作流图(WorkflowBundleWorkflowFile)
 *   skills/<slug>/…    技能目录原样打包
 *   mcp/<refId>.json   MCP 配置(密钥已替换为 {{secret:<path>}} 占位符)
 *   checksums.json     除自身外全部文件的 sha256
 *
 * 隔离约定:
 *   - bundle 技能落盘 {userData}/skills/_bundles/<bundleId>/<slug>/,DB 行 ID 为
 *     `bundle:<bundleId>:<slug>`,运行时全量技能回落(runtime-composition)必须排除该前缀。
 *   - bundle MCP 导入后 enabled=0 且挂 bundle_id,激活是显式动作。
 */

export const WORKFLOW_BUNDLE_SCHEMA_VERSION = 1
export const WORKFLOW_BUNDLE_FILE_EXTENSION = 'sparkflow'
/** bundle 技能在导入方数据库中的 ID 前缀,同时是运行时防污染回落的关键标记。 */
export const BUNDLE_SKILL_ID_PREFIX = 'bundle:'
/** 技能落盘目录:{userData}/skills/_bundles/<bundleId>/<slug>/ */
export const BUNDLE_SKILLS_DIR_NAME = '_bundles'

// ---------------------------------------------------------------------------
// 密钥占位符约定
// ---------------------------------------------------------------------------

export const WORKFLOW_BUNDLE_SECRET_PLACEHOLDER_PREFIX = '{{secret:'
export const WORKFLOW_BUNDLE_SECRET_PLACEHOLDER_SUFFIX = '}}'

/** 生成占位符,如 secretPath = "headers.X-API-Key" → "{{secret:headers.X-API-Key}}" */
export function workflowBundleSecretPlaceholder(secretPath: string): string {
  return `${WORKFLOW_BUNDLE_SECRET_PLACEHOLDER_PREFIX}${secretPath}${WORKFLOW_BUNDLE_SECRET_PLACEHOLDER_SUFFIX}`
}

/** 从占位符还原 secretPath;非占位符返回 null。 */
export function workflowBundleSecretPathFromPlaceholder(value: string): string | null {
  if (!value.startsWith(WORKFLOW_BUNDLE_SECRET_PLACEHOLDER_PREFIX)) return null
  if (!value.endsWith(WORKFLOW_BUNDLE_SECRET_PLACEHOLDER_SUFFIX)) return null
  const inner = value.slice(
    WORKFLOW_BUNDLE_SECRET_PLACEHOLDER_PREFIX.length,
    value.length - WORKFLOW_BUNDLE_SECRET_PLACEHOLDER_SUFFIX.length,
  )
  return inner.length > 0 ? inner : null
}

// ---------------------------------------------------------------------------
// 基础约束
// ---------------------------------------------------------------------------

const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, '仅允许字母数字与 . _ -')
const Sha256HexSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, '需为 64 位小写十六进制 sha256')
/** 容器内相对路径,禁止绝对路径与目录穿越。 */
const BundleRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((p) => !p.includes('\\') && !p.startsWith('/') && !p.includes('..'), '非法包内路径')

// ---------------------------------------------------------------------------
// manifest 分区
// ---------------------------------------------------------------------------

export const WorkflowBundleWorkflowEntrySchema = z.object({
  /** 容器内路径,如 "workflows/0.json" */
  file: BundleRelativePathSchema,
  name: z.string().trim().min(1).max(160),
})
export type WorkflowBundleWorkflowEntry = z.infer<typeof WorkflowBundleWorkflowEntrySchema>

export const WorkflowBundleSkillEntrySchema = z.object({
  /** 技能目录名(即技能 slug) */
  slug: SlugSchema,
  /** 容器内技能根目录,如 "skills/<slug>" */
  path: BundleRelativePathSchema,
  /** 技能目录内容的整体指纹(对目录内全部文件 sha256 的排序拼接再哈希) */
  sha256: Sha256HexSchema,
  /** 导出方环境中的原技能 ID;导入时用于改写流程图节点 skillIds 引用 */
  originSkillId: z.string().trim().min(1).max(400).optional(),
})
export type WorkflowBundleSkillEntry = z.infer<typeof WorkflowBundleSkillEntrySchema>

export const WorkflowBundleSecretSpecSchema = z.object({
  /** MCP config JSON 内的占位符位置,点分路径,如 "headers.X-API-Key" / "env.API_KEY" */
  path: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^[A-Za-z0-9_.-]+$/, '非法 secret 路径'),
  label: z.string().trim().min(1).max(160),
  required: z.boolean().default(true),
})
export type WorkflowBundleSecretSpec = z.infer<typeof WorkflowBundleSecretSpecSchema>

export const WorkflowBundleMcpTransportSchema = z.enum(['http', 'sse', 'stdio'])
export type WorkflowBundleMcpTransport = z.infer<typeof WorkflowBundleMcpTransportSchema>

export const WorkflowBundleMcpEntrySchema = z.object({
  /** 包内唯一引用 ID;导入后映射为真实 mcp_servers 行 */
  refId: SlugSchema,
  name: z.string().trim().min(1).max(160),
  transport: WorkflowBundleMcpTransportSchema,
  /** 容器内配置文件路径,如 "mcp/<refId>.json" */
  file: BundleRelativePathSchema,
  requiredSecrets: z.array(WorkflowBundleSecretSpecSchema).max(50).default([]),
  /** 导出方环境中的原 mcp_servers 行 ID;导入时用于改写流程图节点 mcpServerIds 引用 */
  originServerId: z.string().trim().min(1).max(400).optional(),
})
export type WorkflowBundleMcpEntry = z.infer<typeof WorkflowBundleMcpEntrySchema>

export const WorkflowBundleUnresolvedTypeSchema = z.enum([
  'agent',
  'rule',
  'tool',
  'skill',
  'mcp',
  'other',
])
export type WorkflowBundleUnresolvedType = z.infer<typeof WorkflowBundleUnresolvedTypeSchema>

export const WorkflowBundleUnresolvedDependencySchema = z.object({
  type: WorkflowBundleUnresolvedTypeSchema,
  /** 关联的流程图节点 id(可定位时) */
  nodeId: z.string().trim().max(200).optional(),
  name: z.string().trim().max(200).optional(),
  hint: z.string().trim().max(500).optional(),
})
export type WorkflowBundleUnresolvedDependency = z.infer<
  typeof WorkflowBundleUnresolvedDependencySchema
>

export const WorkflowBundleVerificationCheckSchema = z.object({
  id: z.string().trim().min(1).max(120),
  ok: z.boolean(),
  level: z.enum(['error', 'warn', 'info']).default('info'),
  message: z.string().trim().max(1000).optional(),
})
export type WorkflowBundleVerificationCheck = z.infer<typeof WorkflowBundleVerificationCheckSchema>

export const WorkflowBundleVerificationStatusSchema = z.enum([
  'unverified',
  'passed',
  'warned',
  'failed',
])
export type WorkflowBundleVerificationStatus = z.infer<
  typeof WorkflowBundleVerificationStatusSchema
>

export const WorkflowBundleVerificationSchema = z.object({
  status: WorkflowBundleVerificationStatusSchema.default('unverified'),
  checkedAt: z.string().trim().max(40).optional(),
  checks: z.array(WorkflowBundleVerificationCheckSchema).max(200).default([]),
})
export type WorkflowBundleVerification = z.infer<typeof WorkflowBundleVerificationSchema>

// ---------------------------------------------------------------------------
// manifest 与 checksums
// ---------------------------------------------------------------------------

export const WorkflowBundleManifestSchema = z.object({
  schemaVersion: z.literal(WORKFLOW_BUNDLE_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(160),
  version: z.string().trim().min(1).max(60).default('1.0.0'),
  author: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  exportedAt: z.string().trim().min(1).max(40),
  /** 导出来源应用版本,便于排查兼容性 */
  exportedFrom: z.string().trim().max(120).optional(),
  workflows: z.array(WorkflowBundleWorkflowEntrySchema).min(1).max(100),
  skills: z.array(WorkflowBundleSkillEntrySchema).max(200).default([]),
  mcpServers: z.array(WorkflowBundleMcpEntrySchema).max(50).default([]),
  unresolved: z.array(WorkflowBundleUnresolvedDependencySchema).max(200).default([]),
  verification: WorkflowBundleVerificationSchema.default({ status: 'unverified', checks: [] }),
})
export type WorkflowBundleManifest = z.infer<typeof WorkflowBundleManifestSchema>

export const WorkflowBundleChecksumsSchema = z.object({
  algorithm: z.literal('sha256'),
  /** path -> sha256(小写 hex);不含 checksums.json 自身 */
  files: z.record(z.string(), Sha256HexSchema),
})
export type WorkflowBundleChecksums = z.infer<typeof WorkflowBundleChecksumsSchema>

// ---------------------------------------------------------------------------
// 包内工作流文件(workflows/<n>.json)
// ---------------------------------------------------------------------------

/**
 * 主工作流图。v1 对 graph 保持形状宽松校验(要求 nodes/edges 为数组),
 * 节点/边内部结构由运行时按当前应用版本解释;结构不可执行时在「验证此包」中报错。
 */
export const WorkflowBundleWorkflowFileSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(''),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  graph: z
    .object({
      nodes: z.array(z.unknown()).max(500),
      edges: z.array(z.unknown()).max(2000),
    })
    .passthrough(),
})
export type WorkflowBundleWorkflowFile = z.infer<typeof WorkflowBundleWorkflowFileSchema>

// ---------------------------------------------------------------------------
// 导入预览 / 结果
// ---------------------------------------------------------------------------

export const WorkflowBundleImportPreviewSkillSchema = z.object({
  slug: SlugSchema,
  /** 导入后将使用的 DB 技能 ID:bundle:<bundleId>:<slug> */
  bundleSkillId: z.string().trim().min(1).max(400),
  /** 目标环境中是否已存在同名技能(slug 冲突,导入仍会装到隔离目录,仅提示) */
  nameConflict: z.boolean(),
})
export type WorkflowBundleImportPreviewSkill = z.infer<
  typeof WorkflowBundleImportPreviewSkillSchema
>

export const WorkflowBundleImportPreviewMcpSchema = z.object({
  refId: SlugSchema,
  name: z.string().trim().min(1).max(160),
  transport: WorkflowBundleMcpTransportSchema,
  requiredSecrets: z.array(WorkflowBundleSecretSpecSchema),
  /** 同名(同 scope)MCP 已存在时的处理策略提示 */
  nameConflict: z.boolean(),
})
export type WorkflowBundleImportPreviewMcp = z.infer<typeof WorkflowBundleImportPreviewMcpSchema>

export const WorkflowBundleImportPreviewSchema = z.object({
  bundleId: z.string().trim().min(1).max(200),
  manifest: WorkflowBundleManifestSchema,
  workflows: z.array(WorkflowBundleWorkflowEntrySchema),
  skills: z.array(WorkflowBundleImportPreviewSkillSchema),
  mcpServers: z.array(WorkflowBundleImportPreviewMcpSchema),
  unresolved: z.array(WorkflowBundleUnresolvedDependencySchema),
  /** 校验和/schema 硬校验结果;false 时拒绝导入 */
  integrityOk: z.boolean(),
  integrityErrors: z.array(z.string().trim().max(500)).max(100),
})
export type WorkflowBundleImportPreview = z.infer<typeof WorkflowBundleImportPreviewSchema>

export const WorkflowBundleImportOptionsSchema = z.object({
  /** 工作流导入后的 scope;缺省由导入服务决定 */
  scope: z.string().trim().max(60).optional(),
  /** 是否同时导入技能(默认 true) */
  installSkills: z.boolean().default(true),
  /** 是否导入 MCP 配置(默认 true;导入后保持 enabled=0 待激活) */
  importMcpServers: z.boolean().default(true),
  /** 同 bundleId 重复导入时的策略:重装(整包替换) */
  reinstall: z.boolean().default(false),
})
export type WorkflowBundleImportOptions = z.infer<typeof WorkflowBundleImportOptionsSchema>

export const WorkflowBundleImportResultSchema = z.object({
  bundleId: z.string().trim().min(1).max(200),
  workflowIds: z.array(z.string().trim().min(1)).max(100),
  installedSkillIds: z.array(z.string().trim().min(1)).max(200),
  importedMcpServerIds: z.array(z.string().trim().min(1)).max(50),
  unresolved: z.array(WorkflowBundleUnresolvedDependencySchema),
})
export type WorkflowBundleImportResult = z.infer<typeof WorkflowBundleImportResultSchema>

// ---------------------------------------------------------------------------
// 验证(落地后复验)
// ---------------------------------------------------------------------------

export const WorkflowBundleValidateResultSchema = z.object({
  bundleId: z.string().trim().min(1).max(200),
  status: WorkflowBundleVerificationStatusSchema,
  checks: z.array(WorkflowBundleVerificationCheckSchema),
})
export type WorkflowBundleValidateResult = z.infer<typeof WorkflowBundleValidateResultSchema>

// ---------------------------------------------------------------------------
// 包登记记录(DB workflow_bundles 行的对外形状)
// ---------------------------------------------------------------------------

export interface WorkflowBundleRecord {
  id: string
  name: string
  version: string
  author: string | null
  description: string | null
  /** 导入时保存的 manifest 快照 */
  manifest: WorkflowBundleManifest
  source: string | null
  verificationStatus: WorkflowBundleVerificationStatus
  workflowCount: number
  skillCount: number
  mcpServerCount: number
  /** 包内 MCP 的已导入行(激活/验证操作目标) */
  mcpServers: Array<{ id: string; name: string; enabled: boolean }>
  createdAt: string
  updatedAt: string
}
