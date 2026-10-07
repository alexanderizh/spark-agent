/**
 * VoiceHudTtsSettings — 语音 HUD 卡内嵌的播报（TTS）快捷设置条（纯展示组件）
 *
 * 候选推导与设置页 VoiceAssistantSettingsCard 完全同口径（voiceAssistantTtsOptions），
 * 但本组件不发起 IPC、不落库：所有改动经 onPatch 上抛给宿主（HUD）持久化。
 *
 * 布局（胶囊分段式，方案 B）：值全部装进 27px 高全圆角胶囊控件，标签经
 * Select prefix 内嵌在胶囊左侧；语速免下拉，六档分段条一点即切。
 * 下拉箭头用 Icons.ChevronDown 细描边雪佛龙（antd 默认实心箭头在 9px 级别糊成团）。
 * 展开/收起钮单独一行居中，固定在分区末行：收起态「音色/语速/钮」三行，
 * 展开时渠道/模型胶囊插到顶部成「渠道/模型/音色/语速/钮」五行，钮位不跳动。
 * HUD 卡片是拖拽把手（useVoiceHudDrag），分区根节点 onPointerDown 阻止冒泡，
 * 避免点选下拉/切换档位时被拖拽把手抢走（同停止钮做法）。
 * 下拉弹层 portal 到 body，z-index 经局部 ConfigProvider 抬到 2300（HUD 卡根 2200），
 * 否则被卡片压住不可见（见 HUD_TTS_SELECT_THEME）。
 *
 * 展开/收起态持久化在 localStorage（voice-hud-tts-expanded），与设置数据无关。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfigProvider, Select } from 'antd'
import type { CanvasMediaModelSummary, VoiceAssistantSettings } from '@spark/protocol'
import {
  resolveTtsChannelId,
  ttsChannelModels,
  ttsChannelOptions,
  ttsVoiceOptions,
} from './voiceAssistantTtsOptions'
import { Icons } from '../Icons'

/**
 * 下拉箭头：antd v6 默认是实心粗箭头，缩到 9px 级别糊成墨点；换成 12px / 2px
 * 描边雪佛龙（与展开钮同一图标语言；1.6 描边在 11px 下过细扫视易漏），
 * 展开态翻转由 less（.ant-select-open）接管。
 */
const HUD_TTS_SELECT_ARROW = <Icons.ChevronDown size={12} strokeWidth={2} />

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

/**
 * 本组件内的 Select 下拉弹层 z-index。
 *
 * 下拉弹层默认 portal 到 body，antd 默认 zIndexPopup = zIndexPopupBase(1000) + 50 = 1050，
 * 而 HUD 卡片根节点是 position:fixed + z-index:2200（voiceAssistant.less），弹层整体被压在
 * 卡片后面完全不可见。这里经局部 ConfigProvider 把 Select 的 zIndexPopup 抬到 2300（>2200）。
 * 只作用于本组件区域：antd v6 局部 theme.components 与父级按组件浅合并，其余 token 全部
 * 继承全局主题，不影响应用其余弹层层级体系。
 */
const HUD_TTS_SELECT_THEME = {
  components: {
    Select: {
      zIndexPopup: 2300,
    },
  },
} as const

