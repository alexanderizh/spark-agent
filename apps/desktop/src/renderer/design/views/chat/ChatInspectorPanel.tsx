import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './ChatInspectorPanel.less'
import './SessionPanelDesign.less'
import { CheckCircle, Save } from 'lucide-react'
import { Popover } from '@lobehub/ui'
import { Switch } from 'antd'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
import { TeamInspectorSection } from '../../components/TeamInspectorSection'
import { ProjectAgentScopeSection } from '../../components/ProjectAgentScopeSection'
import { ChatInspectorPerf } from './ChatInspectorPerf'
import { OutcomeRoomContainer } from '../../outcome-room/OutcomeRoomContainer'
import { InspectorCollapsibleSection } from '../../components/InspectorCollapsibleSection'
import { ChatInspectorToolLog } from '../../components/ChatInspectorToolLog'
import { ChatInspectorJourney } from '../../components/ChatInspectorJourney'
import { WorktreePanel } from '../../components/WorktreePanel'
import { useToast } from '../../components/Toast'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useSessionSidebar } from '../../SessionSidebarContext'
import {
  buildTurnUsageRows,
  buildUsageDataFromEvents,
  clamp,
  computeCacheHitRate,
  formatTokenCount,
  resolveContextUsedTokens,
  resolveDisplayedContextWindow,
  resolveMatchingRuntimeContextSnapshot,
  type RuntimeContextSnapshotState,
} from './ChatViewUtils'
import { extractInspectorSubagents, isRecord, type InspectorTask } from './ChatInspectorUtils'
import type { FileOpenHandler } from '../../components/fileOpenRouting'
import type {
  AgentEvent,
  EnvConfigGetResponse,
  EnvVarItem,
  ManagedAgent,
  PromptConfigGetResponse,
  ProviderProfile,
  SessionReasoningEffort,
  SessionChatMode,
  SessionId,
  TeamModeConfig,
  TurnPromptSnapshotEvent,
  TurnRuntimeMetrics,
  UsageGetSessionResponse,
  WorkspaceInfo,
} from '@spark/protocol'
import { LOCAL_CLI_PROVIDER_ID, LOCAL_CODEX_CLI_PROVIDER_ID } from '@spark/protocol'
import { hasChatConfigScope } from './chat-config-panel-state'
import { setTeamActivityLogsVisible, useTeamActivityLogsVisible } from './team-log-visibility'
import type { SessionSummary } from '../../SessionSidebarContext'
import type {
  ContextLedgerState,
  ContextUsageState,
  ProjectContextState,
  SessionUsageData,
  TurnUsageRow,
} from './ChatUsageTypes'
import type { UIMessage } from '../../services/event-mapper'
import { getVisibleTurnPromptSnapshotUserMessage } from './internal-turn-message-visibility'
import { parseEnvVarsJson, serializeEnvVarsJson } from './chat-config-env-json'
import { SessionHooksSection } from '../hooks/SessionHooksSection'

const EMPTY_PROMPT_LAYER: PromptConfigGetResponse['system'] = { enabled: false, content: '' }
const EMPTY_ENV_LAYER: EnvConfigGetResponse['project'] = { enabled: true, vars: [] }
const LOCAL_CLI_MODEL_DISPLAY = 'claude cli'
const LOCAL_CODEX_CLI_MODEL_DISPLAY = 'codex cli'
// 当前阶段暂时隐藏检查器中的工作区快照入口；相关能力与数据逻辑保留，后续可重新开启。
const SHOW_WORKSPACE_SNAPSHOT_INSPECTOR_SECTION = false
// 当前阶段暂时隐藏检查器中的 worktree 模块；组件和相关能力保留，后续可重新开启。
const SHOW_WORKTREE_INSPECTOR_SECTION = false

type EnvVarRowProps = {
  item: EnvVarItem
  onUpdate: (patch: Partial<EnvVarItem>) => void
  onRemove: () => void
  onBlurPersist?: () => void
}

function EnvVarRow({ item, onUpdate, onRemove, onBlurPersist }: EnvVarRowProps) {
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

function normalizePromptConfig(value: unknown): PromptConfigGetResponse {
  const config = isRecord(value) ? value : {}
  return {
    system: normalizePromptLayer(config.system),
    agent: normalizePromptLayer(config.agent),
    project: normalizePromptLayer(config.project),
    session: normalizePromptLayer(config.session),
    effectivePrompt: typeof config.effectivePrompt === 'string' ? config.effectivePrompt : '',
  }
}

function normalizePromptLayer(value: unknown): PromptConfigGetResponse['system'] {
  if (!isRecord(value)) return EMPTY_PROMPT_LAYER
  const content = typeof value.content === 'string' ? value.content : ''
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : content.trim().length > 0,
    content,
  }
}

function normalizeEnvConfig(value: unknown): EnvConfigGetResponse {
  const config = isRecord(value) ? value : {}
  return {
    project: normalizeEnvLayer(config.project),
    session: normalizeEnvLayer(config.session),
    effectiveEnv: isRecord(config.effectiveEnv)
      ? (config.effectiveEnv as Record<string, string>)
      : {},
  }
}

function normalizeEnvLayer(value: unknown): EnvConfigGetResponse['project'] {
  if (!isRecord(value)) return EMPTY_ENV_LAYER
  const rawVars = Array.isArray(value.vars) ? value.vars : []
  const vars: EnvVarItem[] = []
  for (const raw of rawVars) {
    if (!isRecord(raw)) continue
    const key = typeof raw.key === 'string' ? raw.key : ''
    vars.push({
      key,
      value: typeof raw.value === 'string' ? raw.value : '',
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    })
  }
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    vars,
  }
}

