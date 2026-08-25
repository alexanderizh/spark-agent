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
type InstallPhase = 'idle' | 'installing' | 'success' | 'error'

/**
 * OpenAI 格式对话渠道配置时的 Codex 运行时缺失警示条。
 * 运行时是该类渠道的硬依赖，缺失时在配置阶段即提示并支持一键安装，
 * 避免用户保存后到发消息才看到 CODEX_RUNTIME_NOT_INSTALLED。
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
    // 缓存命中 'missing' 时仍刷新一次本地检测，避免读到安装完成前的旧缓存。
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
        setInstallPhase('success')
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
      setInstallPhase('success')
      setRuntimeState('ready')
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

  // 已就绪且没有需要展示的安装结果时不渲染，避免表单闪动。
  if (runtimeState === 'ready' && installPhase !== 'success') return null
  if (runtimeState === 'checking') return null

  if (runtimeState === 'ready' && installPhase === 'success') {
    return (
      <div className="pv_codex_runtime_notice is-success" role="status" aria-live="polite">
        <CheckCircle2 size={14} aria-hidden="true" />
        <span>Codex 运行时已安装，该渠道可用于发起会话。</span>
      </div>
    )
  }

  return (
    <div className={`pv_codex_runtime_notice is-${installPhase}`} role="alert">
      <div className="pv_codex_runtime_notice_body">
        <div className="pv_codex_runtime_notice_status">
          {installPhase === 'installing' ? (
            <LoaderCircle size={14} aria-hidden="true" />
          ) : (
            <TriangleAlert size={14} aria-hidden="true" />
          )}
          <span>
            未安装 Codex 运行时。OpenAI 格式对话渠道依赖 Codex
            运行时，未安装时保存后暂无法发起会话，可先保存稍后安装。
          </span>
        </div>
        {progress != null && installPhase !== 'idle' && (
          <SdkInstallProgressView progress={progress} compact />
        )}
      </div>
      <div className="pv_codex_runtime_notice_actions">
        <button
          type="button"
          className="pv_codex_runtime_notice_install"
          disabled={installPhase === 'installing' || installPhase === 'success'}
          onClick={() => void install()}
        >
          {installPhase === 'installing' ? (
            <LoaderCircle size={13} aria-hidden="true" />
          ) : installPhase === 'success' ? (
            <CheckCircle2 size={13} aria-hidden="true" />
          ) : (
            <Download size={13} aria-hidden="true" />
          )}
          {installPhase === 'installing'
            ? '正在安装'
            : installPhase === 'error'
              ? '重试下载'
              : installPhase === 'success'
                ? '安装完成'
                : '下载并安装'}
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
    </div>
  )
}
