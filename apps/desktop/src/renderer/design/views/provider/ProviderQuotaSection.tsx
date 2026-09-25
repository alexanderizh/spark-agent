import type { ProviderQuotaSnapshot } from '@spark/protocol'
import { Icons } from '../../Icons'
import { ProviderQuotaChip, useQuotaNow } from './quota-chip'

/**
 * 渠道卡片上的限额展示行（各窗口限额胶囊；套餐档位胶囊由卡片头部状态 Tag 行渲染）。
 *
 * 胶囊本体与倒计时逻辑在 ./quota-chip（与模型选择器悬浮用量卡共用）；
 * 本组件负责卡片行的容器语义：错误重试入口、查询中占位、空数据不渲染。
 */
export function ProviderQuotaSection({
  quota,
  error,
  loading = false,
  onRefresh,
}: {
  // 显式允许 undefined 传入（exactOptionalPropertyTypes：父组件取 map 值可能为 undefined）
  quota?: ProviderQuotaSnapshot | undefined
  error?: string | undefined
  loading?: boolean | undefined
  onRefresh?: (() => void) | undefined
}) {
  const now = useQuotaNow()

  if (error) {
    return (
      <div className="pv_card_row pv_card_row_quota">
        <button
          type="button"
          className="pv_quota_error"
          onClick={(e) => {
            // 多选模式下卡片整体可点（切换选中），重试按钮需阻止冒泡
            e.stopPropagation()
            onRefresh?.()
          }}
          title={error}
          aria-label="限额查询失败，点击重试"
        >
          <Icons.Refresh size={10} />
          <span>查询失败 · 重试</span>
        </button>
      </div>
    )
  }

  if (!quota) {
    if (!loading) return null
    return (
      <div className="pv_card_row pv_card_row_quota">
        <span className="pv_quota_chip pv_quota_chip--loading">查询中…</span>
      </div>
    )
  }

  if (quota.limits.length === 0) return null

  return (
    <div className="pv_card_row pv_card_row_quota">
      {quota.limits.map((limit, idx) => (
        <ProviderQuotaChip
          key={`${limit.kind}-${limit.windowLabel}-${idx}`}
          limit={limit}
          now={now}
        />
      ))}
    </div>
  )
}
