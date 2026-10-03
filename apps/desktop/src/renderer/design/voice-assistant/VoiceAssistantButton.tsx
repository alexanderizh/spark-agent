/**
 * VoiceAssistantButton — 侧栏用户底栏的「语音对话」入口
 *
 * 位置：用户信息底栏设置按钮左侧（App.tsx .sidebar-bottom-user 内）。
 * 行为：点击等价于按下唤醒快捷键（voice-assistant:trigger）——
 *       空闲/待命 → 开始聆听；聆听中 → 取消本轮；思考/播报中 → 打断。
 * 状态：订阅 stream:voice-assistant:state 高亮活跃态；reason=error 的失败经
 *       toast 暴露（HUD 只呈现聆听/思考/播报三类状态，错误态在 HUD 不可见）。
 * 引导：语音包未安装时不再只抛「去设置」——与语音输入一致先弹下载确认框，
 *       确认后后台安装（右上角进度卡片），装完自动开始对话；快捷键唤醒触发的
 *       缺包报错同样在 error toast 上补「下载语音包」直达动作。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '@lobehub/ui'
import type { VoiceAssistantState } from '@spark/protocol'
import { Icons } from '../Icons'
import { useI18n, type TranslationKey } from '../i18n'
import { useAppOptional, type ConfirmOptions } from '../AppContext'
import { useToast, type ToastOptions } from '../components/Toast'
import { useVoiceIntegrity } from '../voice/useVoiceIntegrity'
import { confirmVoicePackDownload } from '../voice/voiceDownloadConfirmation'
import { VoiceInstallToast } from '../voice/VoiceInstallToast'
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
  downloading: boolean,
): string {
  if (state === 'listening' || state === 'thinking' || state === 'speaking') {
    return t(ACTIVE_TIP[state])
  }
  if (downloading) return t('app.voice.downloading')
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
  /** 语音包下载中（提示文案改为下载中说明） */
  downloading?: boolean
  onClick: () => void
}

/** 纯展示层：状态 → 高亮与提示文案，便于静态渲染测试 */
export function VoiceAssistantButtonView({
  state,
  enabled,
  shortcut,
  downloading = false,
  onClick,
}: VoiceAssistantButtonViewProps): React.ReactElement {
  const { t } = useI18n()
  const active = ACTIVE_STATES.has(state)
  const tip = resolveTip(t, state, enabled, shortcut, downloading)
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
  const voiceIntegrity = useVoiceIntegrity()
  const [state, setState] = useState<VoiceAssistantState>('idle')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [shortcut, setShortcut] = useState<string | null>(null)
  /** 触发在途：避免连点造成「开-关-开」的抖动 */
  const pendingRef = useRef(false)
  /**
   * 下载确认后的自动唤醒意图。用 state 而非 ref：ready 翻转与确认返回存在
   * microtask 竞态（install fire-and-forget 先于置位落定），ref 变化不会触发
   * effect 重跑，会漏掉「ready 已就绪 + 意图刚置位」的组合；state 变化驱动
   * effect 再评估一次，两种到达顺序都能命中。
   */
  const [pendingWake, setPendingWake] = useState(false)

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

  /**
   * 下载引导：与语音输入共用确认框（场景文案），确认后后台安装并挂起自动唤醒意图。
   * 无 App 上下文（单测）时返回 false，调用方回落到原有报错路径。
   */
  const requestPackInstall = useCallback(async (): Promise<boolean> => {
    if (app == null) return false
    const options: ConfirmOptions = {
      title: t('app.voice.downloadConfirmTitle'),
      description: t('app.voice.downloadConfirmDesc'),
      confirmText: t('app.voice.downloadConfirmOk'),
      cancelText: t('app.voice.downloadConfirmCancel'),
    }
    const confirmed = await confirmVoicePackDownload(
      app.requestConfirm,
      voiceIntegrity.install,
      options,
    )
    if (!confirmed) return false
    setPendingWake(true)
    return true
  }, [app, t, voiceIntegrity])

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

  // ref 快照：state 订阅回调读最新完整性/动作，避免每次 integrity 状态变化都重建订阅
  // （checking 是 useVoiceIntegrity 的独立 state，不在 status 内，须单独快照）
  const integrityRef = useRef(voiceIntegrity.status)
  integrityRef.current = voiceIntegrity.status
  const checkingRef = useRef(voiceIntegrity.checking)
  checkingRef.current = voiceIntegrity.checking
  const requestPackInstallRef = useRef(requestPackInstall)
  requestPackInstallRef.current = requestPackInstall

  /** 失败 toast 的动作组装：语音包缺失时在「去设置」前补「下载语音包」直达引导 */
  const errorToastOptions = useCallback((): ToastOptions | undefined => {
    if (app == null) return undefined
    const st = integrityRef.current
    const actions: NonNullable<ToastOptions['actions']> = []
    if (!checkingRef.current && st.supported && !st.ready) {
      actions.push({
        label: t('app.voice.downloadAction'),
        onClick: () => void requestPackInstallRef.current(),
      })
    }
    actions.push({ label: t('app.voice.openSettings'), onClick: openVoiceSettings })
    return { actions }
  }, [app, openVoiceSettings, t])

  /** 发起一次唤醒（无 pendingRef 前置 guard，防抖由调用方负责；自身在途标记防连发） */
  const triggerNow = useCallback((): void => {
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

  const handleClick = useCallback((): void => {
    if (pendingRef.current) return
    const st = integrityRef.current
    // 下载中不重复触发，等就绪后自动开始
    if (st.downloading) {
      toast.info(t('app.voice.downloading'))
      return
    }
    // 已启用但语音包未就绪（完整性检查已稳定）：不直接报错，先走下载引导
    if (app != null && enabled === true && !checkingRef.current && st.supported && !st.ready) {
      pendingRef.current = true
      void (async () => {
        try {
          await requestPackInstallRef.current()
          // 用户拒绝下载：静默返回，不强行 trigger 免得报错刷屏
        } finally {
          pendingRef.current = false
        }
      })()
      return
    }
    triggerNow()
  }, [app, enabled, t, toast, triggerNow])

  // 安装失败：放弃「装完自动唤醒」的挂起意图——避免数分钟后用户从设置页装好时突兀开麦
  useEffect(() => {
    if (voiceIntegrity.progress?.state === 'error') setPendingWake(false)
  }, [voiceIntegrity.progress])

  // 语音包就绪且用户已确认下载 → 自动开始对话（用户意图明确：点按钮就是要用语音）。
  // 不走 handleClick：其 pendingRef 防抖可能与确认链的异步收尾交叠，把自动唤醒挡掉；
  // triggerNow 无前置 guard，无论 ready 翻转与确认置位谁先落定都能命中。
  useEffect(() => {
    if (!pendingWake || !voiceIntegrity.status.ready) return
    setPendingWake(false)
    triggerNow()
  }, [pendingWake, voiceIntegrity.status.ready, triggerNow])

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
      toast.error(detail.length > 0 ? detail : t('app.voice.errorFallback'), errorToastOptions())
    })

    return () => {
      cancelled = true
      off()
    }
  }, [errorToastOptions, syncSettings, t, toast])

  return (
    <>
      <VoiceAssistantButtonView
        state={state}
        enabled={enabled}
        shortcut={shortcut}
        downloading={voiceIntegrity.status.downloading}
        onClick={handleClick}
      />
      <VoiceInstallToast
        progress={voiceIntegrity.progress}
        status={voiceIntegrity.status}
        doneText={t('app.voice.installDone')}
        onRetry={() => void voiceIntegrity.install()}
      />
    </>
  )
}
