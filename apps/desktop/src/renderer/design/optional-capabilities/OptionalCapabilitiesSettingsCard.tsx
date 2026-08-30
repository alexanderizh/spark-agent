import { useState } from 'react'
import { Button, Progress, Switch } from 'antd'
import type { OptionalCapabilityId, OptionalCapabilityItem } from '@spark/protocol'
import { useApp } from '../AppContext'
import { useOptionalCapabilities } from './useOptionalCapabilities'

export function OptionalCapabilitiesSettingsCard() {
  const { requestConfirm } = useApp()
  const actions = useOptionalCapabilities()
  const [busy, setBusy] = useState<OptionalCapabilityId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (id: OptionalCapabilityId, action: () => Promise<void>) => {
    setBusy(id)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const uninstall = async (item: OptionalCapabilityItem) => {
    const confirmed = await requestConfirm({
      title: `卸载${item.displayName}`,
      description: '卸载后再次使用该功能需要重新下载资源。',
      confirmText: '卸载',
      danger: true,
    })
    if (confirmed) await run(item.id, () => actions.uninstall(item.id))
  }

  const refresh = async () => {
    setError(null)
    try {
      await actions.refresh(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <section className="settings-section optional-capability-settings">
      <div className="voice-integrity-header">
        <div className="voice-integrity-heading">
          <h3>可选功能组件</h3>
          <p>Codex、Office、视频处理、浏览器和语音资源按需安装，不占用基础安装包空间。</p>
        </div>
        <Button loading={actions.loading} onClick={() => void refresh()}>
          检查更新
        </Button>
      </div>
      {error && <div className="integrity-banner error">{error}</div>}
      <div className="settings-card integrity-sdk-card">
        {actions.snapshot?.capabilities.map((item, index) => {
          const progress = actions.progress[item.id]
          return (
            <div key={item.id} className={`integrity-sdk-row ${index > 0 ? 'bordered' : ''}`}>
              <div className="integrity-sdk-info">
                <div className="integrity-sdk-name">{item.displayName}</div>
                <div className="integrity-sdk-version">
                  {statusText(item)}
                  {item.targetVersion ? ` · 最新 ${item.targetVersion}` : ''}
                </div>
                <div className="voice-integrity-desc">{item.description}</div>
                {progress && ['queued', 'downloading', 'verifying', 'extracting', 'activating'].includes(progress.phase) && (
                  <div className="voice-integrity-progress-wrap">
                    <Progress percent={progress.percent ?? 0} size="small" />
                    <span>{progress.message}</span>
                  </div>
                )}
                {item.error && <div className="integrity-sdk-error">{item.error}</div>}
              </div>
              <div className="integrity-sdk-right">
                {item.installedVersion && (
                  <label>
                    自动更新{' '}
                    <Switch
                      size="small"
                      checked={item.autoUpdate}
                      onChange={(enabled) =>
                        void run(item.id, () => actions.setAutoUpdate(item.id, enabled))
                      }
                    />
                  </label>
                )}
                <Button
                  type="primary"
                  loading={busy === item.id}
                  disabled={item.targetVersion == null}
                  onClick={() => void run(item.id, () => primaryAction(item, actions))}
                >
                  {primaryLabel(item)}
                </Button>
                {item.installedVersion && item.supportsUninstall !== false && (
                  <Button danger onClick={() => void uninstall(item)}>卸载</Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function statusText(item: OptionalCapabilityItem): string {
  if (item.state === 'ready') return `已安装 ${item.installedVersion}`
  if (item.state === 'update_available') return `已安装 ${item.installedVersion}，有更新`
  if (item.state === 'damaged') return `组件损坏 · ${item.installedVersion}`
  if (item.state === 'error') return '安装失败'
  return item.targetVersion ? `未安装 · 下载 ${(item.downloadSize / 1024 / 1024).toFixed(1)} MB` : '当前平台暂不可用'
}

function primaryLabel(item: OptionalCapabilityItem): string {
  if (item.state === 'update_available') return '更新'
  if (item.state === 'damaged' || item.state === 'error') return '修复'
  if (item.installedVersion) return '重新安装'
  return '安装'
}

function primaryAction(
  item: OptionalCapabilityItem,
  actions: ReturnType<typeof useOptionalCapabilities>,
): Promise<void> {
  if (item.state === 'update_available') return actions.update(item.id)
  if (item.state === 'damaged' || item.state === 'error') return actions.repair(item.id)
  return actions.install(item.id)
}
