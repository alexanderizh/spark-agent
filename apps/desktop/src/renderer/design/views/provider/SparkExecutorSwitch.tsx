import { Switch } from 'antd'
import {
  SPARK_EXECUTOR_UNAVAILABLE_HINTS,
  sparkExecutorAvailability,
} from '../../utils/sparkExecutorAvailability'

/**
 * 模型配置表单「使用 Spark 执行器」开关。
 *
 * 仅决定该渠道会话的默认引擎（spark），渠道协议、端点、密钥等配置不变；
 * 会话内仍可手动切回 claude / codex 适配器。
 * 渠道协议无法映射到 spark 引擎上游协议时（仅 Chat Completions 的 OpenAI 格式渠道）
 * 开关置灰并提示原因，提交层会同时把 useSparkExecutor 落为 false 保持数据一致。
 */
export function SparkExecutorSwitch({
  checked,
  provider,
  codexApiKind,
  onChange,
}: {
  checked: boolean
  provider: 'anthropic' | 'openai'
  codexApiKind: 'chat' | 'responses' | 'embedding' | null | undefined
  onChange: (checked: boolean) => void
}) {
  const availability = sparkExecutorAvailability(provider, codexApiKind)
  const disabled = !availability.available
  return (
    <>
      <label className="pv_form_label">
        执行引擎
        <span className="pv_form_sub">开启后该渠道会话默认使用自研 Spark 执行器执行任务</span>
      </label>
      <div className="pv_form_control_inline">
        <Switch
          size="middle"
          checked={checked && !disabled}
          disabled={disabled}
          onChange={(next: boolean) => onChange(next)}
        />
      </div>
      {disabled && (
        <div className="pv_spark_executor_hint" role="note">
          {SPARK_EXECUTOR_UNAVAILABLE_HINTS[availability.reason]}
        </div>
      )}
    </>
  )
}
