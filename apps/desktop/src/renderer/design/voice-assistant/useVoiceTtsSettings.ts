/**
 * useVoiceTtsSettings — 语音 HUD 播报设置面板的数据 hook
 *
 * 供 HUD 内嵌的播报设置面板读写 TTS 配置（渠道/模型/音色/语速等），与设置页
 * VoiceAssistantSettingsCard 走同一套 IPC 协议（voice-assistant:get-settings /
 * update-settings + canvas:media-models:list）。独立成 hook 是因为 HUD 打开时
 * 设置页未必挂载，不能复用它的组件状态。
 *
 * 与设置页 update 的三点差异：
 * - settings 用 null 明确区分「首读中 / 首读失败」，面板据此整体禁用控件，
 *   而不是渲染一份 DEFAULT 假表单误导用户（设置页场景常驻，HUD 场景瞬时）。
 * - patch 的合并基线在提交前补读主进程最新设置：本 hook 常驻挂载、快照自
 *   首读后不再刷新（平台没有设置变更广播），直接拿陈旧快照全量合并会把启动
 *   后在设置页改过的字段（如唤醒快捷键）静默回滚。
 * - patch 失败回滚到提交前快照：HUD 面板没有底部错误常驻位，乐观值若留在
 *   主进程已拒绝的位置，用户关掉面板就再也看不到不一致了。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasMediaModelSummary, VoiceAssistantSettings } from '@spark/protocol'

/** saveError 展示时长：够读清一行错误，又不至于在下一轮操作时还占着提示位。 */
const SAVE_ERROR_CLEAR_DELAY_MS = 5000

export interface UseVoiceTtsSettingsResult {
  /** null = 首次加载中（或首读失败）；非 null 为最近一次主进程 normalize 回显的设置。 */
  settings: VoiceAssistantSettings | null
  /** 已启用的语音合成候选模型；列举失败时为空数组，音色等候选回落手输。 */
  models: CanvasMediaModelSummary[]
  /** settings 首读完成。失败也置 true（settings 保持 null），面板据此结束 loading。 */
  ready: boolean
  /**
   * 把 patch 合并进「提交前补读到的主进程最新设置」后全量提交（主进程按全量
   * 对象 normalize）。补读防止陈旧快照把其他入口的改动静默回滚。
   * 乐观更新：先本地合并，成功以主进程回显为准回写；失败回滚快照并置 saveError。
   * settings 未就绪（null）时直接返回 false，不发起请求。
   */
  patch: (p: Partial<VoiceAssistantSettings>) => Promise<boolean>
  /** 最近一次保存失败信息；展示 5s 后自动清空，新一轮提交开始时也会先清空。 */
  saveError: string | null
}

export function useVoiceTtsSettings(): UseVoiceTtsSettingsResult {
  const [settings, setSettings] = useState<VoiceAssistantSettings | null>(null)
  const [models, setModels] = useState<CanvasMediaModelSummary[]>([])
  const [ready, setReady] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // patch 在 await 之后仍可能需要回写状态：用 ref（而非随渲染过期的闭包）记录存活，
  // 卸载后不再触碰任何 setState。
  const mountedRef = useRef(true)
  // saveError 的自动清除定时器。每次展示前先清旧 timer，防止上一条错误的定时器
  // 把刚展示的新错误提前清掉。
  const saveErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 展示一条保存错误，并重排 5s 自动清除。 */
  const showSaveError = useCallback((message: string) => {
    if (saveErrorTimerRef.current != null) clearTimeout(saveErrorTimerRef.current)
    setSaveError(message)
    saveErrorTimerRef.current = setTimeout(() => {
      saveErrorTimerRef.current = null
      setSaveError(null)
    }, SAVE_ERROR_CLEAR_DELAY_MS)
  }, [])

  /** 收起错误展示并撤销其自动清除定时器（新一轮提交开始时调用）。 */
  const dismissSaveError = useCallback(() => {
    if (saveErrorTimerRef.current != null) {
      clearTimeout(saveErrorTimerRef.current)
      saveErrorTimerRef.current = null
    }
    setSaveError(null)
  }, [])

  useEffect(() => {
    // StrictMode 双挂载会先跑一次 cleanup 再重跑 effect：把存活标记复位，
    // 否则第二次挂载后 patch 的 await 分支会误判为已卸载而拒绝回写。
    mountedRef.current = true
    let cancelled = false

    // 两段并行读取，各自 try/catch 互不阻塞：候选列举失败只影响下拉候选，
    // 不该拖垮设置本身。
    void (async () => {
      try {
        const res = await window.spark.invoke('voice-assistant:get-settings', {})
        if (!cancelled) setSettings(res.settings)
      } catch {
        /* 首读失败：settings 保持 null，面板整体禁用而不是展示空表单误导用户 */
      } finally {
        // 成败都结束 loading；与候选读取无关（候选迟到只影响下拉，不阻塞表单）。
        if (!cancelled) setReady(true)
      }
    })()
    void (async () => {
      try {
        // 播报候选与主进程 TTS 合成同一份「已配置渠道 + 已启用模型」口径（同设置页）。
        const res = await window.spark.invoke('canvas:media-models:list', {
          capability: 'audio.speech',
          enabledOnly: true,
        })
        if (!cancelled) setModels(res.models)
      } catch {
        /* 列举失败不阻塞设置读取：候选为空时音色回落手输 */
      }
    })()

    return () => {
      cancelled = true
      mountedRef.current = false
      // 卸载只撤定时器，不 setState：卸载路径上的状态写入没有意义。
      if (saveErrorTimerRef.current != null) {
        clearTimeout(saveErrorTimerRef.current)
        saveErrorTimerRef.current = null
      }
    }
  }, [])

  const patch = useCallback(
    async (p: Partial<VoiceAssistantSettings>): Promise<boolean> => {
      // 首读未完成（或首读失败）时没有可信基线：拒绝提交，面板应先处理 loading/错误态。
      if (settings == null || !mountedRef.current) return false
      // 以提交前的 settings 为回滚快照——乐观值一旦被主进程拒绝要能原路退回。
      const baseline = settings
      dismissSaveError()
      try {
        // 合并基线补读主进程最新设置：快照自首读后不再刷新，直接合并会把启动后
        // 在设置页改过的字段静默回滚。补读失败时回落本地快照（与旧行为一致，
        // update 侧仍有 normalize 兜底），不让单次读取失败卡死提交。
        let latest = baseline
        try {
          const fresh = await window.spark.invoke('voice-assistant:get-settings', {})
          if (fresh?.settings) latest = fresh.settings
        } catch {
          /* 补读失败不阻断提交 */
        }
        const next = { ...latest, ...p }
        setSettings(next)
        const res = await window.spark.invoke('voice-assistant:update-settings', {
          settings: next,
        })
        // 以主进程 normalize 回显为准：本地合并值可能被收敛（越界语速、超长音色等）。
        if (mountedRef.current) setSettings(res.settings)
        return true
      } catch (error) {
        // 回滚到提交前快照，乐观值不能留在主进程已拒绝的位置。
        if (mountedRef.current) {
          setSettings(baseline)
          showSaveError(error instanceof Error ? error.message : String(error))
        }
        return false
      }
    },
    [settings, dismissSaveError, showSaveError],
  )

  return { settings, models, ready, patch, saveError }
}
