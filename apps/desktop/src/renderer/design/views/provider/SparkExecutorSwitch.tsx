import { Switch, Tooltip } from 'antd'
import { Icons } from '../../Icons'
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
        <span className="pv_form_label_title">
          Spark执行引擎
          <Tooltip
            title="开启时使用自建引擎执行任务，关闭则根据接口协议自动选择 Claude SDK 或 Codex Runtime"
            overlayStyle={{ maxWidth: 340 }}
          >
            <Icons.HelpCircle className="pv_form_label_help" size={13} />
          </Tooltip>
        </span>
      </label>
      <div className="pv_form_control_inline pv_spark_executor_control">
        <Switch
          size="middle"
          checked={checked && !disabled}
          disabled={disabled}
          onChange={(next: boolean) => onChange(next)}
        />
        {disabled && (
          <div
            className="pv_spark_executor_hint"
            role="note"
            title={SPARK_EXECUTOR_UNAVAILABLE_HINTS[availability.reason]}
          >
            {SPARK_EXECUTOR_UNAVAILABLE_HINTS[availability.reason]}
          </div>
        )}
      </div>
    </>
  )
}
