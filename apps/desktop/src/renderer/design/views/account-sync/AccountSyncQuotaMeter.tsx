import {
  computeAccountSyncQuota,
  formatAccountSyncPayloadSize,
  type AccountSyncQuota,
  type AccountSyncStatus,
} from '@spark/protocol'
import './AccountSyncQuotaMeter.less'
interface AccountSyncQuotaMeterProps {
  status: AccountSyncStatus | null
  /** 本次待同步数据量（显式测量得到）；有则作为进度口径，否则回落到上次同步数据 */
  pendingBytes?: number | null
}

const STATUS_LABELS: Record<AccountSyncQuota['basis'], string> = {
  pending: '本次待同步',
  last: '上次数据',
  none: '尚无数据',
}

/** 3px 细进度条：余量占比一眼可见，不抢占信息层级 */
function QuotaBar({ quota }: { quota: AccountSyncQuota }): React.ReactElement {
  const percent = Math.min(100, Math.max(0, Math.round(quota.ratio * 100)))
  return (
    <div
      className={`account-sync-quota-bar is-${quota.level}`}
      role="progressbar"
      aria-label="单次同步余量占比"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="account-sync-quota-bar-fill" style={{ width: `${percent}%` }} />
    </div>
  )
}

function usedLabel(quota: AccountSyncQuota): string {
  if (quota.basis === 'none') return '—'
  return formatAccountSyncPayloadSize(quota.usedBytes)
}

/**
 * 设置页「立即同步」操作行内的余量行（方案 B：文本 + 3px 细进度条）。
 * 不新增卡片、不加边框，完全贴合既有分割线扁平风格。
 */
export function AccountSyncQuotaInline({
  status,
  pendingBytes,
}: AccountSyncQuotaMeterProps): React.ReactElement {
  const quota = computeAccountSyncQuota(status, pendingBytes)
  const maxLabel = formatAccountSyncPayloadSize(quota.maxBytes)
  const fallbackHint = status?.source === 'fallback' ? '（服务端版本较低，仅供参考）' : ''

  let copy: string
  if (quota.basis === 'none') {
    copy = `单次同步上限 ${maxLabel} · 尚无同步记录${fallbackHint}`
  } else if (quota.level === 'over') {
    copy = `单次同步上限 ${maxLabel} · ${STATUS_LABELS[quota.basis]} ${usedLabel(
      quota,
    )} · 已超出 ${formatAccountSyncPayloadSize(quota.usedBytes - quota.maxBytes)}`
  } else {
    copy = `单次同步上限 ${maxLabel} · ${STATUS_LABELS[quota.basis]} ${usedLabel(
      quota,
    )} · 余量 ${formatAccountSyncPayloadSize(quota.remainingBytes)}`
  }

  return (
    <div className={`account-sync-quota-inline is-${quota.level}`}>
      <span className="account-sync-quota-inline-copy">{copy}</span>
      <QuotaBar quota={quota} />
    </div>
  )
}

/** 账号中心「账号同步」面板：行式信息 + 余量进度条 + 口径说明 */
export function AccountSyncQuotaPanel({
  status,
  pendingBytes,
  loading = false,
}: AccountSyncQuotaMeterProps & { loading?: boolean }): React.ReactElement {
  const quota = computeAccountSyncQuota(status, pendingBytes)

  if (loading && status == null) {
    return (
      <div className="account-sync-quota-panel">
        <div className="account-sync-quota-panel-empty">正在读取同步余量…</div>
      </div>
    )
  }

  const lastSyncLabel =
    status?.lastSyncAt != null
      ? new Intl.DateTimeFormat('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(status.lastSyncAt))
      : '—'

  return (
    <div className="account-sync-quota-panel">
      <div className="account-sync-quota-panel-row">
        <span className="account-sync-quota-panel-label">单次同步上限</span>
        <span className="account-sync-quota-panel-value">
          {formatAccountSyncPayloadSize(quota.maxBytes)}
        </span>
      </div>
      <div className="account-sync-quota-panel-row">
        <span className="account-sync-quota-panel-label">
          {quota.basis === 'pending' ? '本次待同步数据' : '上次同步数据'}
        </span>
        <span className="account-sync-quota-panel-value">{usedLabel(quota)}</span>
      </div>
      <div className="account-sync-quota-panel-row">
        <span className="account-sync-quota-panel-label">上次同步时间</span>
        <span className="account-sync-quota-panel-value">{lastSyncLabel}</span>
      </div>
      <div className="account-sync-quota-panel-row">
        <span className="account-sync-quota-panel-label">最近设备</span>
        <span className="account-sync-quota-panel-value" title={status?.lastDeviceLabel ?? ''}>
          {status?.lastDeviceLabel ?? '—'}
        </span>
      </div>
      <div className="account-sync-quota-panel-row">
        <span className="account-sync-quota-panel-label">上次结果</span>
        <span className={`account-sync-quota-panel-value is-${status?.lastStatus ?? 'none'}`}>
          {status?.lastStatus === 'success'
            ? '成功'
            : status?.lastStatus === 'partial'
              ? '部分成功'
              : status?.lastStatus === 'failed'
                ? '失败'
                : '尚无记录'}
        </span>
      </div>

      <div className="account-sync-quota-panel-meter">
        <div className="account-sync-quota-panel-meter-head">
          <span>余量使用</span>
          <strong className={`is-${quota.level}`}>
            {quota.level === 'over'
              ? `已超出 ${formatAccountSyncPayloadSize(quota.usedBytes - quota.maxBytes)}`
              : `${formatAccountSyncPayloadSize(quota.remainingBytes)} 可用`}
          </strong>
        </div>
        <QuotaBar quota={quota} />
      </div>

      <p className="account-sync-quota-panel-note">
        余量按「单次同步上限 − 上次同步数据」估算。同步上限是单次请求级限制，不是累计存储配额。
        {status?.source === 'fallback' ? '当前服务端版本较低，以上限默认值为准，仅供参考。' : ''}
      </p>
    </div>
  )
}
