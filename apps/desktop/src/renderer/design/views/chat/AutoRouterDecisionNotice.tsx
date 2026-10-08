import { useId } from 'react'
import { Shuffle, TriangleAlert } from 'lucide-react'
import type { AutoRouterDecisionEvent } from '@spark/protocol'
import {
  ROUTER_INTENSITY_COLOR,
  ROUTER_INTENSITY_LABEL,
  decayedFrozenRemainingMs,
  routerIntensityColor,
} from '../../utils/auto-router-display'
import './AutoRouterDecisionNotice.less'

/**
 * AutoRouter 路由决策展示（显示点 2/3）：
 * - notice 形态：轮次边界提示条（仅当本轮实际模型与上一轮不同时渲染，与手动
 *   ModelSwitchNotice 同视觉模式；数据源为 session_events 持久化的
 *   auto_router_decision 事件，重进会话/跨设备不丢）。
 * - meta 形态：轮次 meta 行常驻小标识（强度色点 + 模型名），每轮可见。
 */

const INTENSITY_LABEL = ROUTER_INTENSITY_LABEL
const INTENSITY_COLOR = ROUTER_INTENSITY_COLOR

/** 兼容既有调用面（强度色点取色统一走 utils/auto-router-display）。 */
export function intensityDotColor(intensity: AutoRouterDecisionEvent['intensity']): string {
  return routerIntensityColor(intensity)
}

export function AutoRouterDecisionNotice({ decision }: { decision: AutoRouterDecisionEvent }) {
  const tooltipId = useId()
  const degraded = decision.fallbackUsed
  const mismatched = decision.adapterMismatch === true
  const healthAvoided =
    decision.skippedFrozenExecutors != null && decision.skippedFrozenExecutors.length > 0
  const action = mismatched
    ? '引擎不匹配回退'
    : healthAvoided
      ? '故障避让路由'
      : degraded
        ? '分流降级'
        : '已路由'
  const modelName = decision.modelDisplayName || decision.resolvedModelId
  const frozenSummary = healthAvoided
    ? decision
        .skippedFrozenExecutors!.map((item) => {
          // frozenRemainingMs 是路由时刻的瞬时值：按事件 timestamp 锚点衰减，
          // 避免历史会话永远显示「剩 N 分钟」；到期展示为已解冻。
          const remaining = decayedFrozenRemainingMs(decision.timestamp, item.frozenRemainingMs)
          return remaining == null
            ? `${item.modelId}（已解冻）`
            : `${item.modelId}（剩 ${Math.max(1, Math.ceil(remaining / 60_000))} 分钟）`
        })
        .join('、')
    : ''
  return (
    <div className="model-switch-notice auto-router-notice" role="status">
      <span className="model-switch-notice-line" />
      <span className="model-switch-notice-content">
        {degraded || mismatched || healthAvoided ? (
          <TriangleAlert aria-hidden size={14} strokeWidth={1.4} />
        ) : (
          <Shuffle aria-hidden size={14} strokeWidth={1.4} />
        )}
        <span className="auto-router-notice-detail" tabIndex={0} aria-describedby={tooltipId}>
          <span className="auto-router-notice-summary">
            {action} →{' '}
            <span
              className="auto-router-notice-model"
              style={{ color: INTENSITY_COLOR[decision.intensity] }}
            >
                {modelName} {INTENSITY_LABEL[decision.intensity]}
            </span>
            {decision.reason.length > 0 ? (
              <span className="auto-router-notice-reason"> · {decision.reason}</span>
            ) : null}
          </span>
          <span id={tooltipId} className="model-switch-notice-tooltip" role="tooltip">
            {action} → ●{INTENSITY_LABEL[decision.intensity]} {modelName}
            {decision.reason.length > 0 ? ` · ${decision.reason}` : ''}
            <span className="auto-router-notice-tooltip-meta">
              路由器：{decision.routerName}｜强度：{INTENSITY_LABEL[decision.intensity]}
              {decision.prevIntensity != null
                ? `（上轮 ${INTENSITY_LABEL[decision.prevIntensity]}）`
                : '（首轮）'}
              ｜推理强度：{decision.reasoningEffort ?? '跟随会话'}
              ｜分流耗时：{Math.round(decision.latencyMs)}ms
              {decision.fallbackUsed ? `｜兜底：${decision.fallbackStage ?? 'unknown'}` : ''}
              {healthAvoided ? `｜避让冻结模型：${frozenSummary}` : ''}
              {decision.healthFallbackUsed === true
                ? '｜全部执行模型冻结中，已选最快解冻的条目尽力执行'
                : ''}
            </span>
          </span>
        </span>
      </span>
      <span className="model-switch-notice-line" />
    </div>
  )
}

/** 轮次 meta 行常驻标识：⚙ ●强度 模型名（每轮可见，无提示条也知道是谁在干活）。 */
export function AutoRouterTurnMetaTag({ decision }: { decision: AutoRouterDecisionEvent }) {
  return (
    <span
      className="auto-router-meta-tag"
      title={`智能路由 · ${decision.routerName} · ${INTENSITY_LABEL[decision.intensity]}强度${
        decision.fallbackUsed ? '（分流降级，规则兜底）' : ''
      }`}
    >
      <Shuffle aria-hidden size={11} strokeWidth={1.8} className="auto-router-meta-icon" />
      <span
        className="auto-router-meta-dot"
        style={{ background: INTENSITY_COLOR[decision.intensity] }}
        aria-hidden
      />
      {INTENSITY_LABEL[decision.intensity]} · {decision.modelDisplayName || decision.resolvedModelId}
    </span>
  )
}