/** 语速档位（展示层收敛为固定六档）：任意 ttsSpeed 高亮最近档，主动选择才落值。 */
const HUD_TTS_SPEED_STEPS: Array<{ label: string; value: number }> = [
  { label: '0.5', value: 0.5 },
  { label: '0.75', value: 0.75 },
  { label: '1', value: 1.0 },
  { label: '1.25', value: 1.25 },
  { label: '1.5', value: 1.5 },
  { label: '2', value: 2.0 },
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

/** 胶囊左侧内嵌标签（Select prefix）：11px 弱化色，与值同处一个胶囊内。 */
function PillLabel({ text }: { text: string }): React.ReactNode {
  return <span className="voice-hud-tts-pill-label">{text}</span>
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
      { label: '默认', value: HUD_TTS_DEFAULT_VOICE_VALUE, title: '默认音色' },
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

  // 非档位值（如滑杆调出的 1.12）高亮最近档位，不回写
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

  // 展开/收起钮：24×24 圆形图标钮，单独一行居中挂在分区末行（展开时行数变化，
  // 钮位不动）；图标随态翻转（▼ 展开 / ▲ 收起），展开态主色点亮。
  const toggleButton = (
    <button
      type="button"
      className={`voice-hud-tts-toggle${expanded ? ' is-active' : ''}`}
      aria-label={expanded ? '收起渠道与模型' : '展开渠道与模型'}
      aria-expanded={expanded}
      title={expanded ? '收起渠道与模型' : '展开渠道与模型'}
      onClick={() => setExpanded((previous) => !previous)}
    >
      {expanded ? <Icons.ChevronUp size={13} /> : <Icons.ChevronDown size={13} />}
    </button>
  )

  return (
    <ConfigProvider theme={HUD_TTS_SELECT_THEME}>
      <div
        className="voice-hud-tts"
        // HUD 卡片是拖拽把手：设置区不作为把手，点选下拉 / 档位不被拖拽抢走
        onPointerDown={(event) => event.stopPropagation()}
      >
        {/* 展开行（插在顶部）：渠道胶囊 / 模型胶囊 */}
        {expanded ? (
          <>
            <div className="voice-hud-tts-row">
              <Select
                className="voice-hud-tts-pill"
                size="small"
                variant="borderless"
                popupMatchSelectWidth={false}
                suffixIcon={HUD_TTS_SELECT_ARROW}
                aria-label="播报渠道"
                prefix={<PillLabel text="渠道" />}
                title={
                  channelOptions.find(
                    (option) =>
                      option.value ===
                      (settings?.ttsProviderProfileId ?? HUD_TTS_AUTO_CHANNEL_VALUE),
                  )?.title ?? '播报渠道'
                }
                value={settings?.ttsProviderProfileId ?? HUD_TTS_AUTO_CHANNEL_VALUE}
                options={channelOptions}
                disabled={disabled}
                onChange={(value) => handleChannelChange(String(value))}
              />
            </div>
            <div className="voice-hud-tts-row">
              <Select
                className="voice-hud-tts-pill"
                size="small"
                variant="borderless"
                popupMatchSelectWidth={false}
                suffixIcon={HUD_TTS_SELECT_ARROW}
                aria-label="播报模型"
                prefix={<PillLabel text="模型" />}
                title={
                  modelOptions.find(
                    (option) =>
                      option.value === (settings?.ttsModelId ?? HUD_TTS_DEFAULT_MODEL_VALUE),
                  )?.title ?? '播报模型'
                }
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
          </>
        ) : null}

        {/* 常显行：音色胶囊 */}
        <div className="voice-hud-tts-row">
          <Select
            className="voice-hud-tts-pill"
            size="small"
            variant="borderless"
            popupMatchSelectWidth={false}
            suffixIcon={HUD_TTS_SELECT_ARROW}
            aria-label="播报音色"
            prefix={<PillLabel text="音色" />}
            title={
              voicePlaceholderMode
                ? '该渠道未声明音色候选'
                : currentVoice.length > 0
                  ? currentVoice
                  : '默认音色'
            }
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

        {/* 常显行：语速六档分段条（免下拉一点即切） */}
        <div className="voice-hud-tts-row">
          <span className="voice-hud-tts-row-label">语速</span>
          <div className="voice-hud-tts-seg" role="group" aria-label="播报语速">
            {HUD_TTS_SPEED_STEPS.map((step) => (
              <button
                key={step.value}
                type="button"
                className={`voice-hud-tts-seg-item${speedValue === step.value ? ' is-active' : ''}`}
                aria-pressed={speedValue === step.value}
                disabled={disabled}
                title={`语速 ${step.label}×`}
                onClick={() => onPatch({ ttsSpeed: step.value })}
              >
                {step.label}
              </button>
            ))}
          </div>
        </div>

        {/* 展开/收起钮：单独一行居中，固定在分区末行（展开时钮位不跳动） */}
        <div className="voice-hud-tts-row voice-hud-tts-toggle-row">{toggleButton}</div>
      </div>
    </ConfigProvider>
  )
}
