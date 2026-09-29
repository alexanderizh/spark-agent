/**
 * VoiceAssistantButton — 侧栏用户底栏的「语音对话」入口
 *
 * 位置：用户信息底栏设置按钮左侧（App.tsx .sidebar-bottom-user 内）。
 * 行为：点击等价于按下唤醒快捷键（voice-assistant:trigger）——
 *       空闲/待命 → 开始聆听；聆听中 → 取消本轮；思考/播报中 → 打断。
 * 状态：订阅 stream:voice-assistant:state 高亮活跃态；reason=error 的失败经
 *       toast 暴露（HUD 只呈现聆听/思考/播报三类状态，错误态在 HUD 不可见，
 *       而语音包未安装等失败都走该路径，不提示会让入口看起来「点了没反应」）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '@lobehub/ui'
import type { VoiceAssistantState } from '@spark/protocol'
import { Icons } from '../Icons'
import { useI18n, type TranslationKey } from '../i18n'
import { useAppOptional } from '../AppContext'
import { useToast, type ToastOptions } from '../components/Toast'
import './VoiceAssistantButton.less'

/** 活跃态：正在用麦克风或正在播报（再次点击 = 取消/打断） */
const ACTIVE_STATES: ReadonlySet<VoiceAssistantState> = new Set<VoiceAssistantState>([
  'listening',
  'thinking',
  'speaking',
])

/** 活跃态提示文案：聆听可取消，思考/播报可打断 */
const ACTIVE_TIP: Record<'listening' | 'thinking' | 'speaking', TranslationKey> = {
  listening: 'app.voice.tipListening',
  thinking: 'app.voice.tipThinking',
  speaking: 'app.voice.tipSpeaking',
}

function resolveTip(
  t: (key: TranslationKey, params?: Record<string, string>) => string,
  state: VoiceAssistantState,
  enabled: boolean | null,
  shortcut: string | null,
): string {
  if (state === 'listening' || state === 'thinking' || state === 'speaking') {
    return t(ACTIVE_TIP[state])
  }
  if (state === 'standby') return t('app.voice.tipStandby')
  if (enabled === false) return t('app.voice.tipDisabled')
  if (shortcut != null && shortcut.length > 0) {
    return t('app.voice.tipWithShortcut', { shortcut })
  }
  return t('app.voice.tip')
}

export interface VoiceAssistantButtonViewProps {
  state: VoiceAssistantState
  /** 语音助手启用状态；null = 未知（读取失败时回落为通用提示） */
  enabled: boolean | null
  /** 唤醒快捷键；null = 未知（提示里不展示键位） */
  shortcut: string | null
  onClick: () => void
}

/** 纯展示层：状态 → 高亮与提示文案，便于静态渲染测试 */
export function VoiceAssistantButtonView({
  state,
  enabled,
  shortcut,
  onClick,
}: VoiceAssistantButtonViewProps): React.ReactElement {
  const { t } = useI18n()
  const active = ACTIVE_STATES.has(state)
  const tip = resolveTip(t, state, enabled, shortcut)
  // is-standby 只是状态标记（供 e2e/后续扩展识别「常驻待命」），样式上与邻位铃铛/齿轮
  // 完全同色——待命不该像「正在对话」那样抢主色，具体见 VoiceAssistantButton.less 顶部说明。
  const className = [
    'sidebar-user-settings',
    'va-button',
    active ? 'is-active' : '',
    state === 'standby' && !active ? 'is-standby' : '',
  ]
    .filter((part) => part.length > 0)
    .join(' ')

  return (
    <Tooltip title={tip} mouseEnterDelay={0.05}>
      <button
        type="button"
        className={className}
        aria-label={tip}
        aria-pressed={active}
        onClick={onClick}
      >
        <Icons.Mic size={13} />
      </button>
    </Tooltip>
  )
}

export function VoiceAssistantButton(): React.ReactElement {
  const { t } = useI18n()
  const { toast } = useToast()
  const app = useAppOptional()
  const [state, setState] = useState<VoiceAssistantState>('idle')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [shortcut, setShortcut] = useState<string | null>(null)
  /** 触发在途：避免连点造成「开-关-开」的抖动 */
  const pendingRef = useRef(false)

  const openVoiceSettings = useCallback((): void => {
    if (app == null) return
    app.setTweak('view', 'settings')
    app.setTweak('settingsSection', 'voice-assistant')
  }, [app])

  /** 失败提示里的「去设置」动作：无 App 上下文（独立挂载/单测）时不附带 */
  const settingsActionOptions = useCallback((): ToastOptions | undefined => {
    if (app == null) return undefined
    return { actions: [{ label: t('app.voice.openSettings'), onClick: openVoiceSettings }] }
  }, [app, openVoiceSettings, t])

  /** 读取一次设置用于提示文案（失败保持未知，不影响点击：主进程仍会兜底校验） */
  const syncSettings = useCallback(async (): Promise<void> => {
    try {
      const res = await window.spark.invoke('voice-assistant:get-settings', {})
      setEnabled(res.settings.enabled)
      setShortcut(res.settings.wakeShortcut)
    } catch {
      // 保持未知即可，按钮依旧可用
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await window.spark.invoke('voice-assistant:get-status', {})
        if (!cancelled) setState(res.status.state)
      } catch {
        // 状态读取失败不阻塞按钮（点击后由状态流自行纠正）
      }
      await syncSettings()
    })()

    const off = window.spark.on('stream:voice-assistant:state', (event) => {
      if (event == null) return
      setState(event.state)
      if (event.reason !== 'error') return
      const detail = typeof event.detail === 'string' ? event.detail.trim() : ''
      toast.error(
        detail.length > 0 ? detail : t('app.voice.errorFallback'),
        settingsActionOptions(),
      )
    })

    return () => {
      cancelled = true
      off()
    }
  }, [settingsActionOptions, syncSettings, t, toast])

  const handleClick = useCallback((): void => {
    if (pendingRef.current) return
    pendingRef.current = true
    void (async () => {
      try {
        const res = await window.spark.invoke('voice-assistant:trigger', {})
        if (res.ok) return
        // 未启用 / 状态不可用：给出原因并提供直达设置入口
        toast.info(res.message, settingsActionOptions())
        // 失败往往意味着设置已变化（例如刚被关闭），同步一次刷新提示文案
        void syncSettings()
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : t('app.voice.errorFallback')
        toast.error(message)
      } finally {
        pendingRef.current = false
      }
    })()
  }, [settingsActionOptions, syncSettings, t, toast])

  return (
    <VoiceAssistantButtonView
      state={state}
      enabled={enabled}
      shortcut={shortcut}
      onClick={handleClick}
    />
  )
}
