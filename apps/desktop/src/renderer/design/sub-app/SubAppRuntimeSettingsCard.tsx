/**
 * SubAppRuntimeSettingsCard - 设置「子应用」分区的运行时安全开关卡片。
 *
 * 三个开关对应子应用沙箱 CSP 与源码长度限制（默认全部放行，本地应用用户
 * 自担风险模型）。改动即时写入双层存储并广播 spark-settings-updated，
 * 正在运行的子应用实例（useSubAppRunner 监听同一事件）会按新设置重建文档。
 */
import React from 'react'
import { InputNumber, Switch } from 'antd'
import {
  fetchSubAppRuntimeSettings,
  normalizeSubAppRuntimeSettings,
  persistSubAppRuntimeSettings,
  readCachedSubAppRuntimeSettings,
  type SubAppRuntimeSettings,
} from './subAppRuntimeSettings'

const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'

function SettingsRow({
  title,
  desc,
  right,
}: {
  title: string
  desc?: string
  right: React.ReactNode
}) {
  return (
    <div className="settings-card-row">
      <div className="flex1 min-w-0">
        <div className="row-title">{title}</div>
        {desc && <div className="row-desc">{desc}</div>}
      </div>
      <div className="row-action">{right}</div>
    </div>
  )
}

export function SubAppRuntimeSettingsCard(): React.ReactElement {
  const [settings, setSettings] = React.useState<SubAppRuntimeSettings>(() =>
    readCachedSubAppRuntimeSettings(),
  )

  React.useEffect(() => {
    let cancelled = false
    void fetchSubAppRuntimeSettings().then((value) => {
      if (!cancelled) setSettings(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const update = (patch: Partial<SubAppRuntimeSettings>) => {
    setSettings((prev) => {
      const next = normalizeSubAppRuntimeSettings({ ...prev, ...patch })
      persistSubAppRuntimeSettings(next)
      window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: { key: 'sub-app' } }))
      return next
    })
  }

  return (
    <div className="settings-section">
      <div className="subsec-h">运行时限制</div>
      <div className="settings-card">
        <SettingsRow
          title="允许子应用访问外部网络"
          desc="开启后子应用可直接 fetch/XHR 任意外部地址（如调用第三方 API）。注意：应用也可能借此把本地数据发送到任意外部服务器，请只运行可信应用。关闭后应用只能通过 sparkApp 数据桥与外界交换数据。"
          right={
            <Switch
              size="middle"
              checked={settings.allowNetworkAccess}
              onChange={(v) => update({ allowNetworkAccess: v })}
            />
          }
        />
        <SettingsRow
          title="允许运行时代码编译（unsafe-eval）"
          desc="开启后子应用内可使用 babel-standalone 等实时编译 JSX / 新语法。关闭后仅可直接运行的脚本可用，React 需走预编译产物或 createElement 写法。"
          right={
            <Switch
              size="middle"
              checked={settings.allowUnsafeEval}
              onChange={(v) => update({ allowUnsafeEval: v })}
            />
          }
        />
        <SettingsRow
          title="源码长度上限（字符）"
          desc="超过上限的子应用源码将被拒绝保存运行。0 表示不限制（仍保留 5 MB 进程间硬安全上限）。"
          right={
            <InputNumber
              size="middle"
              min={0}
              step={50_000}
              value={settings.sourceLengthLimit}
              onChange={(v) => update({ sourceLengthLimit: typeof v === 'number' ? v : 0 })}
              addonAfter={settings.sourceLengthLimit === 0 ? '不限制' : undefined}
              style={{ width: 140 }}
            />
          }
        />
      </div>
      <div className="subsec-h">说明</div>
      <div className="settings-card">
        <SettingsRow
          title="默认策略"
          desc="本地优先应用默认放行以上能力，风险由用户自行确认。若只运行来路不明的应用，建议关闭外部网络访问。"
          right={<span className="badge">默认放行</span>}
        />
      </div>
    </div>
  )
}
