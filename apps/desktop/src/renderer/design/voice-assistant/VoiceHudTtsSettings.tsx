/**
 * VoiceHudTtsSettings — 语音 HUD 卡内嵌的播报（TTS）快捷设置条（纯展示组件）
 *
 * 候选推导与设置页 VoiceAssistantSettingsCard 完全同口径（voiceAssistantTtsOptions），
 * 但本组件不发起 IPC、不落库：所有改动经 onPatch 上抛给宿主（HUD）持久化。
 *
 * 布局：收起一行「音色 + 语速 + 展开钮」；展开后在上方新增一行「渠道 + 模型」。
 * HUD 卡片是拖拽把手（useVoiceHudDrag），分区根节点 onPointerDown 阻止冒泡，
 * 避免点选下拉/切换档位时被拖拽把手抢走（同停止钮做法）。
 *
 * 展开/收起态持久化在 localStorage（voice-hud-tts-expanded），与设置数据无关。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select } from 'antd'
import type { CanvasMediaModelSummary, VoiceAssistantSettings } from '@spark/protocol'
import {
  resolveTtsChannelId,
  ttsChannelModels,
  ttsChannelOptions,
  ttsVoiceOptions,
} from './voiceAssistantTtsOptions'
import { Icons } from '../Icons'

/**
 * 下拉哨兵值：antd Select 对空串值渲染占位符而非选项文案，直接存 null 会显示空白
 * 控件（同设置卡注释）。哨兵只在展示层使用，onChange 时换回 null / ''，不落库；
 * 取值不可能与渠道 id（UUID）或模型 id 冲突。
 */
const HUD_TTS_AUTO_CHANNEL_VALUE = '__auto__'
const HUD_TTS_DEFAULT_MODEL_VALUE = '__default__'
/** 音色「默认」档：ttsVoice 为空串时映射到该哨兵展示，选回它等价于清空 ttsVoice。 */
const HUD_TTS_DEFAULT_VOICE_VALUE = '__default_voice__'

/** 展开/收起持久化 key：'1' 展开 / '0' 收起，默认收起。 */
const HUD_TTS_EXPANDED_KEY = 'voice-hud-tts-expanded'

/** 语速档位（展示层收敛为固定六档）：任意 ttsSpeed 显示最近档，主动选择才落值。 */
const HUD_TTS_SPEED_STEPS: Array<{ label: string; value: number }> = [
  { label: '0.5×', value: 0.5 },
  { label: '0.75×', value: 0.75 },
  { label: '1×', value: 1.0 },
  { label: '1.25×', value: 1.25 },
  { label: '1.5×', value: 1.5 },
  { label: '2×', value: 2.0 },
]

/** 与 speed 最接近的档位（Math.abs 最小差；中点并列时先出现的档位胜出）。 */
function nearestSpeedStep(speed: number): number {
  // noUncheckedIndexedAccess 下首元素可能 undefined：档位表是非空常量，1（1× 档）
  // 兜底仅为类型收窄，首轮循环即被真实首档覆盖
  let nearestValue = HUD_TTS_SPEED_STEPS[0]?.value ?? 1
  for (const step of HUD_TTS_SPEED_STEPS) {
    if (Math.abs(step.value - speed) < Math.abs(nearestValue - speed)) nearestValue = step.value
  }
  return nearestValue
}

