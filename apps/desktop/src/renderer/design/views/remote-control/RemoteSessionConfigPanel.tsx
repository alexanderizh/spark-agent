/**
 * 远程会话配置面板（配置 tab，2026-11-25 重写为本地 ChatConfigPanel 同款）。
 *
 * 功能与样式完全对齐本地会话侧面板：
 *   - 环境变量（项目 + 会话，KEY/VALUE/说明 三字段行 + 增删/复制/粘贴/保存）
 *   - 提示词（项目 + 会话 textarea + 保存）
 *   - 提示词注入过滤（RemotePromptInjectionFilterSection）
 *   - Hooks 生效列表（RemoteSessionHooksSection）
 *
 * 样式直接复用本地面板的类名（session-panel / inspector-section /
 * session-panel-toggle / runtime-env-row / runtime-prompt-block 等，
 * 定义在 SessionPanelDesign.less + ChatInspectorPanel.less，随包全局生效），
 * 数据通道走 /v1/sessions/:id/runtime-config + /v1/runtime-config/:kind。
 *
 * 助手/模型/权限/推理力度不在这里：本地语义里它们属于输入框参数栏，
 * 远程聊天输入框的 chips 已承载同链路能力（useRemoteComposerConfig）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import type { EnvVarItem } from '@spark/protocol'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
import { useToast } from '../../components/Toast'
import { parseEnvVarsJson, serializeEnvVarsJson } from '../chat/chat-config-env-json'
import {
  useRemoteSessionRuntimeConfig,
  type RemoteRuntimeConfigScope,
} from './useRemoteSessionRuntimeConfig'
import { RemotePromptInjectionFilterSection } from './RemotePromptInjectionFilterSection'
import { RemoteSessionHooksSection } from './RemoteSessionHooksSection'

/** 未归属会话的虚拟项目 id（project 层配置不存在，只渲染会话层） */
const UNASSIGNED_WORKSPACE_ID = 'default'

function EnvVarRow({
  item,
  onUpdate,
  onRemove,
  onBlurPersist,
}: {
  item: EnvVarItem
  onUpdate: (patch: Partial<EnvVarItem>) => void
  onRemove: () => void
  onBlurPersist?: () => void
}) {
  return (
    <div className="runtime-env-row">
      <label className="session-env-field session-env-field--key">
        <span>{translate('chatInspector.t59')}</span>
        <input
          aria-label={translate('chatInspector.t44')}
          className="form-input runtime-env-key"
          placeholder="KEY"
          value={item.key}
          onChange={(event) => onUpdate({ key: event.target.value })}
          onBlur={onBlurPersist}
        />
      </label>
      <label className="session-env-field session-env-field--value">
        <span>{translate('chatInspector.t60')}</span>
        <input
          aria-label={translate('chatInspector.tpl24Desc', {
            name: item.key.trim() || translate('chatInspector.t1'),
          })}
          className="form-input runtime-env-value"
          placeholder="VALUE"
          value={item.value}
          onChange={(event) => onUpdate({ value: event.target.value })}
          onBlur={onBlurPersist}
        />
      </label>
      <label className="session-env-field session-env-field--description">
        <span>{translate('chatInspector.t61')}</span>
        <input
          aria-label={translate('chatInspector.tpl25Desc', {
            name: item.key.trim() || translate('chatInspector.t1'),
          })}
          className="form-input runtime-env-description"
          placeholder={translate('chatInspector.t45')}
          value={item.description ?? ''}
          onChange={(event) => onUpdate({ description: event.target.value })}
          onBlur={onBlurPersist}
        />
      </label>
      <button
        type="button"
        className="btn ghost sm runtime-env-remove"
        onClick={onRemove}
        aria-label={translate('chatInspector.tpl26Desc', {
          name: item.key.trim() || translate('chatInspector.t2'),
        })}
        title={translate('chatInspector.t46')}
      >
        <Icons.Trash size={12} />
      </button>
    </div>
  )
}

export interface RemoteSessionConfigPanelProps {
  deviceId: string
  sessionId: string | null
}

