/**
 * VoiceIntegritySettingsItem — 设置 → 完整性 面板中的「语音输入 (ASR)」检测与安装卡片。
 *
 * 展示各组件的就绪状态：
 *   - native: sherpa-onnx native 推理模块（按平台 prebuilt）
 *   - model:  paraformer 流式 ASR 模型 + silero VAD
 *   - refine: SenseVoice 离线精修模型（可选，说完后整段重识别替换流式结果）
 *
 * 视觉风格对齐 IntegritySection 中已有的 SDK / FFmpeg / Playwright 完整性项：
 *   - 复用 `.integrity-sdk-card`、`.integrity-sdk-row`、`.badge .dot` 等现有类与 design token
 *   - 仅在 voice.less 内补少量布局类（header / actions / progress）
 *
 * 状态/进度通过 useVoiceIntegrity 订阅 stream:voice:status 与 stream:voice:install-progress。
 * 平台不支持时（supported=false）展示原因并禁用安装按钮。
 */
import type { ReactElement } from 'react'
import type {
  VoiceComponentStatus,
  VoiceInstallProgress,
  VoicePackComponent,
} from '@spark/protocol'
import { Button } from '@lobehub/ui'
import { Icons } from '../Icons'
import { useVoiceIntegrity } from './useVoiceIntegrity'
import './voice.less'

const COMPONENT_ORDER: readonly VoicePackComponent[] = ['native', 'model', 'refine'] as const

const COMPONENT_LABEL: Record<VoicePackComponent, string> = {
  native: '推理引擎 (native)',
  model: '识别模型 (model)',
  refine: '精修模型 (refine)',
}

const COMPONENT_DESC: Record<VoicePackComponent, string> = {
  native:
    'sherpa-onnx native 模块，提供 OnlineRecognizer 流式推理与 OfflineRecognizer 整段识别调用。',
  model: 'Paraformer 流式中文 ASR 模型 + silero VAD，约 219 MB。',
  refine:
    'SenseVoice 离线整段识别模型（可选，约 230 MB），说完后重识别整段音频以提升准确率并补齐标点。',
}

const PROGRESS_STATE_LABEL: Record<VoiceInstallProgress['state'], string> = {
  preparing: '准备下载',
  downloading: '下载中',
  verifying: '校验完整性',
  activating: '解压安装',
  done: '已完成',
  error: '安装失败',
}

function findComponent(
  components: VoiceComponentStatus[],
  target: VoicePackComponent,
): VoiceComponentStatus | null {
  return components.find((c) => c.component === target) ?? null
}

function describeVersion(c: VoiceComponentStatus | null): string {
  if (!c) return '尚未检测'
  if (c.state === 'ready') {
    return c.installedVersion ? `v${c.installedVersion}` : '已就绪'
  }
  if (c.state === 'downloading') {
    return c.installedVersion ? `升级中 (当前 v${c.installedVersion})` : '下载中'
  }
  if (c.state === 'missing') return '未安装'
  if (c.state === 'error') return '安装失败'
  return '—'
}

function describeLatest(c: VoiceComponentStatus | null): string | null {
  if (!c) return null
  if (!c.latestVersion) return null
  if (c.latestVersion === c.installedVersion) return null
  return `最新 v${c.latestVersion}`
}

function renderComponentBadge(c: VoiceComponentStatus | null, optional = false): ReactElement {
  if (!c) return <span className="badge dot">未知</span>
  switch (c.state) {
    case 'ready':
      return <span className="badge success dot">就绪</span>
    case 'downloading':
      return <span className="badge warning dot">下载中</span>
    case 'missing':
      // 可选组件缺失属于正常状态，不渲染成红色告警
      return optional ? (
        <span className="badge dot">未安装</span>
      ) : (
        <span className="badge error dot">未安装</span>
      )
    case 'error':
      return <span className="badge error dot">失败</span>
    default:
      return <span className="badge dot">未知</span>
  }
}

