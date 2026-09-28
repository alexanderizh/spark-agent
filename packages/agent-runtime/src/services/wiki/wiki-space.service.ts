/**
 * @module wiki-space.service
 *
 * 空间读取服务 — Agent 与 IPC 共用的空间列表（L1 级：目录骨架，无正文无摘要）。
 *
 * 访问控制：Agent 侧调用必须传 scopes（由会话上下文派生：user + 首workspace +
 * agent），服务端裁剪可见范围，不信任工具入参声明的 scope。
 */

import { estimateTokens } from '@spark/shared'
import type { WikiScope, WikiSpaceRow, WikiSpaceType } from '@spark/storage'
import { WikiSpaceRepository } from '@spark/storage'

export interface WikiSpaceScopeFilter {
  scope: WikiScope
  scopeRef: string | null
}

/** L1 列表项：每空间一行（id + 名称 + kind 计数），不带描述长文 */
export interface WikiSpaceListItem {
  id: string
  name: string
  spaceType: WikiSpaceType
  scope: WikiScope
  pageCount: number
  tokens: number
}

export class WikiSpaceService {
  constructor(private readonly spaceRepo: WikiSpaceRepository) {}

  /** IPC 全量视图（含描述/时间戳等元数据，渲染端用）。 */
  listSpaces(
    scopes: WikiSpaceScopeFilter[],
    opts?: { spaceType?: WikiSpaceType },
  ): Array<WikiSpaceRow & { pageCount: number }> {
    const rows = this.spaceRepo.listByScopes(scopes, {
      ...(opts?.spaceType != null ? { spaceType: opts.spaceType } : {}),
    })
    const counts = this.spaceRepo.countActivePagesBySpace(rows.map((r) => r.id))
    return rows.map((r) => ({ ...r, pageCount: counts.get(r.id) ?? 0 }))
  }

  /** Agent L1 视图：每空间 ≤ 1 行，预算内截断（默认最多列 12 个空间防刷屏）。 */
  listSpacesForAgent(
    scopes: WikiSpaceScopeFilter[],
    opts?: { spaceType?: WikiSpaceType; maxSpaces?: number },
  ): { items: WikiSpaceListItem[]; truncated: boolean; tokens: number } {
    const rows = this.spaceRepo.listByScopes(scopes, {
      ...(opts?.spaceType != null ? { spaceType: opts.spaceType } : {}),
    })
    const counts = this.spaceRepo.countActivePagesBySpace(rows.map((r) => r.id))
    const maxSpaces = Math.min(opts?.maxSpaces ?? 12, 30)
    const sliced = rows.slice(0, maxSpaces)
    const items = sliced.map((r) => ({
      id: r.id,
      name: r.name,
      spaceType: r.space_type,
      scope: r.scope,
      pageCount: counts.get(r.id) ?? 0,
      tokens: 0,
    }))
    // 每行 token 估计（会话检查器计量与预算守卫共用）
    for (const item of items) item.tokens = estimateTokens(JSON.stringify(item))
    return {
      items,
      truncated: rows.length > sliced.length,
      tokens: items.reduce((s, i) => s + i.tokens, 0),
    }
  }
}
