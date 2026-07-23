import { z } from 'zod'
import {
  CanvasWorkflowPackageSchema,
  type CanvasWorkflowDefinition,
  type CanvasWorkflowPackage,
} from '@spark/protocol'

export interface CanvasWorkflowTransferPayload {
  name: string
  description: string | null
  tags: string[]
  package: CanvasWorkflowPackage
}

export interface CanvasWorkflowExportEnvelope {
  exportVersion: 1
  exportedAt: string
  workflow: CanvasWorkflowTransferPayload
}

const TransferPayloadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  package: CanvasWorkflowPackageSchema,
})

export function buildCanvasWorkflowExport(
  workflow: CanvasWorkflowDefinition,
  exportedAt = new Date().toISOString(),
): CanvasWorkflowExportEnvelope {
  return {
    exportVersion: 1,
    exportedAt,
    workflow: {
      name: workflow.name,
      description: workflow.description,
      tags: [...workflow.tags],
      package: structuredClone(workflow.package),
    },
  }
}

export function parseCanvasWorkflowImport(raw: string): CanvasWorkflowTransferPayload {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('导入文件不是有效的 JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('导入文件不是画布工作流 JSON')
  }
  const record = value as Record<string, unknown>
  if (record.exportVersion !== 1) throw new Error('不支持该画布工作流导出版本')
  const parsed = TransferPayloadSchema.safeParse(record.workflow)
  if (!parsed.success) throw new Error('导入文件中的画布工作流定义无效')
  return {
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    tags: parsed.data.tags ?? [],
    package: parsed.data.package,
  }
}
