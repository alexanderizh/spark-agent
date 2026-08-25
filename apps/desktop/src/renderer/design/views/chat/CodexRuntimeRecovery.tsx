import { useEffect, useState } from 'react'
import { CheckCircle2, Download, LoaderCircle, RotateCcw, Settings } from 'lucide-react'
import type { SdkIntegrityInstallProgress } from '@spark/protocol'
import { useApp } from '../../AppContext'
import { SdkInstallProgressView } from '../../components/SdkInstallProgress'
import { CODEX_SDK_PACKAGE, sharedCodexRuntimeInstall } from '../../utils/codex-runtime-install'

type RecoveryState =
  | { phase: 'idle'; message: string }
  | { phase: 'installing'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

export function CodexRuntimeRecovery({ onRetry }: { onRetry?: () => void }) {
  const { setTweak } = useApp()
  const [state, setState] = useState<RecoveryState>({
    phase: 'idle',
    message: '从 Spark 云端下载与当前 Codex SDK 匹配的运行时，安装后无需重启应用。',
  })
  const [progress, setProgress] = useState<SdkIntegrityInstallProgress | null>(null)

  useEffect(() => {
    const unsubscribe = window.spark?.on?.('stream:sdk:install-progress', (payload) => {
      if (payload.packageName !== CODEX_SDK_PACKAGE) return
      setProgress(payload)
      if (payload.state === 'done') {
        setState({ phase: 'success', message: payload.message })
      } else if (payload.state === 'error') {
        setState({ phase: 'error', message: payload.message })
      } else {
        setState({ phase: 'installing', message: payload.message })
      }
    })
    return unsubscribe ?? (() => undefined)
  }, [])

  const openIntegrity = () => {
    setTweak('settingsSection', 'integrity')
    setTweak('view', 'settings')
  }

  const install = async () => {
    if (state.phase === 'installing') return
    setState({ phase: 'installing', message: '正在下载、校验并激活 Codex 运行时…' })
    setProgress({
      packageName: CODEX_SDK_PACKAGE,
      state: 'preparing',
      downloaded: 0,
      total: 0,
      percent: 0,
      message: '正在准备 Codex 运行时下载',
    })
    try {
      const result = await sharedCodexRuntimeInstall()
      setState({ phase: 'success', message: result.message })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Codex runtime 安装失败：${String(error)}`
      setState({ phase: 'error', message })
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

  return (
    <div className={`codex-runtime-recovery is-${state.phase}`}>
      <div className="codex-runtime-recovery-body">
        <div className="codex-runtime-recovery-status" role="status" aria-live="polite">
          {state.phase === 'installing' && <LoaderCircle size={15} aria-hidden="true" />}
          {state.phase === 'success' && <CheckCircle2 size={15} aria-hidden="true" />}
          <span>{state.message}</span>
        </div>
        {progress != null && <SdkInstallProgressView progress={progress} compact />}
      </div>
      <div className="codex-runtime-recovery-actions">
        {state.phase === 'success' && onRetry != null ? (
          <button type="button" className="codex-runtime-install-button" onClick={onRetry}>
            <RotateCcw size={13} aria-hidden="true" />
            重新尝试当前消息
          </button>
        ) : (
          <button
            type="button"
            className="codex-runtime-install-button"
            disabled={state.phase === 'installing' || state.phase === 'success'}
            onClick={() => void install()}
          >
            {state.phase === 'installing' ? (
              <LoaderCircle size={13} aria-hidden="true" />
            ) : state.phase === 'success' ? (
              <CheckCircle2 size={13} aria-hidden="true" />
            ) : (
              <Download size={13} aria-hidden="true" />
            )}
            {state.phase === 'installing'
              ? '正在安装'
              : state.phase === 'error'
                ? '重试下载'
                : state.phase === 'success'
                  ? '安装完成'
                  : '下载并安装'}
          </button>
        )}
        <button type="button" className="codex-runtime-settings-button" onClick={openIntegrity}>
          <Settings size={13} aria-hidden="true" />
          前往完整性
        </button>
      </div>
    </div>
  )
}