export function ChatConfigPanel({
  session,
  workspace,
  width,
  onWidthChange,
  agentId,
  embedded = false,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  width: number
  onWidthChange: (width: number) => void
  /** 当前会话实际使用的 agent ID（team mode 下为 host agent ID） */
  agentId?: string
  embedded?: boolean
}) {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const { toast } = useToast()
  const [promptsCollapsed, setPromptsCollapsed] = useState(false)
  const [envCollapsed, setEnvCollapsed] = useState(false)
  const [hooksCollapsed, setHooksCollapsed] = useState(false)
  const [promptConfig, setPromptConfig] = useState<PromptConfigGetResponse | null>(null)
  const [envConfig, setEnvConfig] = useState<EnvConfigGetResponse | null>(null)
  const [projectPromptDraft, setProjectPromptDraft] = useState('')
  const [sessionPromptDraft, setSessionPromptDraft] = useState('')
  const [projectEnvDraft, setProjectEnvDraft] = useState<EnvVarItem[]>([])
  const [sessionEnvDraft, setSessionEnvDraft] = useState<EnvVarItem[]>([])
  const [savingRuntime, setSavingRuntime] = useState(false)
  const { invoke: getPromptConfig } = useIpcInvoke('prompt-config:get')
  const { invoke: updatePromptConfig } = useIpcInvoke('prompt-config:update')
  const { invoke: getEnvConfig } = useIpcInvoke('env-config:get')
  const { invoke: updateEnvConfig } = useIpcInvoke('env-config:update')
  const sessionCtx = useSessionSidebar()
  const allAgents = sessionCtx.agents
  const [agentScopeCollapsed, setAgentScopeCollapsed] = useState(false)
  const sessionId = session?.id as string | undefined
  const workspaceId = workspace?.id

  const loadRuntimeConfig = useCallback(async () => {
    const req = {
      ...(workspaceId != null ? { workspaceId } : {}),
      ...(sessionId != null ? { sessionId } : {}),
      ...(agentId != null ? { agentId } : {}),
    }
    const [promptsRes, envRes] = await Promise.all([getPromptConfig(req), getEnvConfig(req)])
    const normalizedPrompts = normalizePromptConfig(promptsRes)
    const normalizedEnv = normalizeEnvConfig(envRes)
    setPromptConfig(normalizedPrompts)
    setEnvConfig(normalizedEnv)
    setProjectPromptDraft(normalizedPrompts.project.content)
    setSessionPromptDraft(normalizedPrompts.session.content)
    setProjectEnvDraft(normalizedEnv.project.vars)
    setSessionEnvDraft(normalizedEnv.session.vars)
  }, [getEnvConfig, getPromptConfig, sessionId, workspaceId, agentId])

  useEffect(() => {
    if (!hasChatConfigScope(sessionId, workspaceId)) {
      setPromptConfig(null)
      setEnvConfig(null)
      setProjectPromptDraft('')
      setSessionPromptDraft('')
      setProjectEnvDraft([])
      setSessionEnvDraft([])
      return
    }
    void loadRuntimeConfig()
  }, [loadRuntimeConfig, sessionId, workspaceId])

  const savePromptLayer = useCallback(
    async (scope: 'project' | 'session', scopeRef: string, content: string) => {
      setSavingRuntime(true)
      try {
        await updatePromptConfig({
          scope,
          scopeRef,
          value: { enabled: content.trim().length > 0, content },
        })
        await loadRuntimeConfig()
        toast.success(
          translate('chatInspector.tpl27Desc', {
            scope:
              scope === 'project' ? translate('chatInspector.t5') : translate('chatInspector.t6'),
          }),
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('chatInspector.t7'))
      } finally {
        setSavingRuntime(false)
      }
    },
    [loadRuntimeConfig, updatePromptConfig, toast],
  )

  const saveEnvLayer = useCallback(
    async (
      scope: 'project' | 'session',
      scopeRef: string,
      vars: EnvVarItem[],
      options?: { silent?: boolean; successMessage?: string },
    ) => {
      // 仅保留键名非空的条目；键名两端空白去除。
      const cleaned = vars
        .map((item) => ({
          key: item.key.trim(),
          value: item.value,
          ...(item.description != null && item.description.trim().length > 0
            ? { description: item.description.trim() }
            : {}),
        }))
        .filter((item) => item.key.length > 0)
      // silent 路径用于失焦/增删时的自动保存：不切换 savingRuntime 状态、不重拉全量配置，
      // 避免高频自动保存造成按钮抖动与无谓的 skills/prompts 重复加载。
      if (!options?.silent) setSavingRuntime(true)
      try {
        await updateEnvConfig({
          scope,
          scopeRef,
          value: { enabled: true, vars: cleaned },
        })
        if (!options?.silent) {
          await loadRuntimeConfig()
          toast.success(
            options?.successMessage ??
              translate('chatInspector.tpl28Desc', {
                scope:
                  scope === 'project'
                    ? translate('chatInspector.t5')
                    : translate('chatInspector.t6'),
              }),
          )
        }
        return true
      } catch (err) {
        // 失败必须可见，否则用户以为「失焦已保存」实际丢了。
        // silent 路径触发频率高，用 console.warn 记录即可；显式保存失败弹 toast。
        if (options?.silent) {
          console.warn('[env] silent save failed', err)
        } else {
          toast.error(err instanceof Error ? err.message : translate('chatInspector.t8'))
        }
        return false
      } finally {
        if (!options?.silent) setSavingRuntime(false)
      }
    },
    [loadRuntimeConfig, updateEnvConfig, toast],
  )

  const copyEnvJson = useCallback(
    async (scope: 'project' | 'session', vars: EnvVarItem[]) => {
      try {
        const json = serializeEnvVarsJson(vars)
        await navigator.clipboard.writeText(json)
        const count = parseEnvVarsJson(json).length
        toast.success(
          translate('chatInspector.tpl29Desc', {
            count,
            scope:
              scope === 'project' ? translate('chatInspector.t5') : translate('chatInspector.t6'),
          }),
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('chatInspector.t9'))
      }
    },
    [toast],
  )

  const pasteEnvJson = useCallback(
    async (
      scope: 'project' | 'session',
      scopeRef: string,
      setVars: React.Dispatch<React.SetStateAction<EnvVarItem[]>>,
    ) => {
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
      const saved = await saveEnvLayer(scope, scopeRef, imported, {
        successMessage: translate('chatInspector.tpl30Desc', {
          count: imported.length,
          scope: scopeLabel,
        }),
      })
      if (saved) setVars(imported)
    },
    [saveEnvLayer, toast],
  )

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('inspector-resizing')
  }

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current == null) return
    const delta = dragRef.current.startX - event.clientX
    onWidthChange(clamp(dragRef.current.startWidth + delta, 300, 620))
  }

  const handleResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('inspector-resizing')
  }

  const renderEnvBlock = (
    label: string,
    placeholder: string,
    scope: 'project' | 'session',
    scopeRef: string,
    vars: EnvVarItem[],
    setVars: React.Dispatch<React.SetStateAction<EnvVarItem[]>>,
  ) => {
    const updateVar = (index: number, patch: Partial<EnvVarItem>) =>
      setVars((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
    // 删除后立即静默保存：避免删除完没点「保存」就切走会话导致删除丢失。
    // 注意：先在 updater 外计算 next 并发起保存，不要把副作用塞进 setVars updater
    // —— 项目启用了 React.StrictMode，dev 模式下 updater 会被调用两次，会导致重复 IPC 写入。
    const removeVar = (index: number) => {
      const next = vars.filter((_, i) => i !== index)
      setVars(next)
      void saveEnvLayer(scope, scopeRef, next, { silent: true })
    }
    const addVar = () => setVars((prev) => [...prev, { key: '', value: '', description: '' }])
    // 失焦自动保存：用户填完变量只要焦点离开输入框（包括去点别的会话）就落盘，
    // 解决「填了没点保存就切会话 → 草稿被覆盖丢失」的问题。vars 取自当前渲染闭包，
    // onChange 触发重渲染后 onBlur 用的就是最新闭包，能拿到刚输入的值。
    const persistOnBlur = () => {
      void saveEnvLayer(scope, scopeRef, vars, { silent: true })
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
          {scope === 'project'
            ? translate('chatInspector.t13')
            : translate('chatInspector.t14Desc')}
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
              disabled={savingRuntime}
              title={translate('chatInspector.tpl21Desc', { label })}
              onClick={() => void pasteEnvJson(scope, scopeRef, setVars)}
            >
              <Icons.Clipboard size={12} />
            </button>
            <button
              type="button"
              className="btn ghost sm runtime-save-btn"
              disabled={savingRuntime}
              onClick={() => void saveEnvLayer(scope, scopeRef, vars)}
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

  return (
    <div
      className={
        embedded
          ? 'inspector-frame embedded config-panel-frame session-panel'
          : 'inspector-frame config-panel-frame session-panel'
      }
      style={{ '--inspector-width': `${width}px` } as React.CSSProperties}
    >
      {!embedded && (
        <div
          className="inspector-resize-handle"
          title={translate('chatInspector.t47')}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />
      )}
      <div className="inspector scroll">
        <header className="session-panel-heading">
          <strong>{translate('chatInspector.t63')}</strong>
          <span>{translate('chatInspector.t64Desc')}</span>
        </header>
        {/* 环境变量 */}
        {hasChatConfigScope(sessionId, workspaceId) && envConfig != null && (
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
                {workspaceId != null &&
                  renderEnvBlock(
                    translate('chatInspector.t17'),
                    translate('chatInspector.t18Desc'),
                    'project',
                    workspaceId,
                    projectEnvDraft,
                    setProjectEnvDraft,
                  )}
                {sessionId != null &&
                  renderEnvBlock(
                    translate('chatInspector.t19'),
                    translate('chatInspector.t20Desc'),
                    'session',
                    sessionId,
                    sessionEnvDraft,
                    setSessionEnvDraft,
                  )}
              </>
            )}
          </div>
        )}

        {/* 提示词 */}
        {hasChatConfigScope(sessionId, workspaceId) && promptConfig != null && (
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
                {workspaceId != null && (
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
                      disabled={savingRuntime}
                      onClick={() =>
                        void savePromptLayer('project', workspaceId, projectPromptDraft)
                      }
                    >
                      <Save size={12} />
                      {translate('chatInspector.t15')}
                    </button>
                  </div>
                )}
                {sessionId != null && (
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
                      disabled={savingRuntime}
                      onClick={() => void savePromptLayer('session', sessionId, sessionPromptDraft)}
                    >
                      <Save size={12} />
                      {translate('chatInspector.t16')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 项目 Agent：项目内新会话默认绑定 + 聊天选择器白名单 */}
        {workspaceId != null && workspace != null && (
          <div className="inspector-section">
            <h4 className="config-panel-header">
              <button
                type="button"
                className="session-panel-toggle"
                aria-expanded={!agentScopeCollapsed}
                onClick={() => setAgentScopeCollapsed(!agentScopeCollapsed)}
              >
                <Icons.Bot size={11} />
                {translate('chatInspector.t66')}
                <span className="spacer" />
                <Icons.ChevronRight
                  size={10}
                  className={`chev ${agentScopeCollapsed ? '' : 'chev-open'}`}
                />
              </button>
            </h4>
            {!agentScopeCollapsed && workspaceId != null && (
              <ProjectAgentScopeSection
                workspaceId={workspaceId}
                agents={allAgents}
                defaultAgentId={workspace?.defaultAgentId}
                allowedAgentIds={workspace?.allowedAgentIds}
              />
            )}
          </div>
        )}

        {/* Hooks：当前会话最终生效列表（§15.3），允许会话临时停用继承 Hook */}
        {sessionId != null && (
          <div className="inspector-section">
            <h4 className="config-panel-header">
              <button
                type="button"
                className="session-panel-toggle"
                aria-expanded={!hooksCollapsed}
                onClick={() => setHooksCollapsed(!hooksCollapsed)}
              >
                <Icons.Zap size={11} />
                Hooks
                <span className="spacer" />
                <Icons.ChevronRight
                  size={10}
                  className={`chev ${hooksCollapsed ? '' : 'chev-open'}`}
                />
              </button>
            </h4>
            {!hooksCollapsed && <SessionHooksSection sessionId={sessionId} />}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 会话累计用量 —— 取自 usage_ledger（唯一权威来源）。
 *
 * 不能用事件流累加代替：ChatView 的历史是按轮次窗口化加载的（默认只取最近 6 轮），
 * 从窗口内 usage_update 累加出来的成本对长会话会严重低估，且向上翻页也不会补算。
 * usage_ledger 由 SessionService.recordUsageUpdate 按 turn 做 delta 记账，覆盖全部轮次。
 */
function useSessionLedgerUsage(
  sessionId: string | undefined,
  refreshKey: number,
): UsageGetSessionResponse['summary'] | null {
  const { invoke: getSessionUsage } = useIpcInvoke('usage:get-session')
  const [summary, setSummary] = useState<UsageGetSessionResponse['summary'] | null>(null)

  useEffect(() => {
    if (sessionId == null) {
      setSummary(null)
      return
    }
    let cancelled = false
    getSessionUsage({ sessionId })
      .then((res) => {
        if (!cancelled) setSummary(res.summary)
      })
      .catch((err) => {
        // 取不到累计用量不该影响面板其余部分；退回 null 由调用方回落到本轮数据
        console.warn('Failed to load session usage summary', err)
        if (!cancelled) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [getSessionUsage, sessionId, refreshKey])

  return summary
}

export function ChatInspector({
  session,
  workspace,
  messages,
  usageData,
  projectContext,
  contextUsage,
  contextLedger,
  contextInputTokens,
  runtimeContext,
  providerId,
  providerContextWindow,
  hideContextBudget = false,
  turnPromptSnapshots,
  width,
  onWidthChange,
  teamConfig,
  agents,
  runningTeamAgentIds,
  onChangeTeamConfig,
  onOpenProjectFolder,
  checkpointAvailable,
  checkpointEnabled,
  onOpenCheckpointTimeline,
  onFilePreview,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  messages: UIMessage[]
  usageData: SessionUsageData
  projectContext: ProjectContextState | null
  contextUsage: ContextUsageState | null
  contextLedger: ContextLedgerState | null
  contextInputTokens: number
  runtimeContext: RuntimeContextSnapshotState | null
  /** 当前 Provider 的引擎标识（'claude' / 'codex' / 自定义串），决定上下文占用口径 */
  providerId?: string | undefined
  providerContextWindow: number
  /** 智能路由首轮分流完成前置位：窗口/用量尚为兜底与估算错值，隐藏上下文预算区块 */
  hideContextBudget?: boolean
  turnPromptSnapshots: TurnPromptSnapshotEvent[]
  width: number
  onWidthChange: (width: number) => void
  teamConfig: TeamModeConfig
  agents: ManagedAgent[]
  runningTeamAgentIds: string[]
  onChangeTeamConfig: (patch: Partial<TeamModeConfig>) => void
  onOpenProjectFolder: () => void
  checkpointAvailable: boolean
  checkpointEnabled: boolean
  onOpenCheckpointTimeline: () => void
  /** 统一文件打开路由（ChatView handleFilePreview）：检查器内产物/附件点击预览 */
  onFilePreview?: FileOpenHandler
}) {
  const showTeamActivityLogs = useTeamActivityLogsVisible()
  const subagents = extractInspectorSubagents(messages)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const projectContextSources = projectContext?.sources ?? []
  // 每来一条 usage_update 就重取一次累计值，保证面板打开期间跟着当前轮实时长
  const ledgerUsage = useSessionLedgerUsage(session?.id, usageData.turns.length)
  // 轮次用量图表：一轮一行、剔除全程无用量轮次，只展示有用量的最近 20 轮
  const turnUsage = useMemo(() => buildTurnUsageRows(usageData.turns), [usageData.turns])
  const matchingRuntimeContext = resolveMatchingRuntimeContextSnapshot(
    runtimeContext,
    session?.agentAdapter,
    session?.modelId,
  )

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('inspector-resizing')
  }

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current == null) return
    const delta = dragRef.current.startX - event.clientX
    onWidthChange(clamp(dragRef.current.startWidth + delta, 300, 620))
  }

  const handleResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('inspector-resizing')
  }

  const currentContextTokens = resolveContextUsedTokens({
    provider: providerId,
    ledgerEstimatedTokens: contextLedger?.totalEstimatedTokens,
    turnEstimatedTokens: contextUsage?.estimatedTokens,
    providerInputTokens: contextInputTokens,
    runtimeContextTokens: matchingRuntimeContext?.usedTokens,
  })
  // 窗口大小由 Provider 显式配置决定；历史 context_usage 里可能还带旧的模型名推断值。
  // Codex app-server 有运行时实测窗口时优先使用；Claude 与无快照路径保持 Provider 配置。
  const contextWindow = resolveDisplayedContextWindow(providerContextWindow, matchingRuntimeContext)
  // 「X% 已用」始终按硬窗口显示，对齐弹窗顶部「X% 已用 / 200K」。
  const contextRatio =
    contextWindow > 0
      ? Math.min(100, Math.round((currentContextTokens / contextWindow) * 1000) / 10)
      : 0
  // Codex Runtime 快照不包含实际压缩阈值，只按硬窗口表达一般压力；非 Runtime
  // 估算路径继续沿用现有软线。二者都不能当作“压缩已经/即将发生”的运行时事件。
  const softLimitTokens = contextLedger?.softLimitTokens ?? contextUsage?.softLimitTokens ?? 0
  const softLimit = softLimitTokens > 0 ? softLimitTokens : Math.floor(contextWindow * 0.7)
  const softUsedRatio = softLimit > 0 ? currentContextTokens / softLimit : 0
  const hardUsedRatio = contextWindow > 0 ? currentContextTokens / contextWindow : 0
  const pressureRatio = matchingRuntimeContext != null ? hardUsedRatio : softUsedRatio
  const isContextWarning = pressureRatio >= 0.8
  const isContextCritical =
    matchingRuntimeContext != null ? pressureRatio >= 0.95 : pressureRatio >= 1

  return (
    <div
      className="inspector-frame session-panel"
      style={{ '--inspector-width': `${width}px` } as React.CSSProperties}
    >
      <div
        className="inspector-resize-handle"
        title={translate('chatInspector.t47')}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />
      <div className="inspector scroll">
        <header className="session-panel-heading">
          <strong>{translate('chatInspector.t72')}</strong>
          <span>{translate('chatInspector.t73Desc')}</span>
        </header>
        {teamConfig.enabled && (
          <>
            <div className="inspector-section team-log-visibility-section">
              <h4>
                <span>{translate('chatInspector.t74')}</span>
                <Switch
                  size="small"
                  checked={showTeamActivityLogs}
                  onChange={setTeamActivityLogsVisible}
                  aria-label={translate('chatInspector.t54Desc')}
                />
              </h4>
            </div>

            <TeamInspectorSection
              config={teamConfig}
              fallbackProviderProfileId={session?.providerProfileId ?? null}
              fallbackModelId={session?.modelId ?? null}
              agents={agents.map((a) => ({
                id: a.id,
                name: a.name,
                description: a.description,
                builtIn: a.builtIn,
                providerProfileId: a.providerProfileId ?? null,
                modelId: a.modelId ?? null,
                agentAdapter: a.agentAdapter,
                skillCount: a.skillIds.length,
                mcpCount: a.mcpServerIds.length,
                metadata: a.metadata,
              }))}
              runningAgentIds={runningTeamAgentIds}
              onToggleMember={(agentId, enabled) =>
                onChangeTeamConfig({
                  memberAgentIds: enabled
                    ? [...teamConfig.memberAgentIds, agentId]
                    : teamConfig.memberAgentIds.filter((id) => id !== agentId),
                })
              }
              onChangeConfig={onChangeTeamConfig}
            />
            <OutcomeRoomContainer
              sessionId={session?.id}
              runningMemberCount={runningTeamAgentIds.length}
            />
          </>
        )}
        <div className="inspector-section">
          <h4>{translate('chatInspector.t75')}</h4>
          {session ? (
            <>
              <div className="kv-row">
                <span className="k">{translate('chatInspector.t76')}</span>
                <span className="v">{session.messageCount}</span>
              </div>
              {workspace && (
                <div className="kv-row">
                  <span className="k">{translate('chatInspector.t77')}</span>
                  <span className="v mono-sm truncate inspector-path" title={workspace.rootPath}>
                    {workspace.rootPath}
                  </span>
                </div>
              )}
              {workspace && (
                <button
                  className="btn ghost sm inspector-open-folder-btn"
                  onClick={onOpenProjectFolder}
                >
                  <Icons.Folder size={12} />
                  <span>{translate('chatInspector.t78')}</span>
                </button>
              )}
              <div className="kv-row">
                <span className="k">{translate('chatInspector.t79')}</span>
                <span className="v">{new Date(session.createdAt).toLocaleString()}</span>
              </div>
              <div className="kv-row">
                <span className="k">{translate('chatInspector.t80')}</span>
                <span className="v">{new Date(session.updatedAt).toLocaleString()}</span>
              </div>
            </>
          ) : (
            <div className="inspector-muted">{translate('chatInspector.t81')}</div>
          )}
        </div>

        {/* Token Usage Section */}
        <div className="inspector-section">
          <h4>{translate('chatInspector.t82')}</h4>
          <TokenUsagePanel
            inputTokens={usageData.inputTokens}
            outputTokens={usageData.outputTokens}
            reasoningOutputTokens={usageData.reasoningOutputTokens}
            totalTokens={
              usageData.inputTokens + usageData.outputTokens + usageData.reasoningOutputTokens
            }
            cacheHitTokens={usageData.cacheHitTokens}
            cacheHitRate={usageData.cacheHitRate}
            cacheWriteTokens={usageData.cacheWriteTokens}
            sessionTotal={ledgerUsage}
          />
        </div>

        {/* 性能区块 — 吞吐 / TTFT / 轮次时长；从事件回放派生（含 live 更新） */}
        <ChatInspectorPerf
          snapshots={turnPromptSnapshots}
          isSessionRunning={session?.status === 'running'}
        />

        {/* 工具执行审计日志：账本时间线 + 哈希链完整性（tool-audit:* IPC）。
            固定在性能之后、上下文窗口之前（执行观测区聚在一起）。 */}
        {session != null && <ChatInspectorToolLog sessionId={session.id} />}

        {/* 会话经历：技能与 MCP / 网页查阅 / 过程产物 / 输入来源四个同级折叠区块
            （session:get-journey IPC，一次聚合共享）。紧跟工具执行区块（同属执行
            观测区），有数据的分组才出现。产物/附件点击走统一预览路由。 */}
        {session != null && (
          <ChatInspectorJourney sessionId={session.id} onFilePreview={onFilePreview} />
        )}

        {subagents.length > 0 && (
          <div className="inspector-section">
            <h4>
              {translate('chatInspector.t83')}
              <span className="inspector-count">{subagents.length}</span>
            </h4>
            <div className="runtime-skill-list">
              {subagents.map((sa, idx) => (
                <div
                  className={`runtime-skill-row${sa.status === 'running' ? ' running' : ''}`}
                  key={`${sa.toolCallId}-${idx}`}
                  title={sa.output ? translate('chatInspector.t21') : undefined}
                  style={sa.output ? { cursor: 'pointer' } : undefined}
                >
                  <div className="runtime-skill-main min-w-0">
                    <div className="runtime-skill-name truncate">
                      {sa.status === 'running' || sa.status === 'paused' ? (
                        <Icons.Spinner size={10} className="thinking-spinner" />
                      ) : sa.status === 'done' ? (
                        <Icons.Check size={10} style={{ color: 'var(--c-ok, #22c55e)' }} />
                      ) : (
                        <Icons.AlertTriangle size={10} style={{ color: 'var(--warning)' }} />
                      )}{' '}
                      {sa.name}
                    </div>
                    <div className="runtime-skill-desc truncate">{sa.task || sa.role || '-'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Context Window Section — 仅在已知上下文窗口大小时展示；
            智能路由首轮分流完成前窗口/用量是兜底错值，随参数栏一起隐藏 */}
        {contextWindow > 0 && !hideContextBudget && (
          <div className="inspector-section">
            <h4>
              {translate('chatInspector.tpl5Desc')}
              {isContextCritical && (
                <span className="badge danger dot usage-warning-badge">
                  {translate('chatInspector.t84')}
                </span>
              )}
              {!isContextCritical && isContextWarning && (
                <span className="badge warning dot usage-warning-badge">
                  {translate('chatInspector.t85')}
                </span>
              )}
            </h4>
            <ContextWindowVisualization
              usedTokens={currentContextTokens}
              totalTokens={contextWindow}
              ratio={contextRatio}
              isWarning={isContextWarning}
              isCritical={isContextCritical}
              runtimeMeasured={matchingRuntimeContext != null}
            />
          </div>
        )}

        {/* Per-Turn Token Chart — 一轮一行，只展示有用量的最近 20 轮 */}
        {turnUsage.rows.length > 0 && (
          <div className="inspector-section">
            <h4>
              {translate('chatInspector.t86')}
              <span className="inspector-count">
                {translate('chatInspector.tpl6Desc', { count: turnUsage.totalTurns })}
              </span>
            </h4>
            <TurnUsageChart rows={turnUsage.rows} />
          </div>
        )}

        {/* 工程信息统一置底，并保持各自独立、默认折叠。 */}
        {SHOW_WORKTREE_INSPECTOR_SECTION && workspace && (
          <WorktreePanel workspaceId={workspace.id} sessionId={session?.id ?? null} />
        )}

        {session != null && projectContext != null && (
          <InspectorCollapsibleSection
            title={translate('chatInspector.t55')}
            summary={<span className="inspector-count">{projectContextSources.length}</span>}
          >
            <div className="kv-row">
              <span className="k">{translate('chatInspector.t87')}</span>
              <span className="v">{projectContext.counts.rules}</span>
            </div>
            <div className="kv-row">
              <span className="k">Skills</span>
              <span className="v">{projectContext.counts.skills}</span>
            </div>
            <div className="kv-row">
              <span className="k">Agents</span>
              <span className="v">{projectContext.counts.agents}</span>
            </div>
            {projectContext.budget != null && (
              <>
                <div className="kv-row">
                  <span className="k">{translate('chatInspector.t88')}</span>
                  <span className="v">{projectContext.budget.mode}</span>
                </div>
                <div className="kv-row">
                  <span className="k">{translate('chatInspector.t89')}</span>
                  <span className="v">
                    {formatTokenCount(projectContext.budget.usedTokens)} /{' '}
                    {formatTokenCount(projectContext.budget.budgetTokens)}
                  </span>
                </div>
              </>
            )}
            {projectContextSources.length > 0 ? (
              <div className="runtime-skill-list">
                {projectContextSources.map((source) => (
                  <div
                    className={`runtime-skill-row ${source.included === false ? 'disabled' : ''}`}
                    key={`${source.kind}:${source.path}`}
                  >
                    <div className="runtime-skill-main min-w-0">
                      <div className="runtime-skill-name truncate">{source.name}</div>
                      <div className="runtime-skill-desc truncate">
                        {source.kind} · {source.path}
                        {source.estimatedTokens != null
                          ? ` · ${formatTokenCount(source.estimatedTokens)}`
                          : ''}
                        {source.included === false ? ' · excluded' : ''}
                        {source.truncated ? ' · truncated' : ''}
                        {source.reason != null ? ` · ${source.reason}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="inspector-muted">{translate('chatInspector.t90Desc')}</div>
            )}
          </InspectorCollapsibleSection>
        )}

        {SHOW_WORKSPACE_SNAPSHOT_INSPECTOR_SECTION && checkpointAvailable && (
          <InspectorCollapsibleSection
            title={translate('chatInspector.t56')}
            summary={
              checkpointEnabled ? (
                <span className="badge success dot">{translate('chatInspector.t91')}</span>
              ) : undefined
            }
          >
            <div className="checkpoint-card">
              <p className="checkpoint-desc">
                {checkpointEnabled
                  ? translate('chatInspector.tpl7Desc')
                  : translate('chatInspector.t23Desc')}
              </p>
              <button
                type="button"
                className="btn primary sm checkpoint-open-btn"
                onClick={onOpenCheckpointTimeline}
              >
                {translate('chatInspector.t92')}
              </button>
            </div>
          </InspectorCollapsibleSection>
        )}

        {/* 白盒提示词面板 — 展示每轮 SDK 调用的全量提示词快照 */}
        {turnPromptSnapshots.length > 0 && (
          <PromptInspectorSection snapshots={turnPromptSnapshots} />
        )}
      </div>
    </div>
  )
}

// ─── 白盒提示词检查器组件 ──────────────────────────────────────────────────────

/** 相对时间格式化 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return translate('chatInspector.t24')
  if (diff < 3_600_000)
    return translate('chatInspector.tpl8Desc', { value: Math.floor(diff / 60_000) })
  if (diff < 86_400_000)
    return translate('chatInspector.tpl9Desc', { value: Math.floor(diff / 3_600_000) })
  return translate('chatInspector.tpl10Desc', { value: Math.floor(diff / 86_400_000) })
}

/** 截断文本 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}

const TELEMETRY_LS_KEY = 'spark-settings-telemetry'

/**
 * 运行时日志开关：与「设置 → 本地日志」共用 telemetry.data.runtimeLogEnabled。
 * 双层持久化（localStorage + IPC）保持两处入口同步；默认关闭以节省存储。
 */
function useRuntimeLogEnabled(): {
  enabled: boolean
  toggle: (v: boolean) => Promise<void>
} {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(TELEMETRY_LS_KEY)
      if (!raw) return false
      return (JSON.parse(raw) as { runtimeLogEnabled?: unknown }).runtimeLogEnabled === true
    } catch {
      return false
    }
  })
  const { invoke: getSetting } = useIpcInvoke('settings:get')
  const { invoke: setSetting } = useIpcInvoke('settings:set')
  const { toast } = useToast()

  // mount 时以 IPC 为权威源校正（localStorage 可能滞后于其它入口的写入）
  useEffect(() => {
    getSetting({ category: 'telemetry', key: 'data' })
      .then((res) => {
        const val = res.value as { runtimeLogEnabled?: unknown } | null
        setEnabled(val?.runtimeLogEnabled === true)
      })
      .catch(() => undefined)
  }, [getSetting])

  const toggle = useCallback(
    async (v: boolean) => {
      const prev = enabled
      setEnabled(v)
      try {
        const res = await getSetting({ category: 'telemetry', key: 'data' })
        const current = (res.value ?? {}) as Record<string, unknown>
        const next = { ...current, runtimeLogEnabled: v }
        window.localStorage.setItem(TELEMETRY_LS_KEY, JSON.stringify(next))
        await setSetting({ category: 'telemetry', key: 'data', value: next })
      } catch (err) {
        setEnabled(prev)
        toast.error(err instanceof Error ? err.message : translate('chatInspector.t25'))
      }
    },
    [enabled, getSetting, setSetting, toast],
  )

  return { enabled, toggle }
}

/** PromptInspectorSection — 白盒提示词、运行时日志检查器 */
function PromptInspectorSection({ snapshots }: { snapshots: TurnPromptSnapshotEvent[] }) {
  const { enabled: runtimeLogEnabled, toggle: setRuntimeLogEnabled } = useRuntimeLogEnabled()
  return (
    <InspectorCollapsibleSection
      title={translate('chatInspector.t57')}
      summary={
        <span className="inspector-count">
          {translate('chatInspector.tpl6Desc', { count: snapshots.length })}
        </span>
      }
      headerAction={
        <Switch
          size="small"
          checked={runtimeLogEnabled}
          onChange={(v) => void setRuntimeLogEnabled(v)}
          aria-label={translate('chatInspector.t58')}
        />
      }
    >
      {!runtimeLogEnabled && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            padding: '8px 4px',
            lineHeight: 1.5,
          }}
        >
          {translate('chatInspector.t93Desc')}
        </div>
      )}
      <div className="prompt-snapshot-list">
        {[...snapshots].reverse().map((snapshot, idx) => (
          <TurnPromptRow
            key={snapshot.turnId}
            snapshot={snapshot}
            turnNumber={snapshots.length - idx}
            showPromptText={runtimeLogEnabled}
          />
        ))}
      </div>
    </InspectorCollapsibleSection>
  )
}

/** 单个 Turn 的提示词快照行，支持展开/折叠 */
const TurnPromptRow = React.memo(function TurnPromptRow({
  snapshot,
  turnNumber,
  showPromptText,
}: {
  snapshot: TurnPromptSnapshotEvent
  turnNumber: number
  showPromptText: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const visibleUserMessage = showPromptText ? getVisibleTurnPromptSnapshotUserMessage(snapshot) : ''
  const userPreview = useMemo(() => truncateText(visibleUserMessage, 80), [visibleUserMessage])
  const totalPromptChars = useMemo(
    () => snapshot.systemPromptSections.reduce((sum, s) => sum + s.charCount, 0),
    [snapshot.systemPromptSections],
  )
  // token 口径优先（字符数视觉偏大）；旧快照缺 estimatedTokens 时回退字符数
  const totalPromptTokens = useMemo(
    () => snapshot.systemPromptSections.reduce((sum, s) => sum + (s.estimatedTokens ?? 0), 0),
    [snapshot.systemPromptSections],
  )
  const modelLabel =
    snapshot.providerProfileId === LOCAL_CODEX_CLI_PROVIDER_ID
      ? LOCAL_CODEX_CLI_MODEL_DISPLAY
      : snapshot.providerProfileId === LOCAL_CLI_PROVIDER_ID
        ? LOCAL_CLI_MODEL_DISPLAY
        : snapshot.model
  const formatCharCount = (n: number): string => {
    if (n >= 10_000) return `${Math.round(n / 1000)}K`
    return `${n}`
  }
  const promptSummary =
    snapshot.runtimeMetrics?.sparkPromptEstimatedTokens != null
      ? `Spark Prompt ≈ ${formatTokenCount(snapshot.runtimeMetrics.sparkPromptEstimatedTokens)} tokens`
      : totalPromptTokens > 0
        ? translate('chatInspector.tpl23Desc', {
            sections: snapshot.systemPromptSections.length,
            tokens: formatTokenCount(totalPromptTokens),
          })
        : translate('chatInspector.tpl11Desc', {
            sections: snapshot.systemPromptSections.length,
            chars: formatCharCount(totalPromptChars),
          })

  return (
    <div className={`prompt-turn-row ${expanded ? 'expanded' : ''}`}>
      <div
        className="prompt-turn-header"
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((prev) => !prev)
          }
        }}
      >
        <span className={`prompt-turn-chevron ${expanded ? 'open' : ''}`}>
          {expanded ? '▾' : '▸'}
        </span>
        <span className="prompt-turn-title">
          Turn {turnNumber} · {modelLabel}
        </span>
        <span className="prompt-turn-time">{relativeTime(snapshot.timestamp)}</span>
      </div>
      <div className="prompt-turn-summary">
        <span className="prompt-turn-user" title={visibleUserMessage || undefined}>
          {userPreview || translate('chatInspector.t26')}
        </span>
        <span className="prompt-turn-meta">{promptSummary}</span>
      </div>
      {expanded && (
        <div className="prompt-turn-detail">
          {/* Adapter 信息 */}
          <div className="prompt-turn-config">
            <span className="prompt-config-tag">{snapshot.adapterKind}</span>
            <span className="prompt-config-tag">{snapshot.permissionMode}</span>
            {snapshot.sdkPreset && (
              <span className="prompt-config-tag sdk">SDK: {snapshot.sdkPreset}</span>
            )}
            <span className="prompt-config-tag">Tools: {snapshot.toolCount}</span>
          </div>

          <TurnRuntimeMetricsBlock metrics={snapshot.runtimeMetrics} />

          {showPromptText && (
            <>
              {/* 用户消息 */}
              <div className="prompt-section-block">
                <div className="prompt-section-label">{translate('chatInspector.t94')}</div>
                <pre className="prompt-section-content">{visibleUserMessage}</pre>
              </div>

              {/* 系统提示词各段落 */}
              {snapshot.systemPromptSections.map((section, sIdx) => (
                <PromptSectionBlock key={sIdx} section={section} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
})

function TurnRuntimeMetricsBlock({ metrics }: { metrics: TurnRuntimeMetrics | undefined }) {
  const rows: Array<{ label: string; value: string }> = []
  const addTokens = (label: string, value: number | undefined): void => {
    if (value != null) rows.push({ label, value: `${formatTokenCount(value)} tokens` })
  }
  const addDuration = (label: string, value: number | undefined): void => {
    if (value != null) rows.push({ label, value: `${value.toLocaleString()} ms` })
  }

  addTokens(translate('chatInspector.t27Desc'), metrics?.sparkPromptEstimatedTokens)
  addTokens(translate('chatInspector.t28'), metrics?.providerInputTokens)
  addTokens(translate('chatInspector.t29'), metrics?.cacheReadTokens)
  addTokens(translate('chatInspector.t30'), metrics?.cacheWriteTokens)
  addDuration(translate('chatInspector.t31'), metrics?.mcpConfigurationMs)
  addDuration(translate('chatInspector.t32Desc'), metrics?.requestToMcpReadyMs)
  addDuration(translate('chatInspector.t33'), metrics?.requestToFirstOutputMs)
  if (metrics?.mcpServerCount != null) {
    rows.push({ label: 'MCP servers', value: String(metrics.mcpServerCount) })
  }
  if (metrics?.availableToolCount != null) {
    rows.push({ label: translate('chatInspector.t34'), value: String(metrics.availableToolCount) })
  }

  const declared = metrics?.toolSchemas?.declared
  if (declared != null) {
    const coverageLabel =
      declared.coverage === 'complete'
        ? translate('chatInspector.t35')
        : declared.coverage === 'partial'
          ? translate('chatInspector.t36')
          : translate('chatInspector.t37')
    const measuredParts = [
      `${coverageLabel} · ${declared.measuredServerCount}/${declared.serverCount} servers`,
    ]
    if (declared.toolCount != null) measuredParts.push(`${declared.toolCount} tools`)
    if (declared.estimatedTokens != null) {
      measuredParts.push(`≈ ${formatTokenCount(declared.estimatedTokens)} tokens`)
    }
    rows.push({ label: translate('chatInspector.t38'), value: measuredParts.join(' · ') })
  }
  if (metrics?.toolSchemas != null) {
    rows.push({
      label: translate('chatInspector.t39Desc'),
      value:
        metrics.toolSchemas.deferred == null && metrics.toolSchemas.loaded == null
          ? translate('chatInspector.t40Desc')
          : translate('chatInspector.t41Desc'),
    })
  }

  return (
    <div className="prompt-runtime-metrics">
      <div className="prompt-runtime-metrics-title">{translate('chatInspector.t95')}</div>
      {rows.length > 0 ? (
        <dl>
          {rows.map((row) => (
            <React.Fragment key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : (
        <div className="prompt-runtime-metrics-empty">{translate('chatInspector.t96')}</div>
      )}
    </div>
  )
}

/** 单个提示词段落的展示，支持独立折叠 */
const PromptSectionBlock = React.memo(function PromptSectionBlock({
  section,
}: {
  section: { label: string; content: string; charCount: number; estimatedTokens?: number }
}) {
  const [sectionExpanded, setSectionExpanded] = useState(false)
  const isPlaceholder = section.charCount === 0

  return (
    <div className={`prompt-section-block ${isPlaceholder ? 'placeholder' : ''}`}>
      <div
        className="prompt-section-label clickable"
        onClick={() => {
          if (!isPlaceholder) setSectionExpanded((prev) => !prev)
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!isPlaceholder) setSectionExpanded((prev) => !prev)
          }
        }}
      >
        <span className={`prompt-section-chevron ${sectionExpanded ? 'open' : ''}`}>
          {!isPlaceholder ? (sectionExpanded ? '▾' : '▸') : '○'}
        </span>
        <span>{section.label}</span>
        {section.estimatedTokens != null && section.estimatedTokens > 0 ? (
          <span className="prompt-section-chars">
            {translate('chatInspector.tpl22Desc', {
              count: formatTokenCount(section.estimatedTokens),
            })}
          </span>
        ) : (
          section.charCount > 0 && (
            <span className="prompt-section-chars">
              {translate('chatInspector.tpl12Desc', { count: section.charCount })}
            </span>
          )
        )}
      </div>
      {sectionExpanded && !isPlaceholder && (
        <pre className="prompt-section-content">{section.content}</pre>
      )}
      {isPlaceholder && <div className="prompt-section-placeholder">{section.content}</div>}
    </div>
  )
})

/**
 * TaskListItem — 单个任务的渲染单元。
 * 文本超出 2 行时显示省略号;当内容被截断或带 description 时,
 * 鼠标悬浮展示 Popover,呈现 subject(标题)+ description(内容)。
 */
function TaskListItem({ task }: { task: InspectorTask }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    const check = () => setIsTruncated(el.scrollHeight - el.clientHeight > 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [task.subject, task.activeForm, task.description])

  const statusClass =
    task.status === 'completed' ? 'done' : task.status === 'in_progress' ? 'running' : ''
  const primaryText =
    task.status === 'in_progress' ? (task.activeForm ?? task.subject) : task.subject
  const needsPopover = isTruncated || Boolean(task.description)

  const item = (
    <div className={`inspector-plan-item ${statusClass}`}>
      <span className="inspector-plan-dot-wrap">
        {task.status === 'completed' ? (
          <CheckCircle size={15} className="inspector-plan-done-icon" />
        ) : (
          <span className="inspector-plan-dot">
            {task.status === 'in_progress' && <Icons.Spinner size={10} />}
          </span>
        )}
      </span>
      <span className="text" ref={textRef}>
        <span className="mono-sm" style={{ marginRight: 4, color: 'var(--text-muted)' }}>
          {task.id}
        </span>
        {primaryText}
      </span>
    </div>
  )

  if (!needsPopover) return item

  return (
    <Popover
      content={
        <div className="inspector-plan-item-popover">
          <div className="inspector-plan-item-popover-title">{task.subject}</div>
          {task.description && (
            <div className="inspector-plan-item-popover-desc">{task.description}</div>
          )}
        </div>
      }
    >
      {item}
    </Popover>
  )
}

/* ── Token Usage Visualization Components ── */

/**
 * Token 用量面板。
 *
 * 刻意区分两种口径——之前把两者混在同一张卡片里，「输入/输出/总计」是最后一轮的值，
 * 「预估成本」却是累计值，同一块区域两种语义且没有任何标注：
 *   - 本轮：来自实时 usage_update 事件，反映当前/最近一轮
 *   - 会话累计：来自 usage_ledger（权威，覆盖全部轮次，不受历史窗口化影响）
 *
 * 注意：不再展示「预估成本」。SDK 的 total_cost_usd 是客户端按 Anthropic 官方牌价
 * 本地估算的，渠道 API 从不返回成本；第三方中转 / 非 Anthropic 模型下与实际计费
 * 完全脱钩，展示即误导，故整行移除（数据层 estimatedCostUsd 仍保留累计，仅不展示）。
 */
function TokenUsagePanel({
  inputTokens,
  outputTokens,
  reasoningOutputTokens,
  totalTokens,
  cacheHitTokens,
  cacheHitRate,
  cacheWriteTokens,
  sessionTotal,
}: {
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  cacheHitTokens: number
  /** 最近一轮缓存命中率（cache_read / 输入总量，provider 口径）；null = 未度量 */
  cacheHitRate: number | null
  cacheWriteTokens: number
  /** 会话累计（usage_ledger）。取不到时回落为仅展示本轮口径。 */
  sessionTotal: UsageGetSessionResponse['summary'] | null
}) {
  const hasUsage = totalTokens > 0
  const sessionTotalTokens =
    sessionTotal == null
      ? 0
      : sessionTotal.totalInputTokens +
        sessionTotal.totalOutputTokens +
        sessionTotal.totalReasoningOutputTokens
  const hasSessionTotal = sessionTotal != null && sessionTotalTokens > 0

  return (
    <div className="token-usage-panel">
      <div className="token-usage-scope">{translate('chatInspector.t97')}</div>
      <div className="token-usage-stats">
        <div className="token-stat">
          <span className="token-stat-label">{translate('chatInspector.t98')}</span>
          <span className="token-stat-value">{formatTokenCount(inputTokens)}</span>
        </div>
        <div className="token-stat">
          <span className="token-stat-label">{translate('chatInspector.t99')}</span>
          <span className="token-stat-value">{formatTokenCount(outputTokens)}</span>
        </div>
        <div className="token-stat token-stat-total">
          <span className="token-stat-label">{translate('chatInspector.t100')}</span>
          <span className="token-stat-value">{formatTokenCount(totalTokens)}</span>
        </div>
      </div>
      {cacheHitTokens > 0 && (
        <div className="token-usage-row">
          <span className="token-row-label">{translate('chatInspector.t101')}</span>
          <span className="token-row-value">{formatTokenCount(cacheHitTokens)}</span>
        </div>
      )}
      {cacheHitRate != null && (
        <div className="token-usage-row">
          <span className="token-row-label">{translate('chatInspector.t102')}</span>
          <span className="token-row-value">{(cacheHitRate * 100).toFixed(1)}%</span>
        </div>
      )}
      {reasoningOutputTokens > 0 && (
        <div className="token-usage-row">
          <span className="token-row-label">{translate('chatInspector.t103')}</span>
          <span className="token-row-value">{formatTokenCount(reasoningOutputTokens)}</span>
        </div>
      )}
      {cacheWriteTokens > 0 && (
        <div className="token-usage-row">
          <span className="token-row-label">{translate('chatInspector.t30')}</span>
          <span className="token-row-value">{formatTokenCount(cacheWriteTokens)}</span>
        </div>
      )}
      {!hasUsage && !hasSessionTotal && (
        <div className="inspector-muted">{translate('chatInspector.t104')}</div>
      )}

      {hasSessionTotal && (
        <>
          <div className="token-usage-scope token-usage-scope-divider">
            {translate('chatInspector.t105')}
          </div>
          <div className="token-usage-row">
            <span className="token-row-label">{translate('chatInspector.t106')}</span>
            <span className="token-row-value">{formatTokenCount(sessionTotalTokens)}</span>
          </div>
        </>
      )}
    </div>
  )
}

function ContextWindowVisualization({
  usedTokens,
  totalTokens,
  ratio,
  isWarning,
  isCritical,
  runtimeMeasured,
}: {
  usedTokens: number
  totalTokens: number
  ratio: number
  isWarning: boolean
  isCritical: boolean
  runtimeMeasured: boolean
}) {
  // Spark 估算路径保留原有占位分布；Codex Runtime 实测只知道请求总输入，不能
  // 伪造 system/tools/history 分类，因此以单一实测段展示。
  const systemPct = 5
  const toolsPct = 10

  const barClass = isCritical
    ? 'context-bar-critical'
    : isWarning
      ? 'context-bar-warning'
      : 'context-bar-ok'

  return (
    <div className="context-window-viz">
      {isCritical && (
        <div className="context-warning-msg context-warning-critical">
          <Icons.AlertTriangle size={11} />
          <span>{translate('chatInspector.tpl13Desc', { ratio })}</span>
        </div>
      )}
      {!isCritical && isWarning && (
        <div className="context-warning-msg context-warning-warn">
          <Icons.AlertTriangle size={11} />
          <span>{translate('chatInspector.tpl14Desc', { ratio })}</span>
        </div>
      )}
      <div className="context-usage-bar">
        <div
          className={`context-usage-fill ${barClass}`}
          style={{ width: `${Math.min(100, ratio)}%` }} /* dynamic */
        >
          {runtimeMeasured ? (
            <div className="context-fill-history" />
          ) : (
            <>
              <div
                className="context-fill-system"
                style={{ width: `${systemPct}%` }} /* dynamic */
              />
              <div className="context-fill-tools" style={{ width: `${toolsPct}%` }} /* dynamic */ />
              <div className="context-fill-history" />
            </>
          )}
        </div>
      </div>
      <div className="context-usage-labels">
        {runtimeMeasured ? (
          <span className="context-label context-label-history">
            {translate('chatInspector.t107')}
          </span>
        ) : (
          <>
            <span className="context-label context-label-system">
              {translate('chatInspector.t108')}
            </span>
            <span className="context-label context-label-tools">
              {translate('chatInspector.t109')}
            </span>
            <span className="context-label context-label-history">
              {translate('chatInspector.t110')}
            </span>
          </>
        )}
        <span className="context-label context-label-remaining">
          {translate('chatInspector.t111')}
        </span>
      </div>
      <div className="context-usage-detail">
        <div className="kv-row">
          <span className="k">{translate('chatInspector.t112')}</span>
          <span className="v">
            {runtimeMeasured ? translate('chatInspector.t42Desc') : translate('chatInspector.t43')}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">{translate('chatInspector.t113')}</span>
          <span className="v">{formatTokenCount(usedTokens)}</span>
        </div>
        <div className="kv-row">
          <span className="k">{translate('chatInspector.t114')}</span>
          <span className="v">{formatTokenCount(totalTokens)}</span>
        </div>
        <div className="kv-row">
          <span className="k">{translate('chatInspector.t115')}</span>
          <span
            className={`v ${isCritical ? 'token-cost-critical' : isWarning ? 'token-cost-warn' : ''}`}
          >
            {ratio}%
          </span>
        </div>
      </div>
    </div>
  )
}

function TurnUsageChart({ rows }: { rows: TurnUsageRow[] }) {
  if (rows.length === 0) return null

  const maxTokens = Math.max(
    ...rows.map(
      (row) =>
        row.snapshot.inputTokens + row.snapshot.outputTokens + row.snapshot.reasoningOutputTokens,
    ),
    1,
  )

  return (
    <div className="turn-usage-chart">
      {rows.map(({ turnNumber, snapshot }) => {
        const total = snapshot.inputTokens + snapshot.outputTokens + snapshot.reasoningOutputTokens
        const inputPct = (snapshot.inputTokens / maxTokens) * 100
        const outputPct = (snapshot.outputTokens / maxTokens) * 100
        const reasoningPct = (snapshot.reasoningOutputTokens / maxTokens) * 100
        return (
          <div
            key={snapshot.turnId}
            className="turn-usage-bar-group"
            title={`${translate('chatInspector.tpl15Desc', { round: turnNumber, input: formatTokenCount(snapshot.inputTokens), output: formatTokenCount(snapshot.outputTokens) })}${translate('chatInspector.tpl16Desc', { value: formatTokenCount(snapshot.reasoningOutputTokens) })}`}
          >
            <span className="turn-usage-index">{turnNumber}</span>
            <div className="turn-usage-bar-track">
              <div
                className="turn-usage-bar-input"
                style={{ width: `${inputPct}%` }} /* dynamic */
              />
              <div
                className="turn-usage-bar-output"
                style={{ width: `${outputPct}%` }} /* dynamic */
              />
              <div
                className="turn-usage-bar-reasoning"
                style={{ width: `${reasoningPct}%` }} /* dynamic */
              />
            </div>
            <span className="turn-usage-total">{formatTokenCount(total)}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 从事件流重建用量数据的实现在 ./ChatViewUtils（buildUsageDataFromEvents，
 * 纯函数便于单测）；此处仅按需消费，口径说明见该函数的 doc 注释。
 */
