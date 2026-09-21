import { useId } from 'react'
import { Shuffle, TriangleAlert } from 'lucide-react'
import type { AutoRouterDecisionEvent } from '@spark/protocol'
import './AutoRouterDecisionNotice.less'

/**
 * AutoRouter 路由决策展示（显示点 2/3）：
 * - notice 形态：轮次边界提示条（仅当本轮实际模型与上一轮不同时渲染，与手动
 *   ModelSwitchNotice 同视觉模式；数据源为 session_events 持久化的
 *   auto_router_decision 事件，重进会话/跨设备不丢）。
 * - meta 形态：轮次 meta 行常驻小标识（强度色点 + 模型名），每轮可见。
 */

const INTENSITY_LABEL: Record<AutoRouterDecisionEvent['intensity'], string> = {
  high: '高',
  balanced: '平衡',
  low: '低',
}

const INTENSITY_COLOR: Record<AutoRouterDecisionEvent['intensity'], string> = {
  high: 'var(--danger)',
  balanced: 'var(--success)',
  low: 'var(--info)',
}

export function intensityDotColor(intensity: AutoRouterDecisionEvent['intensity']): string {
  return INTENSITY_COLOR[intensity]
}

export function AutoRouterDecisionNotice({ decision }: { decision: AutoRouterDecisionEvent }) {
  const tooltipId = useId()
  const degraded = decision.fallbackUsed
  const mismatched = decision.adapterMismatch === true
  const lead = degraded || mismatched ? '⚠' : '⚙'
  const action = mismatched ? '引擎不匹配回退' : degraded ? '分流降级' : '已路由'
  return (
    <div className="model-switch-notice auto-router-notice" role="status">
      <span className="model-switch-notice-line" />
      <span className="model-switch-notice-content">
        {degraded || mismatched ? (
          <TriangleAlert aria-hidden size={16} strokeWidth={1.8} />
        ) : (
          <Shuffle aria-hidden size={16} strokeWidth={1.8} />
        )}
        <span>
          {lead} {action} →{' '}
          <span
            className="auto-router-notice-model"
            style={{ color: INTENSITY_COLOR[decision.intensity] }}
          >
            ●{INTENSITY_LABEL[decision.intensity]} {decision.modelDisplayName || decision.resolvedModelId}
          </span>
          {decision.reason.length > 0 ? ` · ${decision.reason}` : ''}
        </span>
        <span className="model-switch-notice-help" tabIndex={0} aria-describedby={tooltipId}>
          <span id={tooltipId} className="model-switch-notice-tooltip" role="tooltip">
            路由器：{decision.routerName}｜强度：{INTENSITY_LABEL[decision.intensity]}
            {decision.prevIntensity != null
              ? `（上轮 ${INTENSITY_LABEL[decision.prevIntensity]}）`
              : '（首轮）'}
            ｜分流耗时：{Math.round(decision.latencyMs)}ms
            {decision.fallbackUsed ? `｜兜底：${decision.fallbackStage ?? 'unknown'}` : ''}
          </span>
        </span>
      </span>
      <span className="model-switch-notice-line" />
    </div>
  )
}

/** 轮次 meta 行常驻标识：●强度色点 + 模型名（每轮可见，无提示条也知道是谁在干活）。 */
export function AutoRouterTurnMetaTag({ decision }: { decision: AutoRouterDecisionEvent }) {
  return (
    <span
      className="auto-router-meta-tag"
      title={`智能路由 · ${decision.routerName} · ${INTENSITY_LABEL[decision.intensity]}强度`}
    >
      <span
        className="auto-router-meta-dot"
        style={{ background: INTENSITY_COLOR[decision.intensity] }}
        aria-hidden
      />
      {decision.modelDisplayName || decision.resolvedModelId}
    </span>
  )
}
