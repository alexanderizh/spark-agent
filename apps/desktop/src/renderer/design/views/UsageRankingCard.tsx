/**
 * UsageRankingCard — 设置-用量统计「用量排行」卡片。
 *
 * 模型 / 渠道两个视图以 tab（Segmented）切换，共用同一份按时间区间查询的数据
 * （usage:get-by-date-range 的 modelGroups）：模型视图直接渲染排行，
 * 渠道视图由 ProviderUsageBreakdown 前端二次聚合。
 * 切换视图不重新请求；切换时间区间重新请求。
 */
import { Segmented } from '@lobehub/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProviderUsageBreakdown } from './ProviderUsageBreakdown'
import {
  USAGE_RANKING_RANGE_OPTIONS,
  USAGE_RANKING_VIEW_OPTIONS,
  formatTokensM,
  getUsageRankingRange,
} from './usageRanking.utils'
import type { ModelUsageGroupRow, UsageRankingRange, UsageRankingView } from './usageRanking.utils'
import './UsageRankingCard.less'

const rankTotal = (row: ModelUsageGroupRow) => row.totalInputTokens + row.totalOutputTokens

export function UsageRankingCard() {
  const [view, setView] = useState<UsageRankingView>('models')
  const [range, setRange] = useState<UsageRankingRange>('all')
  const [modelGroups, setModelGroups] = useState<ModelUsageGroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const reload = useCallback(async () => {
    const currentRequestId = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const { startDate, endDate } = getUsageRankingRange(range)
      const response = await window.spark.invoke('usage:get-by-date-range', {
        startDate,
        endDate,
      })
      if (currentRequestId !== requestId.current) return
      setModelGroups(response.modelGroups)
    } catch (err) {
      if (currentRequestId !== requestId.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (currentRequestId === requestId.current) setLoading(false)
    }
  }, [range])

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(timer)
  }, [reload])

  const sortedModels = useMemo(
    () => [...modelGroups].sort((a, b) => rankTotal(b) - rankTotal(a)),
    [modelGroups],
  )
  const grandTotal = useMemo(() => sortedModels.reduce((sum, m) => sum + rankTotal(m), 0), [
    sortedModels,
  ])
  const isEmpty = modelGroups.length === 0

  return (
    <>
      <div className="subsec-h usage-rank-head">
        <span>用量排行</span>
        <div className="usage-rank-head-controls">
          <Segmented
            size="small"
            value={view}
            options={USAGE_RANKING_VIEW_OPTIONS}
            onChange={(value) => setView(value as UsageRankingView)}
          />
          <Segmented
            size="small"
            value={range}
            options={USAGE_RANKING_RANGE_OPTIONS}
            onChange={(value) => setRange(value as UsageRankingRange)}
          />
        </div>
      </div>
      <div className="card">
        {error && <div className="usage-error-card">{error}</div>}
        {loading && !error && (
          <div className="settings-card-row usage-empty">正在加载…</div>
        )}
        {!loading && isEmpty && !error && (
          <div className="settings-card-row usage-empty">暂无用量数据</div>
        )}
        {!loading && !isEmpty && view === 'models' && (
          <>
            {sortedModels.map((m) => {
              const mTotal = rankTotal(m)
              const pct = grandTotal > 0 ? (mTotal / grandTotal) * 100 : 0
              return (
                <div key={`${m.providerId}-${m.modelId}`} className="usage-rank-item">
                  <div className="usage-rank-name">
                    <div className="row-title">{m.modelId}</div>
                    <div className="row-desc">{m.providerId}</div>
                  </div>
                  <div className="usage-rank-bar">
                    <div className="usage-rank-track">
                      <div className="usage-rank-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="usage-rank-stats">
                    <span className="mono-sm">
                      ↑{formatTokensM(m.totalInputTokens)} ↓{formatTokensM(m.totalOutputTokens)}
                    </span>
                    <span className="usage-rank-pct">{pct.toFixed(0)}%</span>
                  </div>
                </div>
              )
            })}
            <div className="usage-rank-legend">
              <span className="usage-rank-legend-item">
                <i className="provider-rank-legend-dot provider-rank-legend-dot--model" />
                模型用量
              </span>
            </div>
          </>
        )}
        {!loading && !isEmpty && view === 'providers' && (
          <ProviderUsageBreakdown models={modelGroups} />
        )}
      </div>
    </>
  )
}
