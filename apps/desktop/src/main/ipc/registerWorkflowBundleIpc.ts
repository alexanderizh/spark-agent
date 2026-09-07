/**
 * 工作流包(.sparkflow)导入导出 IPC。
 *
 * 导出:renderer 先经 dialog:save-file 取目标路径,再调 workflow-bundle:export 打包落盘。
 * 导入:preview-import 只读校验并返回依赖预览;import 落地到隔离空间
 *      (bundle: 前缀技能 + workflows/mcp_servers.bundle_id 标记 + MCP 默认禁用)。
 */

import { createLogger } from '@spark/shared'
import type { McpService } from '@spark/agent-runtime'
import {
  McpServerRepository,
  SkillRepository,
  WorkflowBundleRepository,
  WorkflowRepository,
} from '@spark/storage'
import { WorkflowBundleService } from '@spark/agent-runtime'
import { getAppSkillsManager } from '../services/AppSkillsManager.js'
import { getDatabase } from '../db.js'
import { typedIpcHandle } from './typed-ipc.js'

const log = createLogger('workflow-bundle-ipc')

let _bundleService: WorkflowBundleService | null = null
function getWorkflowBundleService(getMcpService: () => McpService): WorkflowBundleService {
  if (_bundleService == null) {
    const db = getDatabase()
    _bundleService = new WorkflowBundleService(
      new WorkflowRepository(db),
      new SkillRepository(db),
      new McpServerRepository(db),
      new WorkflowBundleRepository(db),
      getAppSkillsManager().userDir,
      getMcpService(),
    )
  }
  return _bundleService
}

export function registerWorkflowBundleIpc(deps: { getMcpService: () => McpService }): void {
  const service = () => getWorkflowBundleService(deps.getMcpService)

  typedIpcHandle('workflow-bundle:list', async (req) => {
    return { bundles: service().listBundles(req?.query) }
  })

  typedIpcHandle('workflow-bundle:export', async (req) => {
    log.info(`export bundle: ${req.workflowIds.length} workflow(s) -> ${req.outputPath}`)
    return await service().exportBundle({
      workflowIds: req.workflowIds,
      outputPath: req.outputPath,
      ...(req.name !== undefined ? { name: req.name } : {}),
    })
  })

  typedIpcHandle('workflow-bundle:preview-import', async (req) => {
    return { preview: await service().previewImport(req.filePath) }
  })

  typedIpcHandle('workflow-bundle:import', async (req) => {
    log.info(`import bundle from ${req.filePath}`)
    return { result: await service().importBundle(req.filePath, req.options) }
  })

  typedIpcHandle('workflow-bundle:validate', async (req) => {
    return { result: await service().validateBundle(req.bundleId) }
  })

  typedIpcHandle('workflow-bundle:uninstall', async (req) => {
    log.info(`uninstall bundle ${req.bundleId}`)
    return { uninstalled: await service().uninstallBundle(req.bundleId) }
  })

  typedIpcHandle('workflow-bundle:activate-mcp', async (req) => {
    return await service().activateMcp(req.bundleId, req.mcpServerId)
  })
}
