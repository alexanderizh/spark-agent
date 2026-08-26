import { useEffect, useState } from 'react'
import { CheckCircle2, Download, LoaderCircle, Settings, TriangleAlert } from 'lucide-react'
import type { SdkIntegrityInstallProgress } from '@spark/protocol'
import { useApp } from '../../AppContext'
import { SdkInstallProgressView } from '../../components/SdkInstallProgress'
import {
  CODEX_SDK_PACKAGE,
  fetchCodexRuntimeInstalled,
  findCodexRuntimeInstalled,
  readCachedCodexRuntimeInstalled,
  sharedCodexRuntimeInstall,
} from '../../utils/codex-runtime-install'

type RuntimeState = 'checking' | 'missing' | 'ready'
type InstallPhase = 'idle' | 'installing' | 'error'

/**
 * OpenAI 格式对话渠道配置时的 Codex 运行时常驻提示条。
 * 运行时为按需安装的本地依赖：固定说明文案 + 实时检测结果徽标，
 * 未安装时提供一键下载入口；未安装也不阻断保存渠道，保存后可随时补装。
 */
export function ProviderCodexRuntimeNotice() {
  const { setTweak } = useApp()
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(() => {
    const cached = readCachedCodexRuntimeInstalled()
    return cached === false ? 'missing' : cached === true ? 'ready' : 'checking'
  })
  const [installPhase, setInstallPhase] = useState<InstallPhase>('idle')
  const [progress, setProgress] = useState<SdkIntegrityInstallProgress | null>(null)

  useEffect(() => {
    let cancelled = false
    // 缓存命中后仍刷新一次本地检测，避免读到安装完成前的旧缓存。
    void fetchCodexRuntimeInstalled()
      .then((installed) => {
        if (cancelled || installed == null) return
        setRuntimeState(installed ? 'ready' : 'missing')
      })
      .catch(() => undefined)

    const unsubIntegrity = window.spark?.on?.('stream:sdk:integrity', (payload) => {
      const installed = findCodexRuntimeInstalled(payload)
      if (installed != null) setRuntimeState(installed ? 'ready' : 'missing')
    })
    const unsubProgress = window.spark?.on?.('stream:sdk:install-progress', (payload) => {
      if (payload.packageName !== CODEX_SDK_PACKAGE) return
      setProgress(payload)
      if (payload.state === 'done') {
        // 安装完成后直接收敛到「已安装」常态，由徽标承担成功反馈。
        setInstallPhase('idle')
        setRuntimeState('ready')
      } else if (payload.state === 'error') {
        setInstallPhase('error')
      } else {
        setInstallPhase('installing')
      }
    })
    return () => {
      cancelled = true
      unsubIntegrity?.()
      unsubProgress?.()
    }
  }, [])

  const install = async () => {
    if (installPhase === 'installing') return
    setInstallPhase('installing')
    try {
      await sharedCodexRuntimeInstall()
      setInstallPhase('idle')
      setRuntimeState('ready')
      setProgress(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Codex runtime 安装失败：${String(error)}`
      setInstallPhase('error')
      setProgress((current) => ({
        packageName: CODEX_SDK_PACKAGE,
        state: 'error',
        downloaded: current?.downloaded ?? 0,
        total: current?.total ?? 0,
        percent: current?.percent ?? null,
        message,
      }))
    }
  }

  // 只有「当前确实不可用」（缺失或本次安装失败）才走警示配色，其余保持中性信息条。
  const warned = runtimeState === 'missing' || installPhase === 'error'
  const showInstallEntry = runtimeState !== 'ready'

  // 徽标优先反映进行中的安装，其次反映检测结果。
  const busy = installPhase === 'installing' || runtimeState === 'checking'
  const badgeTone = busy ? 'is-busy' : runtimeState === 'ready' ? 'is-ok' : 'is-warn'
  const badgeLabel = busy
    ? installPhase === 'installing'
      ? '正在安装'
      : '检测中'
    : runtimeState === 'ready'
      ? '已安装'
      : '未安装'

  return (
    <div
      className={`pv_codex_runtime_notice is-${runtimeState} ${warned ? 'is-warning' : 'is-calm'} is-${installPhase}`}
      role={warned ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="pv_codex_runtime_notice_status">
        {busy ? (
          <LoaderCircle size={14} aria-hidden="true" />
        ) : runtimeState === 'ready' ? (
          <CheckCircle2 size={14} aria-hidden="true" />
        ) : (
          <TriangleAlert size={14} aria-hidden="true" />
        )}
        <span className="pv_codex_runtime_notice_text">
          Codex 运行时为本地按需安装依赖，OpenAI 格式渠道发起会话前需要就绪，未安装也可先保存。
        </span>
        <span className={`pv_codex_runtime_notice_badge ${badgeTone}`}>
          {runtimeState === 'ready' && !busy ? (
            <CheckCircle2 size={11} aria-hidden="true" />
          ) : busy ? (
            <LoaderCircle size={11} aria-hidden="true" />
          ) : (
            <TriangleAlert size={11} aria-hidden="true" />
          )}
          {badgeLabel}
        </span>
      </div>
      {(installPhase === 'installing' || installPhase === 'error') && progress != null && (
        <div className="pv_codex_runtime_notice_progress">
          <SdkInstallProgressView progress={progress} compact />
        </div>
      )}
      {showInstallEntry && (
        <div className="pv_codex_runtime_notice_actions">
          <button
            type="button"
            className="pv_codex_runtime_notice_install"
            disabled={installPhase === 'installing'}
            onClick={() => void install()}
          >
            {installPhase === 'installing' ? (
              <LoaderCircle size={13} aria-hidden="true" />
            ) : (
              <Download size={13} aria-hidden="true" />
            )}
            {installPhase === 'installing' ? '正在安装' : installPhase === 'error' ? '重试下载' : '下载并安装'}
          </button>
          <button
            type="button"
            className="pv_codex_runtime_notice_settings"
            onClick={() => {
              setTweak('settingsSection', 'integrity')
              setTweak('view', 'settings')
            }}
          >
            <Settings size={13} aria-hidden="true" />
            前往完整性
          </button>
        </div>
      )}
    </div>
  )
}
