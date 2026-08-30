import type {
  FilePrepareSessionImagesRequest,
  FilePrepareSessionImagesResponse,
  SessionImageOptimizationResult,
} from '@spark/protocol'
import type { ComposerAttachmentDraft } from './composer-attachments'

export interface SessionImageOptimizationSummary {
  optimizedCount: number
  fallbackCount: number
  inputBytes: number
  outputBytes: number
}

export type SessionImageOptimizationNotice = {
  level: 'success' | 'warning'
  message: string
}

const EMPTY_SUMMARY: SessionImageOptimizationSummary = {
  optimizedCount: 0,
  fallbackCount: 0,
  inputBytes: 0,
  outputBytes: 0,
}

export async function prepareSessionImageAttachments(
  attachments: ComposerAttachmentDraft[],
  invoke: (request: FilePrepareSessionImagesRequest) => Promise<FilePrepareSessionImagesResponse>,
): Promise<{
  attachments: ComposerAttachmentDraft[]
  summary: SessionImageOptimizationSummary
}> {
  const imagePaths = attachments
    .filter((attachment) => attachment.type === 'image')
    .map((attachment) => attachment.path)
  if (imagePaths.length === 0) return { attachments, summary: EMPTY_SUMMARY }

  try {
    const response = await invoke({ sourcePaths: imagePaths })
    return applyResults(attachments, response.results)
  } catch {
    return {
      attachments,
      summary: { ...EMPTY_SUMMARY, fallbackCount: imagePaths.length },
    }
  }
}

export function formatSessionImageOptimizationNotice(
  summary: SessionImageOptimizationSummary,
): SessionImageOptimizationNotice | null {
  const parts: string[] = []
  if (summary.optimizedCount > 0) {
    parts.push(
      `已优化 ${summary.optimizedCount} 张图片：${formatMiB(summary.inputBytes)} → ${formatMiB(summary.outputBytes)}`,
    )
  }
  if (summary.fallbackCount > 0) {
    parts.push(`${summary.fallbackCount} 张优化失败，已使用原图发送`)
  }
  if (parts.length === 0) return null
  return {
    level: summary.fallbackCount > 0 ? 'warning' : 'success',
    message: parts.join('；'),
  }
}

function applyResults(
  attachments: ComposerAttachmentDraft[],
  results: SessionImageOptimizationResult[],
): {
  attachments: ComposerAttachmentDraft[]
  summary: SessionImageOptimizationSummary
} {
  const bySourcePath = new Map(results.map((result) => [result.sourcePath, result]))
  const summary = { ...EMPTY_SUMMARY }

  for (const result of results) {
    if (result.status === 'optimized') {
      summary.optimizedCount += 1
      summary.inputBytes += result.inputBytes
      summary.outputBytes += result.outputBytes
    } else if (result.status === 'fallback') {
      summary.fallbackCount += 1
    }
  }

  return {
    attachments: attachments.map((attachment) => {
      if (attachment.type !== 'image') return attachment
      const result = bySourcePath.get(attachment.path)
      return result?.status === 'optimized'
        ? { ...attachment, path: result.outputPath }
        : attachment
    }),
    summary,
  }
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
