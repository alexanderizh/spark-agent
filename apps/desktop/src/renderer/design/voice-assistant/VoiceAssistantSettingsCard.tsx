/**
 * VoiceAssistantSettingsCard — 语音助手设置分区
 *
 * M1：快捷键唤醒（开关/键位）、提示音、语音系统提示、TTS 音色/语速、
 *     语音会话权限模式、状态展示与「试一试」。
 * M2（本卡片内预告，暂锁定）：常驻唤醒词聆听、唤醒词选择、识别引擎。
 *
 * 设置经 voice-assistant:get-settings / update-settings IPC 读写
 * （主进程 normalize 收敛 + 快捷键热更新），不走 localStorage。
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Select } from '@lobehub/ui'
import { Switch } from 'antd'
import type {
  VoiceAssistantSettings,
  VoiceAssistantStatus,
} from '@spark/protocol'
import { DEFAULT_VOICE_ASSISTANT_SETTINGS } from '@spark/protocol'

const PERMISSION_OPTIONS = [
  { label: '自动执行（claude-auto，推荐）', value: 'claude-auto' },
  { label: '自动编辑（claude-auto-edits）', value: 'claude-auto-edits' },
  { label: '每次询问（claude-ask）', value: 'claude-ask' },
]

const STATE_LABEL: Record<string, string> = {
  idle: '空闲',
  listening: '聆听中',
  thinking: '思考中',
  speaking: '播报中',
  standby: '待命（常驻聆听）',
}

function SettingsRow({ title, desc, right }: { title: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="settings-card-row">
      <div className="flex1 min-w-0">
        <div className="row-title">{title}</div>
        {desc && <div className="row-desc">{desc}</div>}
      </div>
      <div className="row-action">{right}</div>
    </div>
  )
}

export function VoiceAssistantSettingsCard() {
  const [settings, setSettings] = useState<VoiceAssistantSettings>(
    DEFAULT_VOICE_ASSISTANT_SETTINGS,
  )
  const [status, setStatus] = useState<VoiceAssistantStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await window.spark.invoke('voice-assistant:get-settings', {})
        if (!cancelled) {
          setSettings(res.settings)
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
          desc={`在任意应用中按下唤醒快捷键即可开始语音对话（默认 ${DEFAULT_VOICE_ASSISTANT_SETTINGS.wakeShortcut}）。再按一次取消聆听 / 打断播报。`}
          right={<Switch checked={settings.enabled} onChange={(v) => void update({ enabled: v })} />}
        />
        <div className="settings-card-row">
          <div className="flex1 min-w-0">
            <div className="row-title">唤醒快捷键</div>
            <div className="row-desc">
              Electron accelerator 写法，如 Alt+Space、CommandOrControl+Shift+V。
              修改后立即生效；注册失败会回退原键位。
            </div>
          </div>
          <div className="row-action">
            <input
              className="input"
              style={{ width: 180 }}
              value={settings.wakeShortcut}
              spellCheck={false}
              onChange={(e) => setSettings({ ...settings, wakeShortcut: e.target.value })}
              onBlur={() => void update({})}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void update({})
              }}
            />
          </div>
        </div>
        <SettingsRow
          title="唤醒提示音"
          desc="聆听开始 / 转写为空 / 出错时的短提示音。"
          right={
            <Switch checked={settings.soundCues} onChange={(v) => void update({ soundCues: v })} />
          }
        />
        <SettingsRow
          title="连续对话模式"
          desc="播报完自动回到聆听（约 1 秒间隔），无需再按唤醒快捷键即可继续说；期间随时可按快捷键打断。"
          right={
            <Switch
              checked={settings.continuousMode}
              onChange={(v) => void update({ continuousMode: v })}
            />
          }
        />
        <SettingsRow
          title="口语化回复提示"
          desc="语音轮次自动要求 Agent 用简短口语回复，避免朗读代码块与表格。"
          right={
            <Switch
              checked={settings.voiceSystemPrompt}
              onChange={(v) => void update({ voiceSystemPrompt: v })}
            />
          }
        />
        <SettingsRow
          title="试一试"
          desc="立即触发一次唤醒（与按下快捷键等效）。"
          right={
            <button type="button" className="btn" onClick={() => void handleTryWake()}>
              开始语音对话
            </button>
          }
        />
      </div>

      <div className="settings-card" style={{ marginBottom: 10 }}>
        <div className="settings-card-row">
          <div className="flex1 min-w-0">
            <div className="row-title">识别引擎</div>
            <div className="row-desc">
              本地 Paraformer：流式实时（推荐）。云端 whisper：说完后整段上传转写，
              准确率更高但延迟增加 1–3 秒，且音频会上传到所配置的渠道。
            </div>
          </div>
          <div className="row-action" style={{ minWidth: 160 }}>
            <Select
              value={settings.recognitionEngine}
              onChange={(v) => void update({ recognitionEngine: v })}
              options={[
                { label: '本地（实时）', value: 'local' },
                { label: '云端（whisper）', value: 'cloud' },
              ]}
            />
          </div>
        </div>
        <div className="settings-card-row">
          <div className="flex1 min-w-0">
            <div className="row-title">说完判定</div>
            <div className="row-desc">
              检测到停顿后再等待一段静默确认才发送，期间继续说话会自动拼接，
              防止换气/思考停顿把话截断。「从容」适合说话慢或爱停顿的场景。
            </div>
          </div>
          <div className="row-action" style={{ minWidth: 160 }}>
            <Select
              value={String(settings.utteranceConfirmMs)}
              onChange={(v) => void update({ utteranceConfirmMs: Number(v) })}
              options={[
                { label: '快（0.6 秒）', value: '600' },
                { label: '标准（1.2 秒）', value: '1200' },
                { label: '从容（2 秒）', value: '2000' },
              ]}
            />
          </div>
        </div>
        <SettingsRow title="语音播报（TTS）" desc="回复逐句合成播放；合成渠道默认自动选择第一个可用的语音渠道。" />
        <div className="settings-card-row">
          <div className="flex1 min-w-0">
            <div className="row-title">音色</div>
            <div className="row-desc">留空使用渠道默认音色（如 alloy、t030、narrator 等）。</div>
          </div>
          <div className="row-action">
            <input
              className="input"
              style={{ width: 180 }}
              value={settings.ttsVoice}
              placeholder="默认音色"
              onChange={(e) => setSettings({ ...settings, ttsVoice: e.target.value })}
              onBlur={() => void update({})}
            />
          </div>
        </div>
        <div className="settings-card-row">
          <div className="flex1 min-w-0">
            <div className="row-title">语速</div>
            <div className="row-desc">0.5–2.0，1.0 为原速。</div>
          </div>
          <div className="row-action" style={{ minWidth: 180 }}>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={settings.ttsSpeed}
              style={{ width: '100%' }}
              onChange={(e) => setSettings({ ...settings, ttsSpeed: Number(e.target.value) })}
              onMouseUp={() => void update({})}
              onTouchEnd={() => void update({})}
            />
          </div>
        </div>
      </div>

      <div className="settings-card" style={{ marginBottom: 10 }}>
        <SettingsRow
          title="语音会话权限模式"
          desc="语音新建会话使用的权限模式；已有绑定会话沿用其自身设置。"
        />
        <div className="settings-card-row">
          <div className="flex1 min-w-0">
            <div className="row-title">默认权限</div>
          </div>
          <div className="row-action" style={{ minWidth: 240 }}>
            <Select
              value={settings.sessionPermissionMode}
              onChange={(v) => void update({ sessionPermissionMode: v })}
              options={PERMISSION_OPTIONS}
            />
          </div>
        </div>
        <SettingsRow
          title="重置语音会话绑定"
          desc="解绑当前语音会话；下次唤醒将新建会话（原会话保留在会话列表）。"
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
          desc="类似「嘿 Siri」：麦克风持续采集，唤醒词检测完全在本地推理（音频不出本机），音频不发送到任何服务器。开启后 macOS 麦克风指示灯会常亮；唤醒词模型未安装时会自动下载（约 5MB）。"
          right={
            <Switch
              checked={settings.alwaysListening}
              onChange={(v) => void update({ alwaysListening: v })}
            />
          }
        />
        <div className="settings-card-row">
          <div className="flex1 min-w-0">
            <div className="row-title">唤醒词</div>
            <div className="row-desc">说「嘿 Spark」或中文备选词唤醒；检测完全本地。</div>
          </div>
          <div className="row-action" style={{ minWidth: 200 }}>
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
          </div>
        </div>
        <div className="settings-card-row">
          <div className="flex1 min-w-0">
            <div className="row-title">唤醒灵敏度（阈值）</div>
            <div className="row-desc">
              越低越容易唤醒（也越易误触发）。默认 0.10 已按「嘿 Spark」实测校准；真人声可微调 0.08–0.15。
            </div>
          </div>
          <div className="row-action" style={{ minWidth: 160 }}>
            <input
              type="range"
              min={0.05}
              max={0.3}
              step={0.01}
              value={settings.wakeThreshold}
              style={{ width: '100%' }}
              onChange={(e) =>
                setSettings({ ...settings, wakeThreshold: Number(e.target.value) })
              }
              onMouseUp={() => void update({})}
              onTouchEnd={() => void update({})}
            />
          </div>
        </div>
      </div>

      {saveError != null ? (
        <div className="lede" style={{ color: 'var(--danger, #d44950)' }}>
          设置保存失败：{saveError}
        </div>
      ) : null}
    </div>
  )
}
