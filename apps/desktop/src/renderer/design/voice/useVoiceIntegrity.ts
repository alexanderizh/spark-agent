import { useCallback, useEffect, useState } from 'react'
import type {
  VoiceInstallProgress,
  VoiceInstallResponse,
  VoiceIntegrityStatus,
} from '@spark/protocol'

const INITIAL_STATUS: VoiceIntegrityStatus = {
  ready: false,
  downloading: false,
  supported: true,
  unsupportedReason: null,
  components: [],
  lastError: null,
}

export interface UseVoiceIntegrityResult {
  status: VoiceIntegrityStatus
  /** 当前安装进度（无安装进行时为 null） */
  progress: VoiceInstallProgress | null
  /** 首次检查进行中 */
  checking: boolean
  refresh: (checkLatest?: boolean) => Promise<void>
  install: (force?: boolean) => Promise<VoiceInstallResponse>
}

/**
 * 语音包完整性 hook：检测 native 模块 + 模型文件是否就绪，订阅状态/进度流，
 * 触发按需安装。镜像 useManagedFontAssets 的订阅语义。
 */
export function useVoiceIntegrity(): UseVoiceIntegrityResult {
  const [status, setStatus] = useState<VoiceIntegrityStatus>(INITIAL_STATUS)
  const [progress, setProgress] = useState<VoiceInstallProgress | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let active = true
    setChecking(true)
    void (async () => {
      try {
        // 先读本地状态，避免远程 manifest 阻塞麦克风可用性判定。
        const local = await window.spark.invoke('voice:check-integrity', { checkLatest: false })
        if (!active) return
        setStatus(local.status)
        setChecking(false)

      } catch (err) {
        if (!active) return
        setStatus({
          ...INITIAL_STATUS,
          supported: false,
          unsupportedReason: err instanceof Error ? err.message : String(err),
        })
        setChecking(false)
        return
      }

      try {
        // 云端版本信息仅用于补充 latestVersion，失败不覆盖已可靠获得的本地状态。
        const latest = await window.spark.invoke('voice:check-integrity', { checkLatest: true })
        if (active) setStatus(latest.status)
      } catch {
        // 本地完整性状态已经可用，后台版本刷新失败不影响语音入口。
      }
    })()

    const offStatus = window.spark.on('stream:voice:status', (s) => setStatus(s))
    const offProgress = window.spark.on('stream:voice:install-progress', (p) => {
      setProgress(p)
      setStatus((current) => ({
        ...current,
        downloading: p.state !== 'done' && p.state !== 'error',
        lastError: p.state === 'error' ? p.message : current.lastError,
      }))
      if (p.state === 'done') {
        // 安装完成后短暂保留末帧，随后由 status 流接管；done 时不主动清空，
        // 便于 UI 展示「安装完成」终态。
      }
      if (p.state === 'error') {
        // 错误帧保留，供 UI 展示失败原因；下一次 install 会清空。
      }
    })

    return () => {
      active = false
      offStatus()
      offProgress()
    }
  }, [])

  const refresh = useCallback(async (checkLatest = true) => {
    setChecking(true)
    try {
      const res = await window.spark.invoke('voice:check-integrity', { checkLatest })
      setStatus(res.status)
    } catch (err) {
      setStatus({
        ...INITIAL_STATUS,
        supported: false,
        unsupportedReason: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setChecking(false)
    }
  }, [])

  const install = useCallback(async (force = false) => {
    setProgress(null)
    const result = await window.spark.invoke('voice:install', { force })
    setStatus(result.status)
    return result
  }, [])

  return { status, progress, checking, refresh, install }
}
