/**
 * VoiceAssistantSettingsCard — 语音助手设置分区
 *
 * M1：快捷键唤醒（开关/键位）、提示音、语音系统提示、TTS 渠道/模型/音色/语速、
 *     语音会话权限模式、状态展示与「试一试」。
 * M2（本卡片内预告，暂锁定）：常驻唤醒词聆听、唤醒词选择、识别引擎。
 *
 * 设置经 voice-assistant:get-settings / update-settings IPC 读写
 * （主进程 normalize 收敛 + 快捷键热更新），不走 localStorage。
 *
 * 展示约定：行内只留标题 + 右侧控件；详细解释收进标题旁 ⓘ 悬浮提示，
 * 右侧控件统一 200px 宽度右缘对齐（见 voiceAssistant.less）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AutoComplete, Select } from '@lobehub/ui'
import { Switch, Tooltip } from 'antd'
import type {
  CanvasMediaModelSummary,
  SessionAgentAdapter,
  SessionReasoningEffort,
  VoiceAssistantSessionAgentInfo,
  VoiceAssistantSettings,
  VoiceAssistantStatus,
} from '@spark/protocol'
import { DEFAULT_VOICE_ASSISTANT_SETTINGS } from '@spark/protocol'
import { getPermissionModeOptions, getValidPermissionMode } from '../utils/permission-options'
import { mediaModelDefaultVoice } from '../utils/mediaParamOptions'
import {
  resolveTtsChannelId,
  resolveTtsModel,
  ttsChannelModels,
  ttsChannelOptions,
  ttsVoiceOptions,
} from './voiceAssistantTtsOptions'
import { Icons } from '../Icons'

const ADAPTER_LABEL: Record<SessionAgentAdapter, string> = {
  claude: 'Claude',
  'claude-sdk': 'Claude',
  codex: 'Codex',
  spark: 'Spark',
}

const THINKING_EFFORT_OPTIONS: Array<{ label: string; value: SessionReasoningEffort }> = [
  { label: '最低 ≈ 不思考（最快）', value: 'minimal' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '很高', value: 'xhigh' },
  { label: '最高', value: 'max' },
]

/**
 * 下拉哨兵值：antd Select 对空串值渲染的是占位符而非选项文案，直接存 null 会让
 * 「自动 / 渠道默认模型」显示成空白控件。哨兵不可能与渠道 id（UUID）或模型 id 冲突。
 */
const TTS_AUTO_CHANNEL_VALUE = '__auto__'
const TTS_DEFAULT_MODEL_VALUE = '__default__'

const STATE_LABEL: Record<string, string> = {
  idle: '空闲',
  listening: '聆听中',
  thinking: '思考中',
  speaking: '播报中',
  standby: '待命（常驻聆听）',
}

function SettingsRow({
  title,
  tip,
  right,
}: {
  title: ReactNode
  /** 详细解释，悬浮在标题旁 ⓘ 图标上展示 */
  tip?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="settings-card-row">
      <div className="flex1 min-w-0 voice-settings-label">
        <span className="row-title">{title}</span>
        {tip != null && (
          <Tooltip title={tip} overlayStyle={{ maxWidth: 340 }}>
            <Icons.HelpCircle className="voice-settings-help" size={13} />
          </Tooltip>
        )}
      </div>
      {right != null && <div className="row-action voice-settings-control">{right}</div>}
    </div>
  )
}

