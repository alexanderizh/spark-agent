/**
 * workspace-search IPC 注册。
 *
 * - workspace-search:files   → 文件名模糊搜索（一次性响应）
 * - workspace-search:content → 内容搜索：立即返回 requestId，
 *   结果批次与终态经 stream:workspace-search:content 推送
 * - workspace-search:cancel  → 取消进行中的内容搜索
 */

import { WorkspaceSearchService } from '../services/WorkspaceSearchService.js'
import { resolveSessionScopedWorkspaceRoot } from './sessionWorkspaceRoot.js'
import { typedIpcHandle, pushStreamEvent } from './typed-ipc.js'

export const WORKSPACE_SEARCH_CONTENT_STREAM = 'stream:workspace-search:content'

let service: WorkspaceSearchService | null = null

export function getWorkspaceSearchService(): WorkspaceSearchService {
  if (service == null) service = new WorkspaceSearchService()
  return service
}

/** 测试注入点（避免单例跨用例泄漏状态） */
export function setWorkspaceSearchServiceForTest(next: WorkspaceSearchService | null): void {
  service = next
}

export function registerWorkspaceSearchIpc(): void {
  typedIpcHandle('workspace-search:files', async (req) => {
    const rootPath = await resolveSessionScopedWorkspaceRoot(req.workspaceId, req.sessionId)
    return getWorkspaceSearchService().searchFiles(rootPath, req.query, req.limit ?? 100, {
      refresh: req.refresh === true,
    })
  })

  typedIpcHandle('workspace-search:content', async (req) => {
    const rootPath = await resolveSessionScopedWorkspaceRoot(req.workspaceId, req.sessionId)
    const searchService = getWorkspaceSearchService()
    const { requestId, done } = searchService.runContentSearch(rootPath, {
      requestId: req.requestId,
      query: req.query,
      ...(req.caseSensitive != null ? { caseSensitive: req.caseSensitive } : {}),
      ...(req.maxResults != null ? { maxResults: req.maxResults } : {}),
      onBatch: (batch) => {
        pushStreamEvent(WORKSPACE_SEARCH_CONTENT_STREAM, {
          requestId,
          batch,
          done: false,
          truncated: false,
          cancelled: false,
        })
      },
    })

    // 终态（含错误）转成 done 推送；done promise 永不 reject（错误也走 payload.error）
    void done.then(
      (result) => {
        pushStreamEvent(WORKSPACE_SEARCH_CONTENT_STREAM, {
          requestId: result.requestId,
          batch: [],
          done: true,
          truncated: result.truncated,
          cancelled: result.cancelled,
          stats: result.stats,
        })
      },
      (error: unknown) => {
        pushStreamEvent(WORKSPACE_SEARCH_CONTENT_STREAM, {
          requestId,
          batch: [],
          done: true,
          truncated: false,
          cancelled: false,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )

    return { requestId }
  })

  typedIpcHandle('workspace-search:cancel', async (req) => ({
    cancelled: getWorkspaceSearchService().cancelContentSearch(req.requestId),
  }))
}
