import { useCallback, useEffect, useState } from 'react'
import { Input } from 'antd'
import { Button } from '@lobehub/ui'
import type { PlatformModelPurchaseLink } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useToast } from '../../components/Toast'
import './OnboardingPlatformFunding.less'

type Props = {
  account: string
  onContinue: () => void
}

export function OnboardingPlatformFunding({ account, onContinue }: Props): React.ReactElement {
  const { toast } = useToast()
  const [balance, setBalance] = useState<number | null>(null)
  const [purchaseLinks, setPurchaseLinks] = useState<PlatformModelPurchaseLink[]>([])
  const [redeemCode, setRedeemCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [redeeming, setRedeeming] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      await window.spark.invoke('platform-model:bootstrap', undefined)
      const [usage, purchaseResult] = await Promise.all([
        window.spark.invoke('platform-model:get-usage', undefined),
        window.spark.invoke('platform-model:get-purchase-links', undefined),
      ])
      setBalance(usage.walletQuota)
      setPurchaseLinks(purchaseResult.links)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '额度状态加载失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openPurchaseLink = async (link: PlatformModelPurchaseLink): Promise<void> => {
    try {
      await window.spark.invoke('platform-model:open-purchase-link', { id: link.id })
      toast.info('购买完成后返回这里输入兑换码')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开购买渠道失败')
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
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '兑换失败')
    } finally {
      setRedeeming(false)
    }
  }

  const hasQuota = balance != null && balance > 0

  return (
    <section className="onboarding-platform-funding" aria-label="Spark 平台模型额度">
      <header className="onboarding-platform-funding__header">
        <div className="onboarding-platform-funding__identity">
          <span className="onboarding-platform-funding__status"><Icons.Check size={15} /></span>
          <div>
            <strong>账号已登录</strong>
            {account ? <span>{account}</span> : null}
          </div>
        </div>
        <div className="onboarding-platform-funding__balance">
          <span>可用额度</span>
          <strong>{balance == null ? '--' : formatQuota(balance)}</strong>
          <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="刷新额度">
            <Icons.Refresh size={14} />
          </button>
        </div>
      </header>

      {!loading && !hasQuota ? (
        <div className="onboarding-platform-funding__notice">
          当前账号暂无可用额度，请购买兑换码或直接兑换后继续。
        </div>
      ) : null}

      <div className="onboarding-platform-funding__section">
        <div className="onboarding-platform-funding__section-title">
          <div>
            <strong>购买兑换码</strong>
            <span>在浏览器完成购买，再返回本页兑换</span>
          </div>
        </div>
        <div className="onboarding-platform-funding__channels">
          {purchaseLinks.map((link, index) => (
            <Button
              key={link.id}
              type={index === 0 ? 'primary' : 'default'}
              icon={<Icons.ExternalLink size={15} />}
              onClick={() => void openPurchaseLink(link)}
              title={link.description}
            >
              {link.name}
            </Button>
          ))}
          {!loading && purchaseLinks.length === 0 ? (
            <span className="onboarding-platform-funding__empty">暂未配置购买渠道，请联系管理员获取兑换码。</span>
          ) : null}
        </div>
      </div>

      <div className="onboarding-platform-funding__section">
        <div className="onboarding-platform-funding__section-title">
          <div>
            <strong>兑换额度</strong>
            <span>兑换成功后额度会自动刷新</span>
          </div>
        </div>
        <div className="onboarding-platform-funding__redeem">
          <Input
            value={redeemCode}
            onChange={(event) => setRedeemCode(event.target.value)}
            onPressEnter={() => void redeem()}
            placeholder="输入兑换码"
            disabled={redeeming}
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
      </div>

      <div className="onboarding-platform-funding__footer">
        <span>{hasQuota ? '额度已就绪，可以继续创建助手。' : '兑换到账后即可继续。'}</span>
        <Button type="primary" loading={loading} disabled={!hasQuota} onClick={onContinue}>
          额度已就绪，继续
        </Button>
      </div>
    </section>
  )
}

function formatQuota(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value)
}
