import { useEffect, useState } from 'react'
import type { ProviderQuotaLimit } from '@spark/protocol'
import './quota-chip.less'

/**
 * 限额胶囊共享展示件（渠道卡片限额行 / 会话模型选择器悬浮用量卡共用）。
 *
 * - 胶囊样式与配色（按剩余量分级：>50% 绿、15~50% 橙、<15% 红）在 quota-chip.less
 * - 消费归一化 ProviderQuotaLimit，不感知厂商接口差异
 */

/** 重置倒计时文案：1 小时内按分钟，48 小时内按小时+分，再远给日期。 */
export function formatQuotaResetCountdown(resetAt: number, now: number): string {
  const diffMs = resetAt - now
  if (diffMs <= 0) return 'reset soon'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m reset`
  if (minutes < 60 * 48) {
    const hours = Math.floor(minutes / 60)
    return `${hours}h${minutes % 60}m reset`
  }
  const d = new Date(resetAt)
  return `${d.getMonth() + 1}.${d.getDate()} reset`
}

function quotaToneClass(remainingPercentage: number): string {
  if (remainingPercentage >= 50) return 'pv_quota_chip--ok'
  if (remainingPercentage >= 15) return 'pv_quota_chip--warn'
  return 'pv_quota_chip--danger'
}

export function ProviderQuotaChip({ limit, now }: { limit: ProviderQuotaLimit; now: number }) {
  // 额度类窗口名本身已表达含义；非额度类（如 MCP）补类别前缀区分
  const prefix = limit.kind === 'credit' ? '' : `${limit.kindLabel} `
  // 部分厂商条目只给百分比（无绝对数值），title 相应降级
  const usageText =
    limit.used !== undefined && limit.total !== undefined
      ? `：已用 ${limit.used} / ${limit.total}`
      : `：已用 ${limit.usedPercentage}%`
  // MCP 等带分项明细的条目，tooltip 追加分项用量（如 网络搜索 16 · 网页读取 17）
  const detailsText =
    limit.details && limit.details.length > 0
      ? `\n${limit.details.map((d) => `${d.label} ${d.used}`).join(' · ')}`
      : ''
  const title =
    `${prefix}${limit.windowLabel}${usageText}` +
    (limit.resetAt != null ? `（${formatQuotaResetCountdown(limit.resetAt, now)}）` : '') +
    detailsText
  return (
    <span className={`pv_quota_chip ${quotaToneClass(limit.remainingPercentage)}`} title={title}>
      <span className="pv_quota_chip_label">
        {prefix}
        {limit.windowLabel} {limit.remainingPercentage}%
      </span>
      {limit.resetAt != null && (
        <span className="pv_quota_chip_reset">{formatQuotaResetCountdown(limit.resetAt, now)}</span>
      )}
    </span>
  )
}

/** 每分钟刷新一次倒计时文案，避免常驻时显示过期时间。 */
export function useQuotaNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
