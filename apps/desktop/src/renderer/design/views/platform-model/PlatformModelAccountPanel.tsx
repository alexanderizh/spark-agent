import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from 'antd'
import { Button } from '@lobehub/ui'
import type {
  PlatformModelPlan,
  PlatformModelPurchaseLink,
  PlatformModelStatus,
  PlatformModelSubscription,
  PlatformModelUsage,
} from '@spark/protocol'
import { useToast } from '../../components/Toast'
import { useApp } from '../../AppContext'
import './PlatformModelAccountPanel.less'

export function PlatformModelAccountPanel(): React.ReactElement {
  const { toast } = useToast()
  const { setTweak } = useApp()
  const [status, setStatus] = useState<PlatformModelStatus | null>(null)
  const [plans, setPlans] = useState<PlatformModelPlan[]>([])
  const [subscription, setSubscription] = useState<PlatformModelSubscription | null>(null)
  const [usage, setUsage] = useState<PlatformModelUsage | null>(null)
  const [purchaseLinks, setPurchaseLinks] = useState<PlatformModelPurchaseLink[]>([])
  const [loading, setLoading] = useState(true)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [payingPlanId, setPayingPlanId] = useState<number | null>(null)
  const mountedRef = useRef(true)
  const paymentPollPlanRef = useRef<number | null>(null)

  const pollPaymentResult = useCallback(async (planId: number): Promise<void> => {
    if (paymentPollPlanRef.current === planId) return
    paymentPollPlanRef.current = planId
    try {
      for (let attempt = 0; attempt < 20 && mountedRef.current; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 3_000))
        if (!mountedRef.current) return
        try {
          const result = await window.spark.invoke('platform-model:get-subscription', undefined)
          if (result.subscription?.planId === planId && result.subscription.status.toLowerCase() === 'active') {
            const latestStatus = await window.spark.invoke('platform-model:get-status', undefined)
            if (!latestStatus.pendingPayment) {
              setSubscription(result.subscription)
              setStatus(latestStatus)
              toast.success('支付已确认，平台官方模型已就绪')
              return
            }
          }
        } catch {
          // 网络抖动时继续有限轮询，最终由“刷新”按钮兜底。
        }
      }
    } finally {
      if (paymentPollPlanRef.current === planId) paymentPollPlanRef.current = null
    }
  }, [toast])

  const refresh = useCallback(async (takeOver = false) => {
    setLoading(true)
    try {
      const nextStatus = await window.spark.invoke(
        takeOver ? 'platform-model:continue-on-this-device' : 'platform-model:bootstrap',
        undefined,
      )
      setStatus(nextStatus)
      if (!nextStatus.sessionConflict) {
        const [planResult, subscriptionResult, usageResult, purchaseLinkResult] = await Promise.all([
          window.spark.invoke('platform-model:get-plans', undefined),
          window.spark.invoke('platform-model:get-subscription', undefined),
          window.spark.invoke('platform-model:get-usage', undefined),
          window.spark.invoke('platform-model:get-purchase-links', undefined),
        ])
        setPlans(planResult.plans)
        setSubscription(subscriptionResult.subscription)
        setUsage(usageResult)
        setPurchaseLinks(purchaseLinkResult.links)
        const refreshedStatus = nextStatus.pendingPayment
          ? await window.spark.invoke('platform-model:get-status', undefined)
          : nextStatus
        setStatus(refreshedStatus)
        if (refreshedStatus.pendingPayment) {
          void pollPaymentResult(refreshedStatus.pendingPayment.planId)
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '平台模型加载失败')
    } finally {
      setLoading(false)
    }
  }, [pollPaymentResult, toast])

  useEffect(() => {
    mountedRef.current = true
    queueMicrotask(() => { if (mountedRef.current) void refresh(false) })
    return () => { mountedRef.current = false }
  }, [refresh])

  const redeem = async (): Promise<void> => {
    if (!redeemCode.trim()) return
    setRedeeming(true)
    try {
      const result = await window.spark.invoke('platform-model:redeem', { code: redeemCode.trim() })
      toast.success(result.message)
      setRedeemCode('')
      await refresh(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '兑换失败')
    } finally {
      setRedeeming(false)
    }
  }

  const pay = async (planId: number, paymentMethod: 'alipay' | 'wxpay'): Promise<void> => {
    setPayingPlanId(planId)
    try {
      const result = await window.spark.invoke('platform-model:pay', { planId, paymentMethod })
      toast.success(result.paid ? '订阅已开通' : '已在浏览器打开支付页面，完成后请点击刷新')
      if (result.paid) await refresh(false)
      else void pollPaymentResult(planId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发起支付失败')
    } finally {
      setPayingPlanId(null)
    }
  }

  const openPurchaseLink = async (id: number): Promise<void> => {
    try {
      await window.spark.invoke('platform-model:open-purchase-link', { id })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开购买渠道失败')
    }
  }

  const usedPercent = subscription && subscription.amountTotal > 0
    ? Math.min(100, Math.round(subscription.amountUsed / subscription.amountTotal * 100))
    : 0

  const goToUsageStats = (): void => {
    setTweak('view', 'settings')
    setTweak('settingsSection', 'usage')
  }

  return (
    <div className="account-panel platform-model-panel">
      <div className="account-panel-head platform-model-panel__head">
        <div>
          <h4>Spark 平台模型</h4>
          <p>无需配置 API Key。它会作为一个可选 Provider 与你的第三方模型并存。</p>
        </div>
        <Button type="text" loading={loading} onClick={() => void refresh(false)}>刷新</Button>
      </div>

      {status?.sessionConflict ? (
        <div className="platform-model-panel__notice">
          <span>{status.message || '平台账户已在其他设备使用'}</span>
          <Button type="primary" onClick={() => void refresh(true)}>在本机继续</Button>
        </div>
      ) : (
        <>
          {subscription ? (
            <div className="platform-model-panel__subscription">
              <div className="platform-model-panel__metric">
                <strong>{subscription.planTitle || plans.find(plan => plan.id === subscription.planId)?.title || `套餐 #${subscription.planId}`}</strong>
                <span>{usedPercent}% 已使用</span>
              </div>
              <div className="platform-model-panel__progress"><i style={{ width: `${usedPercent}%` }} /></div>
              <div className="platform-model-panel__meta">
                <span>已用 {formatQuota(subscription.amountUsed)}</span>
                <span>总额 {formatQuota(subscription.amountTotal)}</span>
                {subscription.expiresAt ? <span>到期 {formatTime(subscription.expiresAt)}</span> : null}
              </div>
            </div>
          ) : null}
          <div className="platform-model-panel__plans">
            {subscription ? <strong className="platform-model-panel__renew-title">续费或更换套餐</strong> : null}
            {plans.map(plan => (
              <div className="platform-model-panel__plan" key={plan.id}>
                <div><strong>{plan.title}</strong><span>{plan.subtitle}</span></div>
                <b>{formatPrice(plan.priceAmount, plan.currency)}</b>
                <div className="platform-model-panel__plan-actions">
                  <Button type="primary" loading={payingPlanId === plan.id} onClick={() => void pay(plan.id, 'alipay')}>
                    {subscription ? '支付宝续费' : '支付宝购买'}
                  </Button>
                  <Button loading={payingPlanId === plan.id} onClick={() => void pay(plan.id, 'wxpay')}>
                    {subscription ? '微信续费' : '微信购买'}
                  </Button>
                </div>
              </div>
            ))}
            {!loading && plans.length === 0 ? <span className="platform-model-panel__empty">暂无可购买套餐</span> : null}
          </div>
        </>
      )}

      <div className="platform-model-panel__redeem">
        <Input
          value={redeemCode}
          onChange={event => setRedeemCode(event.target.value)}
          onPressEnter={() => void redeem()}
          placeholder="输入兑换码"
        />
        <Button type="primary" loading={redeeming} disabled={!redeemCode.trim()} onClick={() => void redeem()}>兑换</Button>
      </div>
      <p className="platform-model-panel__hint">兑换码可增加可用余额。</p>
      {purchaseLinks.length > 0 ? (
        <div className="platform-model-panel__purchase-links">
          <strong>购买兑换码</strong>
          <div className="platform-model-panel__purchase-actions">
            {purchaseLinks.map(link => (
              <Button key={link.id} onClick={() => void openPurchaseLink(link.id)} title={link.description}>
                {link.name}
              </Button>
            ))}
          </div>
          <span>购买完成后返回此处输入兑换码。</span>
        </div>
      ) : null}
      {usage ? (
        <div className="platform-model-panel__usage">
          <div className="platform-model-panel__metric">
            <strong>通用额度</strong>
            <span className="platform-model-panel__balance">{formatUsageQuota(usage.walletQuota)}</span>
          </div>
          <button type="button" className="platform-model-panel__usage-link" onClick={goToUsageStats}>
            最近消耗 →
          </button>
        </div>
      ) : null}
    </div>
  )
}

function formatPrice(value: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(value)
  } catch {
    return `${currency || 'USD'} ${value.toFixed(2)}`
  }
}

function formatQuota(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatUsageQuota(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value)
}

function formatTime(value: number): string {
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value
  return new Date(milliseconds).toLocaleString('zh-CN')
}