export function RemoteSessionConfigPanel({ deviceId, sessionId }: RemoteSessionConfigPanelProps) {
  useI18n()
  const { toast } = useToast()
  const [envCollapsed, setEnvCollapsed] = useState(false)
  const [promptsCollapsed, setPromptsCollapsed] = useState(false)
  const [projectPromptDraft, setProjectPromptDraft] = useState('')
  const [sessionPromptDraft, setSessionPromptDraft] = useState('')
  const [projectEnvDraft, setProjectEnvDraft] = useState<EnvVarItem[]>([])
  const [sessionEnvDraft, setSessionEnvDraft] = useState<EnvVarItem[]>([])
  const runtimeConfig = useRemoteSessionRuntimeConfig(deviceId, sessionId)
  const { config } = runtimeConfig

  // 配置到达/重拉后同步草稿（本地面板 loadRuntimeConfig 同款时序）
  useEffect(() => {
    if (config == null) return
    setProjectPromptDraft(config.prompt.project.content)
    setSessionPromptDraft(config.prompt.session.content)
    setProjectEnvDraft(config.env.project.vars)
    setSessionEnvDraft(config.env.session.vars)
  }, [config])

  const hasProjectLayer = config != null && config.workspaceId !== UNASSIGNED_WORKSPACE_ID

  const savePromptLayer = useCallback(
    async (scope: RemoteRuntimeConfigScope, content: string) => {
      const saved = await runtimeConfig.savePrompt(scope, content)
      if (saved) {
        toast.success(
          translate('chatInspector.tpl27Desc', {
            scope: scope === 'project' ? translate('chatInspector.t5') : translate('chatInspector.t6'),
          }),
        )
      } else {
        toast.error(runtimeConfig.error ?? translate('chatInspector.t7'))
      }
    },
    [runtimeConfig, toast],
  )

  const saveEnvLayer = useCallback(
    async (scope: RemoteRuntimeConfigScope, vars: EnvVarItem[]) => {
      const saved = await runtimeConfig.saveEnv(scope, vars)
      if (saved) {
        toast.success(
          translate('chatInspector.tpl28Desc', {
            scope: scope === 'project' ? translate('chatInspector.t5') : translate('chatInspector.t6'),
          }),
        )
      } else {
        toast.error(runtimeConfig.error ?? translate('chatInspector.t8'))
      }
    },
    [runtimeConfig, toast],
  )

  const copyEnvJson = useCallback(
    async (scope: RemoteRuntimeConfigScope, vars: EnvVarItem[]) => {
      try {
        const json = serializeEnvVarsJson(vars)
        await navigator.clipboard.writeText(json)
        const count = parseEnvVarsJson(json).length
        toast.success(
          translate('chatInspector.tpl29Desc', {
            count,
            scope: scope === 'project' ? translate('chatInspector.t5') : translate('chatInspector.t6'),
          }),
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('chatInspector.t9'))
      }
    },
    [toast],
  )

  const pasteEnvJson = useCallback(
    async (scope: RemoteRuntimeConfigScope, setVars: (vars: EnvVarItem[]) => void) => {
      let text: string
      try {
        text = await navigator.clipboard.readText()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('chatInspector.t10'))
        return
      }
      if (text.trim().length === 0) {
        toast.warning(translate('chatInspector.t11'))
        return
      }
      let imported: EnvVarItem[]
      try {
        imported = parseEnvVarsJson(text)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('chatInspector.t12Desc'))
        return
      }
      const scopeLabel =
        scope === 'project' ? translate('chatInspector.t5') : translate('chatInspector.t6')
      const saved = await runtimeConfig.saveEnv(scope, imported, { silent: true })
      if (saved) {
        setVars(imported)
        toast.success(
          translate('chatInspector.tpl30Desc', { count: imported.length, scope: scopeLabel }),
        )
      } else {
        toast.error(runtimeConfig.error ?? translate('chatInspector.t8'))
      }
    },
    [runtimeConfig, toast],
  )

  const renderEnvBlock = (
    label: string,
    placeholder: string,
    scope: RemoteRuntimeConfigScope,
    vars: EnvVarItem[],
    setVars: React.Dispatch<React.SetStateAction<EnvVarItem[]>>,
  ) => {
    const updateVar = (index: number, patch: Partial<EnvVarItem>) =>
      setVars((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
    // 删除后立即静默保存（本地面板同款：不在 updater 里塞副作用，StrictMode 安全）
    const removeVar = (index: number) => {
      const next = vars.filter((_, i) => i !== index)
      setVars(next)
      void runtimeConfig.saveEnv(scope, next, { silent: true })
    }
    const addVar = () => setVars((prev) => [...prev, { key: '', value: '', description: '' }])
    // 失焦自动保存：填完没点保存就切走也不丢（vars 取当前渲染闭包，最新值可达）
    const persistOnBlur = () => {
      void runtimeConfig.saveEnv(scope, vars, { silent: true })
    }
    return (
      <div className="runtime-prompt-block">
        <div className="runtime-prompt-title">
          {label}
          <span className="session-panel-count">
            {translate('chatInspector.tpl17Desc', { count: vars.length })}
          </span>
        </div>
        <div className="session-panel-caption">
          {scope === 'project' ? translate('chatInspector.t13') : translate('chatInspector.t14Desc')}
        </div>
        {vars.length === 0 && <div className="runtime-env-empty">{placeholder}</div>}
        {vars.map((item, index) => (
          <EnvVarRow
            key={index}
            item={item}
            onUpdate={(patch) => updateVar(index, patch)}
            onRemove={() => removeVar(index)}
            onBlurPersist={persistOnBlur}
          />
        ))}
        <div className="runtime-env-actions">
          <button type="button" className="btn ghost sm runtime-env-add" onClick={addVar}>
            <Icons.Plus size={12} /> {translate('chatInspector.t62')}
          </button>
          <div className="runtime-env-transfer-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label={translate('chatInspector.tpl18Desc', { label })}
              title={translate('chatInspector.tpl19Desc', { label })}
              onClick={() => void copyEnvJson(scope, vars)}
            >
              <Icons.Copy size={12} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={translate('chatInspector.tpl20Desc', { label })}
              disabled={runtimeConfig.saving}
              title={translate('chatInspector.tpl21Desc', { label })}
              onClick={() => void pasteEnvJson(scope, setVars)}
            >
              <Icons.Clipboard size={12} />
            </button>
            <button
              type="button"
              className="btn ghost sm runtime-save-btn"
              disabled={runtimeConfig.saving}
              onClick={() => void saveEnvLayer(scope, vars)}
            >
              <Save size={12} />
              {scope === 'project'
                ? translate('chatInspector.t15')
                : translate('chatInspector.t16')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (sessionId == null) {
    return (
      <div className="rc-panel-placeholder">
        <Icons.Settings size={20} />
        <p>尚未选择会话；选择会话后可查看与调整配置。</p>
      </div>
    )
  }

  if (runtimeConfig.loading && config == null) {
    return (
      <div className="rc-panel-placeholder">
        <Icons.Settings size={20} />
        <p>正在读取会话配置…</p>
      </div>
    )
  }

  if (!runtimeConfig.supported) {
    return (
      <div className="rc-panel-placeholder">
        <Icons.Settings size={20} />
        <p>这台电脑的 SparkWork 版本较旧，暂不支持远程配置面板。</p>
        <p className="rc-panel-placeholder-sub">升级对方的桌面端后即可在此编辑环境变量与提示词。</p>
      </div>
    )
  }

  return (
    <div className="session-panel rc-session-panel-host">
      <div className="inspector scroll">
        <header className="session-panel-heading">
          <strong>{translate('chatInspector.t63')}</strong>
          <span>{translate('chatInspector.t64Desc')}</span>
        </header>

        {runtimeConfig.error != null && (
          <div className="rc-pane-hint error">
            {runtimeConfig.error}
            <button type="button" className="rc-link-btn" onClick={runtimeConfig.reload}>
              重试
            </button>
          </div>
        )}

        {/* 环境变量 */}
        {config != null && (
          <div className="inspector-section">
            <h4 className="config-panel-header">
              <button
                type="button"
                className="session-panel-toggle"
                aria-expanded={!envCollapsed}
                onClick={() => setEnvCollapsed(!envCollapsed)}
              >
                <Icons.Lock size={11} />
                {translate('chatInspector.t1')}
                <span className="spacer" />
                <Icons.ChevronRight
                  size={10}
                  className={`chev ${envCollapsed ? '' : 'chev-open'}`}
                />
              </button>
            </h4>
            {!envCollapsed && (
              <>
                <div className="runtime-env-hint">
                  {translate('chatInspector.tpl22LongDesc')}
                  {translate('chatInspector.tpl23LongDesc')}
                </div>
                {hasProjectLayer &&
                  renderEnvBlock(
                    translate('chatInspector.t17'),
                    translate('chatInspector.t18Desc'),
                    'project',
                    projectEnvDraft,
                    setProjectEnvDraft,
                  )}
                {renderEnvBlock(
                  translate('chatInspector.t19'),
                  translate('chatInspector.t20Desc'),
                  'session',
                  sessionEnvDraft,
                  setSessionEnvDraft,
                )}
              </>
            )}
          </div>
        )}

        {/* 提示词 */}
        {config != null && (
          <div className="inspector-section">
            <h4 className="config-panel-header">
              <button
                type="button"
                className="session-panel-toggle"
                aria-expanded={!promptsCollapsed}
                onClick={() => setPromptsCollapsed(!promptsCollapsed)}
              >
                <Icons.Edit size={11} />
                {translate('chatInspector.t65')}
                <span className="spacer" />
                <Icons.ChevronRight
                  size={10}
                  className={`chev ${promptsCollapsed ? '' : 'chev-open'}`}
                />
              </button>
            </h4>
            {!promptsCollapsed && (
              <>
                {hasProjectLayer && (
                  <div className="runtime-prompt-block">
                    <div className="runtime-prompt-title">{translate('chatInspector.t48')}</div>
                    <textarea
                      className="spark-textarea inspector-textarea"
                      aria-label={translate('chatInspector.t48')}
                      value={projectPromptDraft}
                      onChange={(event) => setProjectPromptDraft(event.target.value)}
                      placeholder={translate('chatInspector.t49Desc')}
                    />
                    <button
                      type="button"
                      className="btn ghost sm runtime-save-btn"
                      disabled={runtimeConfig.saving}
                      onClick={() => void savePromptLayer('project', projectPromptDraft)}
                    >
                      <Save size={12} />
                      {translate('chatInspector.t15')}
                    </button>
                  </div>
                )}
                <div className="runtime-prompt-block">
                  <div className="runtime-prompt-title">{translate('chatInspector.t50')}</div>
                  <textarea
                    className="spark-textarea inspector-textarea"
                    aria-label={translate('chatInspector.t50')}
                    value={sessionPromptDraft}
                    onChange={(event) => setSessionPromptDraft(event.target.value)}
                    placeholder={translate('chatInspector.t51')}
                  />
                  <button
                    type="button"
                    className="btn ghost sm runtime-save-btn"
                    disabled={runtimeConfig.saving}
                    onClick={() => void savePromptLayer('session', sessionPromptDraft)}
                  >
                    <Save size={12} />
                    {translate('chatInspector.t16')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 提示词注入过滤（项目级 + 会话级） */}
        {config != null && (
          <RemotePromptInjectionFilterSection
            sessionId={sessionId}
            workspaceId={hasProjectLayer ? config.workspaceId : undefined}
            runtimeConfig={runtimeConfig}
          />
        )}

        {/* Hooks：当前会话最终生效列表，允许会话临时停用继承 Hook */}
        <RemoteSessionHooksSection deviceId={deviceId} sessionId={sessionId} />
      </div>
    </div>
  )
}
