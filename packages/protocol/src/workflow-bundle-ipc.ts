import { z } from 'zod'
import {
  WorkflowBundleImportOptionsSchema,
  type WorkflowBundleImportOptions,
  type WorkflowBundleImportPreview,
  type WorkflowBundleImportResult,
  type WorkflowBundleManifest,
  type WorkflowBundleRecord,
  type WorkflowBundleValidateResult,
} from './workflow-bundle.js'

// ---------------------------------------------------------------------------
// 通道映射(workflow-bundle:*)
// ---------------------------------------------------------------------------

export interface WorkflowBundleListRequest {
  query?: string
}
export interface WorkflowBundleListResponse {
  bundles: WorkflowBundleRecord[]
}

export interface WorkflowBundleExportRequest {
  /** 要打包的工作流 id 列表;空数组 = 全部 */
  workflowIds: string[]
  /** 保存目标 .sparkflow 绝对路径(renderer 已通过 dialog:save-file 获取) */
  outputPath: string
  /** 包显示名;缺省用 "workflows-<日期>" */
  name?: string
}
export interface WorkflowBundleExportResponse {
  outputPath: string
  manifest: WorkflowBundleManifest
  /** 打包文件字节数 */
  sizeBytes: number
}

export interface WorkflowBundlePreviewImportRequest {
  filePath: string
}
export interface WorkflowBundlePreviewImportResponse {
  preview: WorkflowBundleImportPreview
}

export interface WorkflowBundleImportRequest {
  filePath: string
  options?: Partial<WorkflowBundleImportOptions>
}
export interface WorkflowBundleImportResponse {
  result: WorkflowBundleImportResult
}

export interface WorkflowBundleValidateRequest {
  bundleId: string
}
export interface WorkflowBundleValidateResponse {
  result: WorkflowBundleValidateResult
}

export interface WorkflowBundleUninstallRequest {
  bundleId: string
}
export interface WorkflowBundleUninstallResponse {
  uninstalled: boolean
}

export interface WorkflowBundleActivateMcpRequest {
  bundleId: string
  /** 已导入的 mcp_servers 行 id */
  mcpServerId: string
}
export interface WorkflowBundleActivateMcpResponse {
  started: boolean
  /** 仍有占位符未补齐的密钥路径;非空时不启动 */
  missingSecrets: string[]
}

export interface WorkflowBundleIpcChannelMap {
  'workflow-bundle:list': [WorkflowBundleListRequest, WorkflowBundleListResponse]
  'workflow-bundle:export': [WorkflowBundleExportRequest, WorkflowBundleExportResponse]
  'workflow-bundle:preview-import': [
    WorkflowBundlePreviewImportRequest,
    WorkflowBundlePreviewImportResponse,
  ]
  'workflow-bundle:import': [WorkflowBundleImportRequest, WorkflowBundleImportResponse]
  'workflow-bundle:validate': [WorkflowBundleValidateRequest, WorkflowBundleValidateResponse]
  'workflow-bundle:uninstall': [WorkflowBundleUninstallRequest, WorkflowBundleUninstallResponse]
  'workflow-bundle:activate-mcp': [
    WorkflowBundleActivateMcpRequest,
    WorkflowBundleActivateMcpResponse,
  ]
}

// ---------------------------------------------------------------------------
// zod schema(接入 IpcSchemaRegistry)
// ---------------------------------------------------------------------------

const idListSchema = z.array(z.string().trim().min(1).max(200)).max(200)

/** 按 typedIpcHandle 惯例仅校验入参;无参通道(list)不注册 schema,校验自动跳过。 */
export const WorkflowBundleIpcSchemaRegistry = {
  'workflow-bundle:export': z.object({
    workflowIds: idListSchema,
    outputPath: z.string().trim().min(1).max(1000),
    name: z.string().trim().min(1).max(160).optional(),
  }),
  'workflow-bundle:preview-import': z.object({
    filePath: z.string().trim().min(1).max(1000),
  }),
  'workflow-bundle:import': z.object({
    filePath: z.string().trim().min(1).max(1000),
    options: WorkflowBundleImportOptionsSchema.partial().optional(),
  }),
  'workflow-bundle:validate': z.object({ bundleId: z.string().trim().min(1).max(200) }),
  'workflow-bundle:uninstall': z.object({ bundleId: z.string().trim().min(1).max(200) }),
  'workflow-bundle:activate-mcp': z.object({
    bundleId: z.string().trim().min(1).max(200),
    mcpServerId: z.string().trim().min(1).max(200),
  }),
}
