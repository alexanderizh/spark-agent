import { useCallback, useEffect, useState } from 'react'
import { Input, Modal } from 'antd'
import { Button } from '@lobehub/ui'
import type { PlatformModelPurchaseLink } from '@spark/protocol'
import { useAuth } from '../../auth/AuthContext'
import { Icons } from '../../Icons'
import { useToast } from '../../components/Toast'
import posterUrl from '../../../assets/platform-quota-poster-v1.png'
import type { PlatformQuotaGuideReason } from './platform-quota-guide'
import './PlatformQuotaGuideModal.less'

type Props = {
  open: boolean
  reason: PlatformQuotaGuideReason
  onClose: () => void
  onOpenAccount: () => void
  onConfigureProviders: () => void
}

const COPY: Record<PlatformQuotaGuideReason, { title: string; description: string }> = {
  'quota-exhausted': {
    title: '通用额度不足',
    description: '补充额度后即可继续使用 Spark 平台模型，当前对话会保留在这里。',
  },
  'low-balance': {
    title: '通用额度待补充',
    description: '购买或兑换额度后即可开始使用 Spark 平台模型。',
  },
  onboarding: {
    title: '开通 Spark 平台模型',
    description: '无需配置 API Key，购买或兑换后即可在所有对话中选择平台模型。',
  },
}

export function PlatformQuotaGuideModal({
  open,
  reason,
  onClose,
  onOpenAccount,
  onConfigureProviders,
}: Props): React.ReactElement {
  const auth = useAuth()
  const { toast } = useToast()
  const [balance, setBalance] = useState<number | null>(null)
  const [purchaseLinks, setPurchaseLinks] = useState<PlatformModelPurchaseLink[]>([])
  const [loading, setLoading] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [redeemOpen, setRedeemOpen] = useState(false)
  const [redeemCode, setRedeemCode] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    if (!auth.isAuthenticated) {
      setBalance(null)
      setPurchaseLinks([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const [status, purchaseResult] = await Promise.all([
        window.spark.invoke('platform-model:get-status', undefined),
        window.spark.invoke('platform-model:get-purchase-links', undefined),
      ])
      setPurchaseLinks(purchaseResult.links)
      if (!status.providerReady) {
        await window.spark.invoke('platform-model:bootstrap', undefined)
      }
      const usage = await window.spark.invoke('platform-model:get-usage', undefined)
      setBalance(usage.walletQuota)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '额度状态刷新失败')
    } finally {
      setLoading(false)
    }
  }, [auth.isAuthenticated])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [open, refresh])

  const close = (): void => {
    setRedeemOpen(false)
    setRedeemCode('')
    onClose()
  }

  const openPurchaseLink = async (link: PlatformModelPurchaseLink): Promise<void> => {
    try {
      await window.spark.invoke('platform-model:open-purchase-link', { id: link.id })
      toast.info('购买完成后可自动返回应用，或复制兑换码在这里兑换')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '打开购买渠道失败')
    }
  }

  const redeem = async (): Promise<void> => {
    const code = redeemCode.trim()
    if (!code) return
    setRedeeming(true)
    try {
      const result = await window.spark.invoke('platform-model:redeem', { code })
      toast.success(result.message)
      setRedeemCode('')
      setRedeemOpen(false)
      await refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '兑换失败')
    } finally {
      setRedeeming(false)
    }
  }

  const copy = COPY[reason]
  const primaryPurchaseLink = purchaseLinks[0]
  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      width={760}
      centered
      destroyOnHidden
      rootClassName="platform-quota-guide-root"
    >
      <div className="platform-quota-guide">
        <div className="platform-quota-guide__poster" aria-hidden="true">
          <img src={posterUrl} alt="" />
        </div>
        <div className="platform-quota-guide__content">
          <div className="platform-quota-guide__heading">
            <span className="platform-quota-guide__alert">
              <Icons.AlertTriangle size={18} />
            </span>
            <div>
              <h2>{auth.isAuthenticated ? copy.title : '登录后使用 Spark 平台模型'}</h2>
              <p>
                {auth.isAuthenticated
                  ? copy.description
                  : '登录或注册 Spark 账号后，可以购买、兑换并跨对话使用通用额度。'}
              </p>
            </div>
          </div>

          {auth.isAuthenticated ? (
            <div className="platform-quota-guide__balance">
              <Icons.Database size={17} />
              <span>当前余额</span>
              <strong>{balance == null ? '--' : formatQuota(balance)}</strong>
              <button type="button" onClick={() => void refresh()} disabled={loading}>
                <Icons.Refresh size={14} />
                {loading ? '刷新中' : '刷新'}
              </button>
            </div>
          ) : null}

          {error ? <div className="platform-quota-guide__error">{error}</div> : null}

          <div className="platform-quota-guide__actions">
            {!auth.isAuthenticated ? (
              <Button
                type="primary"
                size="middle"
                onClick={onOpenAccount}
                icon={<Icons.User size={17} />}
              >
                登录 / 注册
              </Button>
            ) : primaryPurchaseLink ? (
              <Button
                type="primary"
                size="middle"
                onClick={() => void openPurchaseLink(primaryPurchaseLink)}
                icon={<Icons.ExternalLink size={17} />}
              >
                购买兑换码
              </Button>
            ) : (
              <Button
                type="primary"
                size="middle"
                onClick={onOpenAccount}
                icon={<Icons.User size={17} />}
              >
                前往账户中心
              </Button>
            )}
            {auth.isAuthenticated ? (
              <Button
                size="middle"
                onClick={() => setRedeemOpen((value) => !value)}
                icon={<Icons.Edit size={17} />}
              >
                输入兑换码
              </Button>
            ) : null}
            <Button
              type="text"
              size="middle"
              onClick={onConfigureProviders}
              icon={<Icons.Server size={17} />}
            >
              配置第三方模型
            </Button>
          </div>

          {purchaseLinks.length > 1 ? (
            <div className="platform-quota-guide__channels">
              <span>其他购买渠道</span>
              {purchaseLinks.slice(1).map((link) => (
                <button key={link.id} type="button" onClick={() => void openPurchaseLink(link)}>
                  {link.name}
                  <Icons.ExternalLink size={12} />
                </button>
              ))}
            </div>
          ) : null}

          {redeemOpen ? (
            <div className="platform-quota-guide__redeem">
              <Input
                value={redeemCode}
                onChange={(event) => setRedeemCode(event.target.value)}
                onPressEnter={() => void redeem()}
                placeholder="输入兑换码"
                autoFocus
              />
              <Button
                type="primary"
                loading={redeeming}
                disabled={!redeemCode.trim()}
                onClick={() => void redeem()}
              >
                立即兑换
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}

function formatQuota(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value)
}
