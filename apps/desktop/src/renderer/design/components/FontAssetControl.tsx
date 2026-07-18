import { Button, Progress, Tag } from 'antd'
import { useState } from 'react'
import { useManagedFontAssets } from '../hooks/useManagedFontAssets'
import './FontAssetControl.less'

export function FontAssetControl() {
  const { status, install } = useManagedFontAssets()
  const [manualBusy, setManualBusy] = useState(false)
  const downloading = status.state === 'downloading' || manualBusy

  const label = status.state === 'ready'
    ? `云端字体 ${status.version ?? ''} 已安装`
    : status.state === 'downloading'
      ? status.message
      : status.state === 'error'
        ? '下载失败，当前使用系统字体'
        : '尚未下载，当前使用系统字体'

  const tagColor = status.state === 'ready'
    ? 'success'
    : status.state === 'error'
      ? 'error'
      : status.state === 'downloading'
        ? 'processing'
        : 'default'

  const handleInstall = async () => {
    setManualBusy(true)
    try {
      await install(true)
    } finally {
      setManualBusy(false)
    }
  }

  return (
    <div className="font-asset-control">
      <div className="font-asset-status">
        <Tag color={tagColor}>{label}</Tag>
        <Button
          size="small"
          loading={downloading}
          disabled={downloading}
          onClick={() => void handleInstall()}
        >
          {status.state === 'ready' ? '重新下载' : status.state === 'error' ? '重试下载' : '立即下载'}
        </Button>
      </div>
      {status.state === 'downloading' && status.percent != null && (
        <Progress percent={status.percent} size="small" showInfo={false} />
      )}
      <div className="font-asset-hint">
        包含 Geist、Geist Mono 与 HarmonyOS Sans SC；应用启动后会自动下载，失败不影响使用。
      </div>
      {status.lastError != null && <div className="font-asset-error">{status.lastError}</div>}
    </div>
  )
}
