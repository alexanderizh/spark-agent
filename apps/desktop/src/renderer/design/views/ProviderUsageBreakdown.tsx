/**
 * ProviderUsageBreakdown — 设置-用量统计「用量排行」卡片的渠道 tab 内容。
 *
 * 把当前时间区间的 modelGroups（与模型 tab 同源）按渠道（Provider Profile）二次聚合：
 * 渠道行显示名称 + 总量柱（暗紫色）+ ↑↓ tokens，点击展开该渠道下各模型明细（主蓝细柱）。
 * 纯前端聚合；渠道名经 provider:list 解析，解析不到（历史渠道已删除等）时回退显示原始 providerId。
 * 卡片外壳、加载态与空态由 UsageRankingCard 统一管理。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icons } from '../Icons'
import './ProviderUsageBreakdown.less'
import { formatTokensM } from './usageRanking.utils'
import type { ModelUsageGroupRow } from './usageRanking.utils'

interface ProviderModelUsageRow {
  modelId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  recordCount: number
}

interface ProviderUsageGroup {
  providerId: string
  /** 渠道显示名；provider:list 解析不到时为 null（展示「未知渠道」兜底）。 */
  displayName: string | null
  models: ProviderModelUsageRow[]
  inputTokens: number
  outputTokens: number
  totalTokens: number
  recordCount: number
}

export function ProviderUsageBreakdown({ models }: { models: ModelUsageGroupRow[] }) {
  const [nameById, setNameById] = useState<ReadonlyMap<string, string>>(() => new Map())
  /** 用户未交互时为 null，按「默认展开第一个渠道」推导；交互后完全由用户状态决定。 */
  const [userExpanded, setUserExpanded] = useState<ReadonlySet<string> | null>(null)
  const requestId = useRef(0)

  // includeDisabled：已禁用渠道的历史用量同样要能解析出渠道名。
  const loadProviderNames = useCallback(async () => {
    const currentRequestId = ++requestId.current
    try {
      const res = await window.spark.invoke('provider:list', { includeDisabled: true })
      if (currentRequestId !== requestId.current) return
      setNameById(new Map(res.profiles.map((p) => [p.id, p.name] as const)))
    } catch {
      // 名称解析失败不阻塞用量展示，各行回退显示原始 providerId。
      if (currentRequestId !== requestId.current) return
      setNameById(new Map())
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProviderNames(), 0)
    return () => window.clearTimeout(timer)
  }, [loadProviderNames])

  const groups = useMemo<ProviderUsageGroup[]>(() => {
    const byProvider = new Map<string, ProviderUsageGroup>()
    for (const m of models) {
      let group = byProvider.get(m.providerId)
      if (!group) {
        group = {
          providerId: m.providerId,
          displayName: nameById.get(m.providerId) ?? null,
          models: [],
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          recordCount: 0,
        }
        byProvider.set(m.providerId, group)
      }
      group.models.push({
        modelId: m.modelId,
        inputTokens: m.totalInputTokens,
        outputTokens: m.totalOutputTokens,
        totalTokens: m.totalInputTokens + m.totalOutputTokens,
        recordCount: m.recordCount,
      })
      group.inputTokens += m.totalInputTokens
      group.outputTokens += m.totalOutputTokens
      group.totalTokens += m.totalInputTokens + m.totalOutputTokens
      group.recordCount += m.recordCount
    }
    for (const group of byProvider.values()) {
      group.models.sort((a, b) => b.totalTokens - a.totalTokens)
    }
    return [...byProvider.values()].sort((a, b) => b.totalTokens - a.totalTokens)
  }, [models, nameById])

  const grandTotal = useMemo(() => groups.reduce((sum, g) => sum + g.totalTokens, 0), [groups])

  const expandedIds =
    userExpanded ?? (groups[0] ? new Set<string>([groups[0].providerId]) : new Set<string>())

  const toggleProvider = (providerId: string) => {
    const next = new Set(expandedIds)
    if (next.has(providerId)) {
      next.delete(providerId)
    } else {
      next.add(providerId)
    }
    setUserExpanded(next)
  }

  return (
    <>
      {groups.map((group) => {
        const pct = grandTotal > 0 ? (group.totalTokens / grandTotal) * 100 : 0
        const expanded = expandedIds.has(group.providerId)
        return (
          <div key={group.providerId} className="provider-rank-group">
            <div
              className="provider-rank-row"
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={() => toggleProvider(group.providerId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleProvider(group.providerId)
                }
              }}
            >
              <div className="usage-rank-name">
                <div
                  className={`row-title${group.displayName == null ? ' provider-rank-unknown' : ''}`}
                >
                  {group.displayName ?? '未知渠道'}
                </div>
                <div className="row-desc">
                  {group.providerId} · {group.models.length} 个模型 · {group.recordCount} 次请求
                </div>
              </div>
              <div className="usage-rank-bar">
                <div className="usage-rank-track">
                  <div className="provider-rank-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="usage-rank-stats">
                <span className="mono-sm">
                  ↑{formatTokensM(group.inputTokens)} ↓{formatTokensM(group.outputTokens)}
                </span>
                <span className="usage-rank-pct">{pct.toFixed(0)}%</span>
              </div>
              <div className="provider-rank-chevron">
                {expanded ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
              </div>
            </div>
            {expanded && (
              <div className="provider-rank-models">
                {group.models.map((m, index) => {
                  const isLast = index === group.models.length - 1
                  const modelPct = grandTotal > 0 ? (m.totalTokens / grandTotal) * 100 : 0
                  return (
                    <div key={`${group.providerId}-${m.modelId}`} className="provider-rank-model-row">
                      <div className="provider-rank-model-name">
                        <span className="provider-rank-tree">{isLast ? '└' : '├'}</span>
                        <span className="provider-rank-model-title">{m.modelId}</span>
                      </div>
                      <div className="provider-rank-model-bar">
                        <div
                          className="provider-rank-model-fill"
                          style={{ width: `${modelPct}%` }}
                        />
                      </div>
                      <div className="usage-rank-stats">
                        <span className="mono-sm">
                          ↑{formatTokensM(m.inputTokens)} ↓{formatTokensM(m.outputTokens)}
                        </span>
                        <span className="usage-rank-pct">{modelPct.toFixed(0)}%</span>
                      </div>
                      <div className="provider-rank-chevron" />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {groups.length > 0 && (
        <div className="provider-rank-legend">
          <span className="provider-rank-legend-item">
            <i className="provider-rank-legend-dot provider-rank-legend-dot--provider" />
            渠道总量
          </span>
          <span className="provider-rank-legend-item">
            <i className="provider-rank-legend-dot provider-rank-legend-dot--model" />
            模型明细
          </span>
        </div>
      )}
    </>
  )
}