function VoiceProgressView({ progress }: { progress: VoiceInstallProgress }): ReactElement {
  const rawPercent = progress.percent
  const percent = rawPercent == null ? null : Math.max(0, Math.min(100, Math.round(rawPercent)))
  const label = percent == null ? '准备中' : `${percent}%`
  const active = progress.state !== 'done' && progress.state !== 'error'
  return (
    <div className={`voice-progress is-${progress.state}`}>
      <div className="voice-progress-head">
        <span>{progress.message || PROGRESS_STATE_LABEL[progress.state]}</span>
        <strong>{label}</strong>
      </div>
      <div
        className={`voice-progress-track${percent == null && active ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-label={PROGRESS_STATE_LABEL[progress.state]}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent != null ? { 'aria-valuenow': percent } : {})}
      >
        <div className="voice-progress-fill" style={{ width: `${percent ?? 36}%` }} />
      </div>
    </div>
  )
}

export function VoiceIntegritySettingsItem(): ReactElement {
  const { status, progress, checking, refresh, install } = useVoiceIntegrity()

  const native = findComponent(status.components, 'native')
  const model = findComponent(status.components, 'model')
  const refine = findComponent(status.components, 'refine')

  const isUnsupported = !status.supported
  const isInstalling = status.downloading
  const isReady = status.ready
  // 核心就绪但可选组件（如精修模型）缺失时不算"全部就绪"，安装按钮走按需补装而非强制重装
  const allComponentsReady =
    native?.state === 'ready' && model?.state === 'ready' && refine?.state === 'ready'

  const activeProgress =
    progress != null && progress.state !== 'done' && progress.state !== 'error' ? progress : null

  const progressPercent = activeProgress?.percent
  const progressLabel =
    progressPercent != null ? `${Math.round(progressPercent)}%` : isInstalling ? '准备中' : null

  const handleInstall = async (): Promise<void> => {
    // 全部组件就绪 → 强制重装(修复用);有缺失(含可选精修模型) → 按需安装,缺啥补啥
    await install(allComponentsReady)
  }

  const handleRefresh = async (): Promise<void> => {
    await refresh(true)
  }

  const overallBadge = isUnsupported ? (
    <div className="integrity-status-badge warn">
      <Icons.AlertTriangle size={14} />
      <span>当前平台不支持</span>
    </div>
  ) : isReady ? (
    <div className="integrity-status-badge ok">
      <Icons.CheckCircle size={14} />
      <span>{allComponentsReady ? '语音包已就绪' : '语音包已就绪 · 精修模型未安装'}</span>
    </div>
  ) : isInstalling ? (
    <div className="integrity-status-badge warn">
      <Icons.Spinner size={14} />
      <span>正在安装语音包</span>
    </div>
  ) : (
    <div className="integrity-status-badge warn">
      <Icons.AlertTriangle size={14} />
      <span>语音包未就绪</span>
    </div>
  )

  const installButtonLabel = isUnsupported
    ? '不支持'
    : isInstalling
      ? (progressLabel ?? '下载中')
      : !isReady
        ? '安装语音包'
        : allComponentsReady
          ? '重新安装'
          : '安装精修模型'

  return (
    <div className="settings-section voice-integrity-settings">
      <div className="voice-integrity-header">
        <div className="voice-integrity-heading">
          <h2>语音输入 (ASR)</h2>
          <div className="lede">
            离线语音输入依赖跨平台 native 推理引擎与中文识别模型，首次使用时按需下载 （约 230
            MB，视平台而定），不打进安装包。安装可选的精修模型后，说完话会
            自动整段重新识别，替换实时预览文本以获得更高准确率与标点。
          </div>
        </div>
        <div className="voice-integrity-header-actions">
          <Button
            size="middle"
            type="text"
            onClick={() => void handleRefresh()}
            disabled={checking}
            loading={checking}
            icon={<Icons.Refresh size={14} className={checking ? 'spin' : ''} />}
          >
            重新检查
          </Button>
        </div>
      </div>

      {overallBadge}

      {isUnsupported && status.unsupportedReason && (
        <div className="integrity-banner error">
          <Icons.AlertTriangle size={14} />
          <span>{status.unsupportedReason}</span>
        </div>
      )}

      {!isUnsupported && (
        <div className="settings-card integrity-sdk-card voice-integrity-card">
          {COMPONENT_ORDER.map((key, idx) => {
            const comp = key === 'native' ? native : key === 'model' ? model : refine
            const latest = describeLatest(comp)
            const versionText = describeVersion(comp)
            const versionRow = latest ? `${versionText} · ${latest}` : versionText
            return (
              <div key={key} className={`integrity-sdk-row ${idx > 0 ? 'bordered' : ''}`}>
                <div className="integrity-tool-icon">
                  {key === 'native' ? (
                    <Icons.Cpu size={14} />
                  ) : key === 'refine' ? (
                    <Icons.Wand size={14} />
                  ) : (
                    <Icons.Package size={14} />
                  )}
                </div>
                <div className="integrity-sdk-info">
                  <div className="integrity-sdk-name">{COMPONENT_LABEL[key]}</div>
                  <div className="integrity-sdk-version">
                    {versionRow}
                    {comp?.artifactId ? ` · ${comp.artifactId}` : ''}
                  </div>
                  <div className="voice-integrity-desc">{COMPONENT_DESC[key]}</div>
                </div>
                <div className="integrity-sdk-right">
                  {renderComponentBadge(comp, key === 'refine')}
                  {activeProgress?.component === key && (
                    <span className="badge warning dot">
                      {PROGRESS_STATE_LABEL[activeProgress.state]}
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          {activeProgress && (
            <div className="voice-integrity-progress-wrap">
              <VoiceProgressView progress={activeProgress} />
            </div>
          )}

          {status.lastError && <div className="integrity-sdk-error">{status.lastError}</div>}
        </div>
      )}

      <div className="voice-integrity-actions">
        <Button
          size="middle"
          type={!isReady || !allComponentsReady ? 'primary' : 'default'}
          onClick={() => void handleInstall()}
          disabled={isUnsupported || isInstalling}
          loading={isInstalling}
          icon={<Icons.Download size={14} />}
        >
          {installButtonLabel}
        </Button>
      </div>
    </div>
  )
}
