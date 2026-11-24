/**
 * 远程会话配置面板（检查器旁的「配置」tab，2026-11-25 对齐本地会话配置面板）。
 *
 * 数据与写回完全复用 useRemoteComposerConfig（与底部输入框的 chips 同源同链路）：
 *   GET  /v1/catalog + /v1/sessions/:id/runtime → 展示当前 助手/模型/权限/推理强度
 *   PATCH /v1/sessions/:id → 就地写回（写成功后 optimistic 合并，不重拉）
 *
 * 独立实例化说明：RemoteChatPane 里的那份实例服务输入框 chips，两份实例共享
 * 模块级目录缓存（5 分钟 TTL），只有 runtime 多一次轻量请求——为复用而不把
 * ChatPane 的状态提升到宿主层是刻意的（并行开发期间不动 ChatPane）。
 */
import { useMemo } from 'react'
import { Icons } from '../../Icons'
import { useRemoteComposerConfig } from './useRemoteComposerConfig'
import {
  buildAgentOptions,
  buildModelOptions,
  buildPermissionOptions,
  buildReasoningOptions,
  modelLabel,
  permissionLabel,
  resolveAdapter,
  type RemoteModelOption,
  type RemoteSelectOption,
} from './remoteComposerModel'

function ConfigRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="rc-cfg-row">
      <label className="rc-cfg-label">
        <span className="rc-cfg-label-text">{label}</span>
        {hint != null && <span className="rc-cfg-label-hint">{hint}</span>}
      </label>
      <div className="rc-cfg-control">{children}</div>
    </div>
  )
}

function ConfigSelect({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string | null
  options: RemoteSelectOption[]
  placeholder: string
  disabled?: boolean
  onChange: (id: string) => void
}) {
  if (options.length === 0) {
    return <span className="rc-cfg-static">{placeholder}</span>
  }
  return (
    <select
      className="rc-cfg-select"
      value={options.find((option) => option.selected)?.id ?? value ?? ''}
      disabled={disabled === true}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export interface RemoteSessionConfigPanelProps {
  deviceId: string
  sessionId: string | null
}

export function RemoteSessionConfigPanel({ deviceId, sessionId }: RemoteSessionConfigPanelProps) {
  const config = useRemoteComposerConfig(deviceId, sessionId)

  const agentOptions = useMemo(
    () => buildAgentOptions(config.catalog, config.runtime),
    [config.catalog, config.runtime],
  )
  const modelOptions = useMemo(
    () => buildModelOptions(config.catalog, config.runtime),
    [config.catalog, config.runtime],
  )
  const adapter = useMemo(
    () => resolveAdapter(config.catalog, config.runtime),
    [config.catalog, config.runtime],
  )
  const permissionOptions = useMemo(
    () => buildPermissionOptions(config.catalog, adapter, config.runtime?.permissionMode),
    [adapter, config.catalog, config.runtime?.permissionMode],
  )
  const reasoningOptions = useMemo(
    () => buildReasoningOptions(config.catalog, config.runtime),
    [config.catalog, config.runtime],
  )

  if (sessionId == null) {
    return (
      <div className="rc-panel-placeholder">
        <Icons.Settings size={20} />
        <p>尚未选择会话；选择会话后可查看与调整运行配置。</p>
      </div>
    )
  }

  if (config.loading && config.runtime == null && config.catalog == null) {
    return (
      <div className="rc-panel-placeholder">
        <Icons.Settings size={20} />
        <p>正在读取会话配置…</p>
      </div>
    )
  }

  return (
    <div className="rc-panel-section">
      <div className="rc-panel-section-head">
        <span>运行配置</span>
        <span className="rc-panel-section-count">{config.saving ? '保存中…' : '远程生效'}</span>
      </div>

      {config.error != null && (
        <div className="rc-pane-hint error">
          {config.error}
          <button type="button" className="rc-link-btn" onClick={() => void config.reload()}>
            重试
          </button>
        </div>
      )}

      {!config.catalogSupported && (
        <div className="rc-panel-hint-note">这台电脑的 SparkWork 版本较旧，暂不支持修改配置</div>
      )}

      <ConfigRow label="助手" hint="会话使用的助手">
        <ConfigSelect
          value={config.runtime?.agentId ?? null}
          options={agentOptions}
          placeholder="电脑默认助手"
          disabled={!config.catalogSupported}
          onChange={(id) => void config.setAgent(id)}
        />
      </ConfigRow>

      <ConfigRow label="模型" hint="推理模型">
        <ConfigSelect
          value={modelLabel(config.catalog, config.runtime)}
          options={modelOptions}
          placeholder="电脑默认模型"
          disabled={!config.catalogSupported}
          onChange={(id) => {
            const option = modelOptions.find((item): item is RemoteModelOption => item.id === id)
            if (option != null) void config.setModel(option)
          }}
        />
      </ConfigRow>

      <ConfigRow label="权限" hint="工具执行审批档位">
        <ConfigSelect
          value={permissionLabel(config.catalog, config.runtime).label}
          options={permissionOptions}
          placeholder="电脑默认"
          disabled={!config.catalogSupported}
          onChange={(id) => void config.setPermission(id)}
        />
      </ConfigRow>

      <ConfigRow label="推理力度" hint="思考深度（minimal…max）">
        <ConfigSelect
          value={config.runtime?.reasoningEffort ?? null}
          options={reasoningOptions}
          placeholder="电脑默认"
          disabled={!config.catalogSupported}
          onChange={(id) => void config.setReasoning(id)}
        />
      </ConfigRow>

      <div className="rc-panel-hint-note">修改即时写回目标电脑，对本会话后续回合生效</div>
    </div>
  )
}
