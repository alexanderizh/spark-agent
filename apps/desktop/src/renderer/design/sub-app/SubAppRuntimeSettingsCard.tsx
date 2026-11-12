/**
 * SubAppRuntimeSettingsCard - 设置「子应用」分区的源码长度限制。
 *
 * 改动即时写入双层存储并广播 spark-settings-updated，
 * 正在运行的子应用实例（useSubAppRunner 监听同一事件）会按新设置重建文档。
 */
import React from 'react'
import { InputNumber } from 'antd'
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
      <div className="subsec-h">源码限制</div>
      <div className="settings-card">
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
          title="浏览器渲染能力"
          desc="子应用按 Chromium 浏览器能力运行，不额外限制脚本、网络、表单、iframe、弹窗或页面导航；应用与 SparkWork 主窗口隔离，不提供 Node.js API。请仅运行可信应用。"
          right={<span className="badge">浏览器模式</span>}
        />
      </div>
    </div>
  )
}
