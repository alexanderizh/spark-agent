/**
 * Custom Tools（低代码自定义工具）IPC 注册
 *
 * 方案：docs/plans/2026-08-16-custom-tools-platform.md §4
 * 协议/服务/存储（084_custom_tools.sql）均已就绪，本文件补齐主进程接线：
 * CRUD、密钥写入状态、测试运行与导入导出；变更通过
 * stream:custom-tools:changed 广播，驱动渲染层刷新与 mcp 工具面失效。
 */

import { CustomToolService, routeProviderVisionAttachments } from '@spark/agent-runtime'
import { toCustomToolSummary } from '@spark/protocol'
import { basename } from 'node:path'
import { getDatabase } from '../db.js'
import { typedIpcHandle, pushStreamEvent } from './typed-ipc.js'

let customToolService: CustomToolService | null = null

export function getCustomToolService(): CustomToolService {
  if (customToolService == null) {
    const service = new CustomToolService(getDatabase())
    service.onChange((event) => {
      pushStreamEvent('stream:custom-tools:changed', event)
    })
    customToolService = service
  }
  return customToolService
}

export function registerCustomToolsIpc(): void {
  const service = getCustomToolService()

  typedIpcHandle('custom-tools:list', async (req) => ({
    tools: service.list(req.query),
  }))

  typedIpcHandle('custom-tools:get', async (req) => ({
    tool: await service.get(req.id),
  }))

  typedIpcHandle('custom-tools:create', async (req) => ({
    tool: toCustomToolSummary(await service.create(req.spec)),
  }))

  typedIpcHandle('custom-tools:update', async (req) => ({
    tool: toCustomToolSummary(await service.update(req.id, req.spec)),
  }))

  typedIpcHandle('custom-tools:delete', async (req) => {
    await service.delete(req.id)
    return { ok: true }
  })

  typedIpcHandle('custom-tools:set-enabled', async (req) => ({
    tool: toCustomToolSummary(await service.setEnabled(req.id, req.enabled)),
  }))

  typedIpcHandle('custom-tools:test-run', async (req) => ({
    result: await service.testRun({
      ...(req.toolId != null ? { toolId: req.toolId } : {}),
      ...(req.draftSpec != null ? { draftSpec: req.draftSpec } : {}),
      input: req.input,
    }),
  }))

  typedIpcHandle('custom-tools:host-vision-route-check', async (req) => {
    const route = await routeProviderVisionAttachments({
      database: getDatabase(),
      modelType: 'text',
      message: req.question,
      attachments: req.imagePaths.map((filePath) => ({
        type: 'image' as const,
        path: filePath,
        name: basename(filePath),
      })),
      sessionId: 'tool-studio-host-route-check',
      invocationSource: 'direct',
      recordSession: false,
      runtime: service,
    })
    return {
      result: {
        ok: route.status === 'succeeded',
        finalAnswerVerified: false,
        reason: 'text-model-with-image-attachments',
        ...(route.toolId != null ? { selectedToolId: route.toolId } : {}),
        ...(route.toolTitle != null ? { selectedToolTitle: route.toolTitle } : {}),
        ...(route.traceId != null ? { traceId: route.traceId } : {}),
        imageCount: route.imageCount ?? req.imagePaths.length,
        ...(route.durationMs != null ? { durationMs: route.durationMs } : {}),
        ...(route.targetOrigin != null ? { targetOrigin: route.targetOrigin } : {}),
        ...(route.model != null ? { model: route.model } : {}),
        ...(route.errorCode != null ? { errorCode: route.errorCode } : {}),
      },
    }
  })

  typedIpcHandle('custom-tools:write-secret', async (req) => {
    await service.writeSecret(req.id, req.name, req.value)
    return { ok: true }
  })

  typedIpcHandle('custom-tools:has-secret', async (req) => ({
    secrets: await service.secretStatus(req.id),
  }))

  typedIpcHandle('custom-tools:export', async (req) => ({
    payload: service.export(req.ids),
  }))

  typedIpcHandle('custom-tools:import', async (req) => {
    const result = await service.import(req.payload)
    return {
      imported: result.imported,
      skipped: result.skipped,
    }
  })

  typedIpcHandle('custom-tools:studio:get', async (req) => ({
    workspace: await service.getWorkspace(req.id),
  }))

  typedIpcHandle('custom-tools:draft:create', async (req) => ({
    workspace: await service.createDraft(req.spec),
  }))

  typedIpcHandle('custom-tools:draft:save', async (req) => ({
    workspace: await service.saveDraft(req.id, req.spec),
  }))

  typedIpcHandle('custom-tools:publish', async (req) => ({
    workspace: await service.publish(req.id, req.expectedDraftVersion),
  }))

  typedIpcHandle('custom-tools:rollback', async (req) => ({
    workspace: await service.rollback(req.id, req.version),
  }))

  typedIpcHandle('custom-tools:invocations:list', async (req) => ({
    traces: service.listInvocations(req),
    retentionDays: service.getInvocationRetentionDays(),
  }))

  typedIpcHandle('custom-tools:invocations:retention:set', async (req) =>
    service.setInvocationRetentionDays(req.retentionDays),
  )

  typedIpcHandle('custom-tools:invocations:clear', async (req) => ({
    deleted: service.clearInvocations(req.toolId),
  }))
}