/** localStorage 读取异常（隐私模式 / 被禁用）回落收起。 */
function readInitialExpanded(): boolean {
  try {
    return window.localStorage.getItem(HUD_TTS_EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

export interface VoiceHudTtsSettingsProps {
  /** 当前生效设置；null = 加载中（全部控件禁用） */
  settings: VoiceAssistantSettings | null
  /** 语音合成模型清单（canvas:media-models:list，capability=audio.speech 口径） */
  models: readonly CanvasMediaModelSummary[]
  /** 局部更新上抛（宿主负责合并、落库与回读） */
  onPatch: (patch: Partial<VoiceAssistantSettings>) => void
}

export function VoiceHudTtsSettings({
  settings,
  models,
  onPatch,
}: VoiceHudTtsSettingsProps): React.ReactNode {
  const [expanded, setExpanded] = useState<boolean>(readInitialExpanded)
  const disabled = settings == null

  // 展开/收起即时持久化；写入失败（隐私模式等）不阻塞交互
  useEffect(() => {
    try {
      window.localStorage.setItem(HUD_TTS_EXPANDED_KEY, expanded ? '1' : '0')
    } catch {
      /* 忽略 */
    }
  }, [expanded])

  // ── 候选推导（与设置页同口径）───────────────────────────────────────────
  const effectiveChannelId = useMemo(
    () => resolveTtsChannelId(models, settings?.ttsProviderProfileId ?? null),
    [models, settings?.ttsProviderProfileId],
  )
  const effectiveChannelModels = useMemo(
    () => ttsChannelModels(models, effectiveChannelId),
    [models, effectiveChannelId],
  )
  const voiceCandidates = useMemo(
    () => ttsVoiceOptions(models, effectiveChannelId, settings?.ttsModelId ?? null),
    [models, effectiveChannelId, settings?.ttsModelId],
  )

  const channelOptions = useMemo(() => {
    const base = [
      { label: '自动', value: HUD_TTS_AUTO_CHANNEL_VALUE, title: '自动（第一个可用语音渠道）' },
      ...ttsChannelOptions(models).map((option) => ({
        label: option.label,
        value: option.value,
        title: option.label,
      })),
    ]
    const current = settings?.ttsProviderProfileId
    // 已保存渠道可能已删除 / 停用：补占位项避免下拉直接暴露裸 id（HUD 用短文案）。
    if (current == null || base.some((option) => option.value === current)) return base
    return [...base, { label: '当前渠道（不在列表）', value: current, title: current }]
  }, [models, settings?.ttsProviderProfileId])

  const modelOptions = useMemo(() => {
    const base = [
      { label: '默认', value: HUD_TTS_DEFAULT_MODEL_VALUE, title: '渠道默认模型' },
      ...effectiveChannelModels.map((model) => ({
        label: model.displayName,
        value: model.modelId,
        title: model.displayName,
      })),
    ]
    const current = settings?.ttsModelId
    if (current == null || base.some((option) => option.value === current)) return base
    return [...base, { label: '当前模型（不在列表）', value: current, title: current }]
  }, [effectiveChannelModels, settings?.ttsModelId])

  const currentVoice = settings?.ttsVoice ?? ''
  // 音色值为空 → 映射「默认」哨兵档展示；候选为空且值为空时改为占位符模式
  //（禁用 + placeholder + title 说明原因，antd 空串会渲染成占位符，正好利用）。
  const voicePlaceholderMode = voiceCandidates.length === 0 && currentVoice.length === 0
  const voiceOptions = useMemo(() => {
    const base = [
      { label: '默认', value: HUD_TTS_DEFAULT_VOICE_VALUE },
      ...voiceCandidates.map((option) => ({
        label: option.label,
        value: option.value,
        title: option.label,
      })),
    ]
    // 自定义音色（如复刻音色 ID）不在候选：补占位项展示原值，不静默改写用户配置。
    if (currentVoice.length === 0 || base.some((option) => option.value === currentVoice)) {
      return base
    }
    return [...base, { label: currentVoice, value: currentVoice, title: currentVoice }]
  }, [voiceCandidates, currentVoice])

  // 非档位值（如滑杆调出的 1.12）显示最近档位，不回写
  const speedValue = nearestSpeedStep(settings?.ttsSpeed ?? 1)

  const handleChannelChange = useCallback(
    (value: string) => {
      if (settings == null) return
      const nextChannel = value === HUD_TTS_AUTO_CHANNEL_VALUE ? null : value
      // 换渠道后原模型多半不属于新渠道：仅当仍属于新渠道时保留，否则回落渠道默认
      //（照抄设置卡 handleTtsChannelChange，两处口径保持一致）。
      const keepModel =
        nextChannel != null &&
        settings.ttsModelId != null &&
        models.some(
          (model) =>
            model.providerProfileId === nextChannel && model.modelId === settings.ttsModelId,
        )
      onPatch({
        ttsProviderProfileId: nextChannel,
        ...(keepModel ? {} : { ttsModelId: null }),
      })
    },
    [models, onPatch, settings],
  )

  return (
    <div
      className="voice-hud-tts"
      // HUD 卡片是拖拽把手：设置区不作为把手，点选下拉 / 档位不被拖拽抢走
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/* 展开行（收起行上方）：渠道 + 模型 */}
      {expanded ? (
        <div className="voice-hud-tts-row">
          <div className="voice-hud-tts-field">
            <span className="voice-hud-tts-label">渠道</span>
            <Select
              className="voice-hud-tts-select"
              size="small"
              variant="borderless"
              popupMatchSelectWidth={false}
              aria-label="播报渠道"
              value={settings?.ttsProviderProfileId ?? HUD_TTS_AUTO_CHANNEL_VALUE}
              options={channelOptions}
              disabled={disabled}
              onChange={(value) => handleChannelChange(String(value))}
            />
          </div>
          <div className="voice-hud-tts-field">
            <span className="voice-hud-tts-label">模型</span>
            <Select
              className="voice-hud-tts-select"
              size="small"
              variant="borderless"
              popupMatchSelectWidth={false}
              aria-label="播报模型"
              value={settings?.ttsModelId ?? HUD_TTS_DEFAULT_MODEL_VALUE}
              options={modelOptions}
              disabled={
                disabled ||
                settings?.ttsProviderProfileId == null ||
                effectiveChannelModels.length === 0
              }
              onChange={(value) => {
                const next = String(value)
                onPatch({ ttsModelId: next === HUD_TTS_DEFAULT_MODEL_VALUE ? null : next })
              }}
            />
          </div>
        </div>
      ) : null}

      {/* 收起行（常显）：音色 + 语速 + 展开切换钮 */}
      <div className="voice-hud-tts-row">
        <div
          className="voice-hud-tts-field"
          title={voicePlaceholderMode ? '该渠道未声明音色候选' : undefined}
        >
          <span className="voice-hud-tts-label">音色</span>
          <Select
            className="voice-hud-tts-select"
            size="small"
            variant="borderless"
            popupMatchSelectWidth={false}
            aria-label="播报音色"
            value={
              currentVoice.length > 0
                ? currentVoice
                : voicePlaceholderMode
                  ? undefined
                  : HUD_TTS_DEFAULT_VOICE_VALUE
            }
            options={voiceOptions}
            placeholder="默认音色"
            disabled={disabled || voicePlaceholderMode}
            onChange={(value) => {
              const next = String(value)
              onPatch({ ttsVoice: next === HUD_TTS_DEFAULT_VOICE_VALUE ? '' : next })
            }}
          />
        </div>
        <div className="voice-hud-tts-field">
          <span className="voice-hud-tts-label">语速</span>
          <Select
            className="voice-hud-tts-select"
            size="small"
            variant="borderless"
            popupMatchSelectWidth={false}
            aria-label="播报语速"
            value={speedValue}
            options={HUD_TTS_SPEED_STEPS.map((step) => ({
              label: step.label,
              value: step.value,
            }))}
            disabled={disabled}
            onChange={(value) => onPatch({ ttsSpeed: Number(value) })}
          />
        </div>
        <button
          type="button"
          className={`voice-hud-tts-toggle${expanded ? ' is-active' : ''}`}
          aria-label={expanded ? '收起渠道与模型' : '展开渠道与模型'}
          aria-expanded={expanded}
          title={expanded ? '收起渠道与模型' : '展开渠道与模型'}
          onClick={() => setExpanded((previous) => !previous)}
        >
          <Icons.Sliders size={12} />
        </button>
      </div>
    </div>
  )
}