export function VoiceAssistantSettingsCard() {
  const [settings, setSettings] = useState<VoiceAssistantSettings>(DEFAULT_VOICE_ASSISTANT_SETTINGS)
  const [sessionAgent, setSessionAgent] = useState<VoiceAssistantSessionAgentInfo | null>(null)
  const [status, setStatus] = useState<VoiceAssistantStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [ttsModels, setTtsModels] = useState<CanvasMediaModelSummary[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await window.spark.invoke('voice-assistant:get-settings', {})
        if (!cancelled) {
          setSettings(res.settings)
          setSessionAgent(res.sessionAgent ?? null)
          setLoaded(true)
        }
      } catch {
        if (!cancelled) setLoaded(true)
      }
      try {
        const statusRes = await window.spark.invoke('voice-assistant:get-status', {})
        if (!cancelled) setStatus(statusRes.status)
      } catch {
        /* 状态读取失败不阻塞设置 */
      }
      try {
        // 播报渠道 / 模型 / 音色候选：与主进程 TTS 同一份「已配置渠道 + 已启用模型」口径。
        const modelsRes = await window.spark.invoke('canvas:media-models:list', {
          capability: 'audio.speech',
          enabledOnly: true,
        })
        if (!cancelled) setTtsModels(modelsRes.models)
      } catch {
        /* 渠道列举失败不阻塞设置读取：候选为空时音色回落手输 */
      }
    })()
    const off = window.spark.on('stream:voice-assistant:status', (next) => {
      setStatus(next)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const update = useCallback(
    async (patch: Partial<VoiceAssistantSettings>) => {
      const next = { ...settings, ...patch }
      setSettings(next)
      setSaveError(null)
      try {
        const res = await window.spark.invoke('voice-assistant:update-settings', {
          settings: next,
        })
        setSettings(res.settings)
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error))
      }
    },
    [settings],
  )

  // ── TTS 渠道 / 模型 / 音色候选（纯推导，口径与主进程合成链路一致）──────────
  const effectiveTtsChannelId = useMemo(
    () => resolveTtsChannelId(ttsModels, settings.ttsProviderProfileId),
    [ttsModels, settings.ttsProviderProfileId],
  )
  const effectiveTtsChannelModels = useMemo(
    () => ttsChannelModels(ttsModels, effectiveTtsChannelId),
    [ttsModels, effectiveTtsChannelId],
  )
  const effectiveTtsModel = useMemo(
    () => resolveTtsModel(ttsModels, effectiveTtsChannelId, settings.ttsModelId),
    [ttsModels, effectiveTtsChannelId, settings.ttsModelId],
  )
  const ttsVoiceCandidates = useMemo(
    () => ttsVoiceOptions(ttsModels, effectiveTtsChannelId, settings.ttsModelId),
    [ttsModels, effectiveTtsChannelId, settings.ttsModelId],
  )
  const ttsChannelSelectOptions = useMemo(() => {
    const base = [
      { label: '自动（第一个可用语音渠道）', value: TTS_AUTO_CHANNEL_VALUE },
      ...ttsChannelOptions(ttsModels).map((option) => ({
        label: option.label,
        value: option.value,
      })),
    ]
    const current = settings.ttsProviderProfileId
    // 已保存渠道可能已删除或停用：补一条占位项，避免下拉直接暴露裸 id。
    if (current == null || base.some((option) => option.value === current)) return base
    return [...base, { label: '当前渠道（不在语音渠道列表）', value: current }]
  }, [ttsModels, settings.ttsProviderProfileId])
  const ttsModelSelectOptions = useMemo(() => {
    const base = [
      { label: '渠道默认模型', value: TTS_DEFAULT_MODEL_VALUE },
      ...effectiveTtsChannelModels.map((model) => ({
        label: model.displayName,
        value: model.modelId,
      })),
    ]
    const current = settings.ttsModelId
    if (current == null || base.some((option) => option.value === current)) return base
    return [...base, { label: '当前模型（不在渠道模型列表）', value: current }]
  }, [effectiveTtsChannelModels, settings.ttsModelId])
  const ttsDefaultVoice = mediaModelDefaultVoice(effectiveTtsModel)

  const handleTtsChannelChange = useCallback(
    (value: string) => {
      const nextChannel = value === TTS_AUTO_CHANNEL_VALUE ? null : value
      // 换渠道后原模型多半不属于新渠道：仅当它仍属于新渠道时保留，否则回落到渠道默认。
      const keepModel =
        nextChannel != null &&
        settings.ttsModelId != null &&
        ttsModels.some(
          (model) =>
            model.providerProfileId === nextChannel && model.modelId === settings.ttsModelId,
        )
      void update({
        ttsProviderProfileId: nextChannel,
        ...(keepModel ? {} : { ttsModelId: null }),
      })
    },
    [settings.ttsModelId, ttsModels, update],
  )

  const handleTryWake = useCallback(async () => {
    try {
      await window.spark.invoke('voice-assistant:trigger', {})
    } catch {
      /* 触发失败静默；HUD 与提示音反馈结果 */
    }
  }, [])

  if (!loaded) {
    return (
      <div className="settings-section">
        <h2>语音助手</h2>
        <div className="lede">正在读取设置…</div>
      </div>
    )
  }

  return (
    <div className="settings-section">
      <h2>语音助手</h2>
      <div className="lede">
        全局快捷键唤起语音对话：说话 → 转写进入会话 → 回复逐句语音播报。
        {status != null ? ` 当前状态：${STATE_LABEL[status.state] ?? status.state}。` : ''}
      </div>

      <div className="settings-card" style={{ marginBottom: 10 }}>
        <SettingsRow
          title="启用快捷键唤醒"
          tip={`在任意应用中按下唤醒快捷键即可开始语音对话（默认 ${DEFAULT_VOICE_ASSISTANT_SETTINGS.wakeShortcut}）。再按一次取消聆听 / 打断播报。`}
          right={
            <Switch checked={settings.enabled} onChange={(v) => void update({ enabled: v })} />
          }
        />
        <SettingsRow
          title="唤醒快捷键"
          tip="Electron accelerator 写法，如 Alt+Space、CommandOrControl+Shift+V。修改后立即生效；注册失败会回退原键位。"
          right={
            <input
              className="input"
              value={settings.wakeShortcut}
              spellCheck={false}
              onChange={(e) => setSettings({ ...settings, wakeShortcut: e.target.value })}
              onBlur={() => void update({})}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void update({})
              }}
            />
          }
        />
        <SettingsRow
          title="唤醒提示音"
          tip="聆听开始 / 转写为空 / 出错时的短提示音。"
          right={
            <Switch checked={settings.soundCues} onChange={(v) => void update({ soundCues: v })} />
          }
        />
        <SettingsRow
          title="连续对话模式"
          tip="播报完自动回到聆听（约 1 秒间隔），无需再按唤醒快捷键即可继续说；期间随时可按快捷键打断。"
          right={
            <Switch
              checked={settings.continuousMode}
              onChange={(v) => void update({ continuousMode: v })}
            />
          }
        />
        <SettingsRow
          title="口语化回复提示"
          tip="语音轮次自动要求 Agent 用简短口语回复，避免朗读代码块与表格。"
          right={
            <Switch
              checked={settings.voiceSystemPrompt}
              onChange={(v) => void update({ voiceSystemPrompt: v })}
            />
          }
        />
        <SettingsRow
          title="试一试"
          tip="立即触发一次唤醒（与按下快捷键等效）。"
          right={
            <button type="button" className="btn" onClick={() => void handleTryWake()}>
              开始语音对话
            </button>
          }
        />
      </div>

      <div className="settings-card" style={{ marginBottom: 10 }}>
        <SettingsRow
          title="识别引擎"
          tip="本地 Paraformer：流式实时（推荐）。云端 whisper：说完后整段上传转写，准确率更高但延迟增加 1–3 秒，且音频会上传到所配置的渠道。"
          right={
            <Select
              value={settings.recognitionEngine}
              onChange={(v) => void update({ recognitionEngine: v })}
              options={[
                { label: '本地（实时）', value: 'local' },
                { label: '云端（whisper）', value: 'cloud' },
              ]}
            />
          }
        />
        <SettingsRow
          title="说完判定"
          tip="检测到停顿后再等待一段静默确认才发送，期间继续说话会自动拼接，防止换气/思考停顿把话截断。「从容」适合说话慢或爱停顿的场景。"
          right={
            <Select
              value={String(settings.utteranceConfirmMs)}
              onChange={(v) => void update({ utteranceConfirmMs: Number(v) })}
              options={[
                { label: '快（0.6 秒）', value: '600' },
                { label: '标准（1.2 秒）', value: '1200' },
                { label: '从容（2 秒）', value: '2000' },
              ]}
            />
          }
        />
        <SettingsRow
          title="识别精修"
          tip="说完后用离线模型重识别整段音频并整体替换流式结果（与输入框语音输入同链路），显著减少漏字错字；代价是发送前多等约 1–3 秒。识别率优先建议保持开启。"
          right={
            <Switch
              checked={settings.refineTranscript}
              onChange={(v) => void update({ refineTranscript: v })}
            />
          }
        />
        <SettingsRow
          title="浏览器降噪"
          tip="采集源头开启系统级降噪与人声隔离，过滤风扇/空调等稳态噪音。注意：降噪会削掉部分字头轻辅音，可能造成漏字——识别率优先请保持关闭，仅嘈杂环境开启。"
          right={
            <Switch
              checked={settings.browserDenoise}
              onChange={(v) => void update({ browserDenoise: v })}
            />
          }
        />
        <SettingsRow
          title="人声聚焦"
          tip="尽量只保留你本人的近场人声：低能量远场声音（电视/旁人/音乐）在识别前被静音，噪音硬解出的句子也会被本地人声检测否决。门控有轻微吃字头/字尾的风险（已尽量优化），识别率优先建议关闭，仅噪音大的环境开启。首次开启自动下载人声检测模型（约 0.5MB）。"
          right={
            <Select
              value={settings.voiceFocus}
              onChange={(v) => void update({ voiceFocus: v })}
              options={[
                { label: '关闭（推荐）', value: 'off' },
                { label: '标准', value: 'standard' },
                { label: '严格', value: 'strict' },
              ]}
            />
          }
        />
        <SettingsRow
          title="播报渠道"
          tip="语音播报（TTS）使用的渠道；默认自动选择第一个可用的语音渠道。选定后可在下方指定模型与音色。"
          right={
            <Select
              value={settings.ttsProviderProfileId ?? TTS_AUTO_CHANNEL_VALUE}
              onChange={(value) => handleTtsChannelChange(String(value))}
              options={ttsChannelSelectOptions}
            />
          }
        />
        <SettingsRow
          title="播报模型"
          tip="该渠道下用于语音合成的模型；「渠道默认模型」由渠道自身决定。需先选定播报渠道。"
          right={
            <Select
              value={settings.ttsModelId ?? TTS_DEFAULT_MODEL_VALUE}
              onChange={(value) => {
                const next = String(value)
                void update({ ttsModelId: next === TTS_DEFAULT_MODEL_VALUE ? null : next })
              }}
              options={ttsModelSelectOptions}
              disabled={
                settings.ttsProviderProfileId == null || effectiveTtsChannelModels.length === 0
              }
            />
          }
        />
        <SettingsRow
          title="音色"
          tip={`语音播报（TTS）的合成音色；留空使用渠道默认音色${
            ttsDefaultVoice != null ? `（当前为 ${ttsDefaultVoice}）` : ''
          }。候选来自所选渠道 / 模型声明的音色，也可直接输入未列出的音色 ID（如复刻音色）。`}
          right={
            ttsVoiceCandidates.length > 0 ? (
              <AutoComplete
                value={settings.ttsVoice || undefined}
                allowClear
                options={ttsVoiceCandidates}
                placeholder={ttsDefaultVoice != null ? `默认（${ttsDefaultVoice}）` : '默认音色'}
                onChange={(value) =>
                  setSettings({ ...settings, ttsVoice: value == null ? '' : String(value) })
                }
                onSelect={(value) => {
                  // 选中即持久化：onBlur 只在离开输入框时触发，单靠它会让「选完就走」丢失。
                  const next = String(value)
                  setSettings({ ...settings, ttsVoice: next })
                  void update({ ttsVoice: next })
                }}
                onBlur={() => void update({})}
                filterOption={(input, option) => {
                  const query = String(input ?? '').toLowerCase()
                  return [option?.value, option?.label].some((candidate) =>
                    String(candidate ?? '')
                      .toLowerCase()
                      .includes(query),
                  )
                }}
              />
            ) : (
              <input
                className="input"
                value={settings.ttsVoice}
                placeholder="默认音色"
                onChange={(e) => setSettings({ ...settings, ttsVoice: e.target.value })}
                onBlur={() => void update({})}
              />
            )
          }
        />
        <SettingsRow
          title="语速"
          tip="语音播报语速，0.5–2.0，1.0 为原速。"
          right={
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={settings.ttsSpeed}
              onChange={(e) => setSettings({ ...settings, ttsSpeed: Number(e.target.value) })}
              onMouseUp={() => void update({})}
              onTouchEnd={() => void update({})}
            />
          }
        />
        <SettingsRow
          title="音量"
          tip="语音播报音量，0–10，1.0 为默认；仅 MiniMax 等支持音量参数的渠道生效。"
          right={
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={settings.ttsVol}
              onChange={(e) => setSettings({ ...settings, ttsVol: Number(e.target.value) })}
              onMouseUp={() => void update({})}
              onTouchEnd={() => void update({})}
            />
          }
        />
        <SettingsRow
          title="音调"
          tip="语音播报音调，-12–12，0 为默认；仅支持音调参数的渠道生效。"
          right={
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={settings.ttsPitch}
              onChange={(e) => setSettings({ ...settings, ttsPitch: Number(e.target.value) })}
              onMouseUp={() => void update({})}
              onTouchEnd={() => void update({})}
            />
          }
        />
        <SettingsRow
          title="情绪"
          tip="合成情绪倾向（MiniMax voice_setting.emotion 语义），默认不指定。"
          right={
            <Select
              value={settings.ttsEmotion === '' ? 'default' : settings.ttsEmotion}
              onChange={(v) => {
                setSettings({ ...settings, ttsEmotion: v === 'default' ? '' : String(v) })
                void update({})
              }}
              options={[
                { label: '默认（不指定）', value: 'default' },
                { label: '开心 happy', value: 'happy' },
                { label: '悲伤 sad', value: 'sad' },
                { label: '愤怒 angry', value: 'angry' },
                { label: '恐惧 fearful', value: 'fearful' },
                { label: '厌恶 disgusted', value: 'disgusted' },
                { label: '惊讶 surprised', value: 'surprised' },
                { label: '平静 calm', value: 'calm' },
              ]}
            />
          }
        />
      </div>

      <div className="settings-card" style={{ marginBottom: 10 }}>
        <SettingsRow
          title="语音会话思考"
          tip="开启后语音会话以固定推理档运行，大幅缩短回复等待（思考会显著拉长首字时间）。仅影响语音会话，普通对话的推理设置不受影响；关闭后跟随语音 Agent 的默认档位。切换即时生效并同步已绑定的语音会话。"
          right={
            <Switch
              checked={settings.sessionThinkingEnabled}
              onChange={(v) => void update({ sessionThinkingEnabled: v })}
            />
          }
        />
        <SettingsRow
          title="思考强度"
          tip="语音会话使用的推理档位（各适配器映射到自身最近档位）；思考开关关闭时不生效。"
          right={
            <Select
              value={settings.sessionThinkingEffort}
              onChange={(v) => void update({ sessionThinkingEffort: v })}
              options={THINKING_EFFORT_OPTIONS}
              disabled={!settings.sessionThinkingEnabled}
            />
          }
        />
        <SettingsRow
          title="语音会话权限模式"
          tip={`语音新建会话使用的权限模式；已有绑定会话沿用其自身设置。当前语音 Agent：${
            sessionAgent?.agentName ?? '默认 Agent'
          }（${ADAPTER_LABEL[sessionAgent?.adapter ?? 'claude-sdk']} 适配器），选项随适配器自动切换；不适配的旧值在新建会话时自动回退推荐档。`}
          right={
            <Select
              value={getValidPermissionMode(
                settings.sessionPermissionMode,
                sessionAgent?.adapter ?? 'claude-sdk',
              )}
              onChange={(v) => void update({ sessionPermissionMode: v })}
              options={getPermissionModeOptions(sessionAgent?.adapter ?? 'claude-sdk').map(
                (option) => ({ label: option.label, value: option.value }),
              )}
            />
          }
        />
        <SettingsRow
          title="重置语音会话绑定"
          tip="解绑当前语音会话；下次唤醒将新建会话（原会话保留在会话列表）。"
          right={
            <button
              type="button"
              className="btn"
              onClick={() => {
                void window.spark.invoke('voice-assistant:reset-route', {}).catch(() => undefined)
              }}
            >
              解绑
            </button>
          }
        />
      </div>

      <div className="settings-card">
        <SettingsRow
          title="常驻唤醒词聆听"
          tip="类似「嘿 Siri」：麦克风持续采集，唤醒词检测完全在本地推理（音频不出本机），音频不发送到任何服务器。开启后 macOS 麦克风指示灯会常亮；唤醒词模型未安装时会自动下载（约 5MB）。"
          right={
            <Switch
              checked={settings.alwaysListening}
              onChange={(v) => void update({ alwaysListening: v })}
            />
          }
        />
        <SettingsRow
          title="唤醒词"
          tip="说「嘿 Spark」或中文备选词唤醒；检测完全本地。"
          right={
            <Select
              value={settings.wakeWord}
              onChange={(v) => void update({ wakeWord: v })}
              options={[
                { label: '嘿 Spark', value: 'hey-spark' },
                { label: '你好星火', value: 'nihao-xinghuo' },
                { label: '星火星火', value: 'xinghuo-xinghuo' },
                { label: '小星小星', value: 'xiaoxing-xiaoxing' },
              ]}
            />
          }
        />
        <SettingsRow
          title="唤醒灵敏度（阈值）"
          tip="越低越容易唤醒（也越易误触发）。默认 0.10 已按「嘿 Spark」实测校准；真人声可微调 0.08–0.15。"
          right={
            <input
              type="range"
              min={0.05}
              max={0.3}
              step={0.01}
              value={settings.wakeThreshold}
              onChange={(e) => setSettings({ ...settings, wakeThreshold: Number(e.target.value) })}
              onMouseUp={() => void update({})}
              onTouchEnd={() => void update({})}
            />
          }
        />
      </div>

      {saveError != null ? (
        <div className="lede" style={{ color: 'var(--danger, #d44950)' }}>
          设置保存失败：{saveError}
        </div>
      ) : null}
    </div>
  )
}
