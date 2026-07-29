import { Button } from '@lobehub/ui'
import { useState } from 'react'
import { useManagedFontAssets } from '../hooks/useManagedFontAssets'
import './FontAssetControl.less'

export function FontAssetControl() {
  const { status, install } = useManagedFontAssets()
  const [manualBusy, setManualBusy] = useState(false)
  const downloading = status.state === 'downloading' || manualBusy

  const badge =
    status.state === 'ready' ? (
      <span className="badge success dot">已安装</span>
    ) : status.state === 'error' ? (
      <span className="badge danger dot">下载失败</span>
    ) : status.state === 'downloading' ? (
      <span className="badge info dot">下载中</span>
    ) : (
      <span className="badge warning dot">未下载</span>
    )

  const buttonText =
    status.state === 'ready' ? '重新下载' : status.state === 'error' ? '重试下载' : '立即下载'

  const handleInstall = async () => {
    setManualBusy(true)
    try {
      await install(true)
    } finally {
      setManualBusy(false)
    }
  }

  const percent =
    status.state === 'downloading' && status.percent != null
      ? Math.max(0, Math.min(100, status.percent))
      : null

  return (
    <div className="font-asset-control">
      <div className="font-asset-status">
        {badge}
        <Button
          size="small"
          type='text'
          loading={downloading}
          disabled={downloading}
          onClick={() => void handleInstall()}
        >
          {buttonText}
        </Button>
      </div>
      {percent != null && (
        <div
          className="font-asset-progress"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="font-asset-progress-track">
            <div className="font-asset-progress-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      <div className="font-asset-hint">
        包含 Geist、Geist Mono 与 HarmonyOS Sans SC；应用启动后会自动下载，失败不影响使用。
      </div>
      {status.lastError != null && <div className="font-asset-error">{status.lastError}</div>}
    </div>
  )
}
