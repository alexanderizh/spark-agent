import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle, Save } from 'lucide-react'
import { Popover } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { SkillsPickerModal } from '../../components/SkillsPickerModal'
import { TeamInspectorSection } from '../../components/TeamInspectorSection'
import { WorktreePanel } from '../../components/WorktreePanel'
import { useToast } from '../../components/Toast'
import { useIpcInvoke } from '../../hooks/useIpc'
import { parseSkillManifest } from '../../utils/skills-data'
import { CODING_AGENT_TOOLS } from '../../data/available-tools'
import { renderPlanInline } from '../../ChatInteractions'
import { clamp, formatTokenCount } from './ChatViewUtils'
import {
  extractInspectorFileChanges,
  extractInspectorSubagents,
  isRecord,
  type InspectorTask,
  type SidebarPlan,
} from './ChatInspectorUtils'
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
  SkillConfigGetResponse,
  TeamModeConfig,
  TurnPromptSnapshotEvent,
  WorkspaceInfo,
} from '@spark/protocol'
import { LOCAL_CLI_PROVIDER_ID, LOCAL_CODEX_CLI_PROVIDER_ID } from '@spark/protocol'
import type { SessionSummary } from '../../SessionSidebarContext'
import type {
  ContextLedgerState,
  ContextUsageState,
  ProjectContextState,
  SessionUsageData,
  UsageSnapshot,
} from './ChatUsageTypes'
import type { UIMessage } from '../../services/event-mapper'

const EMPTY_PROMPT_LAYER: PromptConfigGetResponse['system'] = { enabled: false, content: '' }
const EMPTY_ENV_LAYER: EnvConfigGetResponse['project'] = { enabled: true, vars: [] }
const LOCAL_CLI_MODEL_DISPLAY = 'claude cli'
const LOCAL_CODEX_CLI_MODEL_DISPLAY = 'codex cli'

type MarkdownTextComponent = (props: { content: string }) => ReactNode

type EnvVarRowProps = {
  item: EnvVarItem
  onUpdate: (patch: Partial<EnvVarItem>) => void
  onRemove: () => void
  onBlurPersist?: () => void
}

function EnvVarRow({ item, onUpdate, onRemove, onBlurPersist }: EnvVarRowProps) {
  return (
    <div className="runtime-env-row">
      <input
        className="form-input runtime-env-key"
        placeholder="KEY"
        value={item.key}
        onChange={(event) => onUpdate({ key: event.target.value })}
        onBlur={onBlurPersist}
      />
      <input
        className="form-input runtime-env-value"
        placeholder="VALUE"
        value={item.value}
        onChange={(event) => onUpdate({ value: event.target.value })}
        onBlur={onBlurPersist}
      />
      <input
        className="form-input runtime-env-description"
        placeholder="说明（可选）"
        value={item.description ?? ''}
        onChange={(event) => onUpdate({ description: event.target.value })}
        onBlur={onBlurPersist}
      />
      <button
        type="button"
        className="btn ghost sm runtime-env-remove"
        onClick={onRemove}
        title="删除"
      >
        <Icons.Trash size={12} />
      </button>
    </div>
  )
}

function normalizeSkillConfig(value: unknown): SkillConfigGetResponse {
  const config = isRecord(value) ? value : {}
  return {
    skills: asArray<SkillConfigGetResponse['skills'][number]>(config.skills),
    systemSkillIds: asArray<string>(config.systemSkillIds),
    agentSkillIds: asArray<string>(config.agentSkillIds),
    projectSkillIds: asArray<string>(config.projectSkillIds),
    sessionSkillIds: asArray<string>(config.sessionSkillIds),
    agentDisabledSkillIds: asArray<string>(config.agentDisabledSkillIds),
    projectDisabledSkillIds: asArray<string>(config.projectDisabledSkillIds),
    sessionDisabledSkillIds: asArray<string>(config.sessionDisabledSkillIds),
    effectiveSkillIds: asArray<string>(config.effectiveSkillIds),
  }
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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
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
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const { toast } = useToast()
  const [skillsCollapsed, setSkillsCollapsed] = useState(false)
  const [promptsCollapsed, setPromptsCollapsed] = useState(false)
  const [envCollapsed, setEnvCollapsed] = useState(false)
  const [toolsCollapsed, setToolsCollapsed] = useState(false)
  const [skillConfig, setSkillConfig] = useState<SkillConfigGetResponse | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptConfigGetResponse | null>(null)
  const [envConfig, setEnvConfig] = useState<EnvConfigGetResponse | null>(null)
  const [projectPromptDraft, setProjectPromptDraft] = useState('')
  const [sessionPromptDraft, setSessionPromptDraft] = useState('')
  const [projectEnvDraft, setProjectEnvDraft] = useState<EnvVarItem[]>([])
  const [sessionEnvDraft, setSessionEnvDraft] = useState<EnvVarItem[]>([])
  const [savingRuntime, setSavingRuntime] = useState(false)
  // 全量 skills 列表（供 picker 弹窗选择）& picker 可见状态
  const [allSkills, setAllSkills] = useState<SkillConfigGetResponse['skills']>([])
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  // Picker 本地草稿：打开时初始化为空（会话级 picker 用于"新增"），关闭/完成时再提交。
  // 这样列表项的勾选只更新 draft，不会立刻触发 onChange 关闭弹窗。
  const [pickerDraft, setPickerDraft] = useState<string[]>([])
  const { invoke: getSkillConfig } = useIpcInvoke('skill-config:get')
  const { invoke: updateSkillConfig } = useIpcInvoke('skill-config:update')
  const { invoke: getPromptConfig } = useIpcInvoke('prompt-config:get')
  const { invoke: updatePromptConfig } = useIpcInvoke('prompt-config:update')
  const { invoke: getEnvConfig } = useIpcInvoke('env-config:get')
  const { invoke: updateEnvConfig } = useIpcInvoke('env-config:update')
  const { invoke: listAllSkills } = useIpcInvoke('skill:list')
  const sessionId = session?.id as string | undefined
  const workspaceId = workspace?.id

  const loadRuntimeConfig = useCallback(async () => {
    const req = {
      ...(workspaceId != null ? { workspaceId } : {}),
      ...(sessionId != null ? { sessionId } : {}),
      ...(agentId != null ? { agentId } : {}),
    }
    const [skillsRes, promptsRes, envRes] = await Promise.all([
      getSkillConfig(req),
      getPromptConfig(req),
      getEnvConfig(req),
    ])
    const normalizedSkills = normalizeSkillConfig(skillsRes)
    const normalizedPrompts = normalizePromptConfig(promptsRes)
    const normalizedEnv = normalizeEnvConfig(envRes)
    setSkillConfig(normalizedSkills)
    setPromptConfig(normalizedPrompts)
    setEnvConfig(normalizedEnv)
    setProjectPromptDraft(normalizedPrompts.project.content)
    setSessionPromptDraft(normalizedPrompts.session.content)
    setProjectEnvDraft(normalizedEnv.project.vars)
    setSessionEnvDraft(normalizedEnv.session.vars)
  }, [getEnvConfig, getPromptConfig, getSkillConfig, sessionId, workspaceId, agentId])

  // 加载全量 skills 列表（供 picker 使用）
  const loadAllSkills = useCallback(async () => {
    try {
      const res = await listAllSkills({})
      setAllSkills(res.skills ?? [])
    } catch {
      /* non-critical */
    }
  }, [listAllSkills])

  useEffect(() => {
    if (sessionId == null) {
      setSkillConfig(null)
      setPromptConfig(null)
      setEnvConfig(null)
      setProjectPromptDraft('')
      setSessionPromptDraft('')
      setProjectEnvDraft([])
      setSessionEnvDraft([])
      return
    }
    void loadRuntimeConfig()
  }, [loadRuntimeConfig, sessionId])

  // 首次渲染时加载全量 skills
  useEffect(() => {
    void loadAllSkills()
  }, [loadAllSkills])

  const toggleRuntimeSkill = useCallback(
    async (scope: 'project' | 'session', scopeRef: string, skillId: string, active: boolean) => {
      if (skillConfig == null) return
      const currentDisabled =
        scope === 'project'
          ? skillConfig.projectDisabledSkillIds
          : skillConfig.sessionDisabledSkillIds
      const currentSelected =
        scope === 'project' ? skillConfig.projectSkillIds : skillConfig.sessionSkillIds
      const nextDisabled = active
        ? currentDisabled.filter((id) => id !== skillId)
        : Array.from(new Set([...currentDisabled, skillId]))
      // When activating, also add to the selected list if not already present
      const nextSelected = active
        ? Array.from(new Set([...currentSelected, skillId]))
        : currentSelected
      setSavingRuntime(true)
      try {
        await updateSkillConfig({
          scope,
          scopeRef,
          skillIds: nextSelected,
          disabledSkillIds: nextDisabled,
        })
        await loadRuntimeConfig()
      } finally {
        setSavingRuntime(false)
      }
    },
    [loadRuntimeConfig, skillConfig, updateSkillConfig],
  )

  /** 通过 Picker 添加 skills 到会话级别 */
  const handleAddSessionSkills = useCallback(
    async (newIds: string[]) => {
      if (skillConfig == null || sessionId == null) return
      const nextSelected = Array.from(new Set([...skillConfig.sessionSkillIds, ...newIds]))
      // 从 disabled 中移除新增的 skill
      const nextDisabled = skillConfig.sessionDisabledSkillIds.filter((id) => !newIds.includes(id))
      setSavingRuntime(true)
      try {
        await updateSkillConfig({
          scope: 'session',
          scopeRef: sessionId,
          skillIds: nextSelected,
          disabledSkillIds: nextDisabled,
        })
        await loadRuntimeConfig()
      } finally {
        setSavingRuntime(false)
      }
    },
    [loadRuntimeConfig, skillConfig, sessionId, updateSkillConfig],
  )

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
      } finally {
        setSavingRuntime(false)
      }
    },
    [loadRuntimeConfig, updatePromptConfig],
  )

  const saveEnvLayer = useCallback(
    async (
      scope: 'project' | 'session',
      scopeRef: string,
      vars: EnvVarItem[],
      options?: { silent?: boolean },
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
        if (!options?.silent) await loadRuntimeConfig()
      } catch (err) {
        // 失败必须可见，否则用户以为「失焦已保存」实际丢了。
        // silent 路径触发频率高，用 console.warn 记录即可；显式保存失败弹 toast。
        if (options?.silent) {
          console.warn('[env] silent save failed', err)
        } else {
          toast.error(err instanceof Error ? err.message : '环境变量保存失败')
        }
      } finally {
        if (!options?.silent) setSavingRuntime(false)
      }
    },
    [loadRuntimeConfig, updateEnvConfig, toast],
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
        <div className="runtime-prompt-title">{label}</div>
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
          <button className="btn ghost sm runtime-env-add" onClick={addVar}>
            <Icons.Plus size={12} /> 添加变量
          </button>
          <button
            className="btn primary sm runtime-save-btn"
            disabled={savingRuntime}
            onClick={() => void saveEnvLayer(scope, scopeRef, vars)}
          >
            <Save size={12} />
            {scope === 'project' ? '保存项目' : '保存会话'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={embedded ? 'inspector-frame embedded' : 'inspector-frame'}
      style={{ '--inspector-width': `${width}px` } as React.CSSProperties}
    >
      {!embedded && (
        <div
          className="inspector-resize-handle"
          title="拖拽调整侧边栏宽度"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />
      )}
      <div className="inspector scroll">
        {/* 环境变量 */}
        {session != null && envConfig != null && (
          <div className="inspector-section">
            <h4 className="config-panel-header" onClick={() => setEnvCollapsed(!envCollapsed)}>
              <Icons.Lock size={11} />
              环境变量
              <span className="spacer" />
              <Icons.ChevronRight size={10} className={`chev ${envCollapsed ? '' : 'chev-open'}`} />
            </h4>
            {!envCollapsed && (
              <>
                <div className="runtime-env-hint">
                  键值仅保存在本机并注入运行环境，提示词中只暴露脱敏后的键名与描述，避免敏感信息泄露。修改后失焦或删除即自动保存，无需手动点保存。
                </div>
                {workspaceId != null &&
                  renderEnvBlock(
                    '项目环境变量',
                    '当前项目所有会话共享，例如 API_KEY、TOKEN…',
                    'project',
                    workspaceId,
                    projectEnvDraft,
                    setProjectEnvDraft,
                  )}
                {sessionId != null &&
                  renderEnvBlock(
                    '会话环境变量',
                    '仅对当前会话生效，覆盖同名的项目变量…',
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
        {session != null && promptConfig != null && (
          <div className="inspector-section">
            <h4
              className="config-panel-header"
              onClick={() => setPromptsCollapsed(!promptsCollapsed)}
            >
              <Icons.Edit size={11} />
              提示词
              <span className="spacer" />
              <Icons.ChevronRight
                size={10}
                className={`chev ${promptsCollapsed ? '' : 'chev-open'}`}
              />
            </h4>
            {!promptsCollapsed && (
              <>
                {workspaceId != null && (
                  <div className="runtime-prompt-block">
                    <div className="runtime-prompt-title">项目提示词</div>
                    <textarea
                      className="spark-textarea inspector-textarea"
                      value={projectPromptDraft}
                      onChange={(event) => setProjectPromptDraft(event.target.value)}
                      placeholder="当前项目会话通用提示词..."
                    />
                    <button
                      className="btn ghost sm runtime-save-btn"
                      disabled={savingRuntime}
                      onClick={() =>
                        void savePromptLayer('project', workspaceId, projectPromptDraft)
                      }
                    >
                      保存项目
                    </button>
                  </div>
                )}
                {sessionId != null && (
                  <div className="runtime-prompt-block">
                    <div className="runtime-prompt-title">会话提示词</div>
                    <textarea
                      className="spark-textarea inspector-textarea"
                      value={sessionPromptDraft}
                      onChange={(event) => setSessionPromptDraft(event.target.value)}
                      placeholder="仅对当前会话生效..."
                    />
                    <button
                      className="btn ghost sm runtime-save-btn"
                      disabled={savingRuntime}
                      onClick={() => void savePromptLayer('session', sessionId, sessionPromptDraft)}
                    >
                      保存会话
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Skills — 显示本次会话可用的所有 skills（agent 配置 + 会话额外添加） */}
        {session != null &&
          skillConfig != null &&
          (() => {
            const agentSkillSet = new Set(skillConfig.agentSkillIds)
            const effectiveSet = new Set(skillConfig.effectiveSkillIds)
            const visibleSkills = skillConfig.skills.filter((s) => effectiveSet.has(s.id))
            // Picker 中可选的 skills = 全量 skills 中尚未在 effective 中的
            const pickerSkills = allSkills.filter((s) => !effectiveSet.has(s.id))
            return (
              <div className="inspector-section">
                <h4
                  className="config-panel-header"
                  onClick={() => setSkillsCollapsed(!skillsCollapsed)}
                >
                  <Icons.Skills size={11} />
                  Skills
                  <span className="inspector-count">{visibleSkills.length}</span>
                  <span className="spacer" />
                  {!skillsCollapsed && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      style={{ fontSize: 10, padding: '2px 8px', marginRight: 4 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setPickerDraft([])
                        setShowSkillPicker(true)
                      }}
                      title="为本次会话添加额外 Skill"
                    >
                      <Icons.Plus size={10} /> 添加
                    </button>
                  )}
                  <Icons.ChevronRight
                    size={10}
                    className={`chev ${skillsCollapsed ? '' : 'chev-open'}`}
                  />
                </h4>
                {!skillsCollapsed && (
                  <>
                    <div className="runtime-skill-list">
                      {visibleSkills.map((skill) => {
                        const isAgentSkill = agentSkillSet.has(skill.id)
                        const meta = parseSkillManifest(skill.manifestJson)
                        return (
                          <div className="runtime-skill-row" key={skill.id}>
                            <div className="runtime-skill-main min-w-0">
                              <div className="runtime-skill-name truncate">
                                {skill.name}
                                {isAgentSkill && (
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      marginLeft: 4,
                                      padding: '0 4px',
                                      borderRadius: 4,
                                      fontSize: 9,
                                      fontWeight: 700,
                                      lineHeight: '16px',
                                      background: 'var(--primary-soft)',
                                      color: 'var(--primary)',
                                    }}
                                    title="来自 Agent 配置"
                                  >
                                    A
                                  </span>
                                )}
                              </div>
                              <div className="runtime-skill-desc truncate">
                                {meta.source}
                                {meta.desc ? ` · ${meta.desc}` : ''}
                              </div>
                            </div>
                            {/* 会话级额外添加的 skill 可移除（× 按钮） */}
                            {!isAgentSkill && sessionId != null && (
                              <button
                                type="button"
                                className="btn ghost sm"
                                style={{
                                  padding: '0 4px',
                                  minWidth: 20,
                                  fontSize: 11,
                                  lineHeight: '18px',
                                  color: 'var(--text-muted)',
                                }}
                                title="从本次会话移除此 Skill"
                                disabled={savingRuntime}
                                onClick={() =>
                                  void toggleRuntimeSkill('session', sessionId, skill.id, false)
                                }
                              >
                                ×
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <div className="inspector-muted runtime-hint">
                      {visibleSkills.length > 0
                        ? 'A = Agent 配置；点击「添加」为本会话补充额外 Skill'
                        : '在 Agent 管理中配置 Skills，或点击「添加」为本会话补充'}
                    </div>
                  </>
                )}
                <SkillsPickerModal
                  visible={showSkillPicker}
                  skills={pickerSkills.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }))}
                  selectedIds={pickerDraft}
                  onChange={(ids) => setPickerDraft(ids)}
                  onConfirm={() => {
                    const ids = pickerDraft
                    setShowSkillPicker(false)
                    setPickerDraft([])
                    if (ids.length > 0) void handleAddSessionSkills(ids)
                  }}
                  onClose={() => {
                    // 取消：仅关闭，不提交
                    setShowSkillPicker(false)
                    setPickerDraft([])
                  }}
                />
              </div>
            )
          })()}

        {/* 可用工具 */}
        <div className="inspector-section">
          <h4 className="config-panel-header" onClick={() => setToolsCollapsed(!toolsCollapsed)}>
            <Icons.Wrench size={11} />
            可用工具
            <span className="inspector-count">{CODING_AGENT_TOOLS.length}</span>
            <Icons.ChevronRight size={10} className={`chev ${toolsCollapsed ? '' : 'chev-open'}`} />
          </h4>
          {!toolsCollapsed && (
            <div className="tool-chip-list">
              {CODING_AGENT_TOOLS.map((tool) => (
                <span
                  key={tool.name}
                  className="tool-chip"
                  title={`${tool.group} · ${tool.status === 'built-in' ? '内置' : '扩展接入'}`}
                >
                  <Icons.Wrench />
                  {tool.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
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
  providerContextWindow,
  turnPromptSnapshots,
  width,
  onWidthChange,
  teamConfig,
  agents,
  runningTeamAgentIds,
  onChangeTeamConfig,
  onOpenProjectFolder,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  messages: UIMessage[]
  usageData: SessionUsageData
  projectContext: ProjectContextState | null
  contextUsage: ContextUsageState | null
  contextLedger: ContextLedgerState | null
  contextInputTokens: number
  providerContextWindow: number
  turnPromptSnapshots: TurnPromptSnapshotEvent[]
  width: number
  onWidthChange: (width: number) => void
  teamConfig: TeamModeConfig
  agents: ManagedAgent[]
  runningTeamAgentIds: string[]
  onChangeTeamConfig: (patch: Partial<TeamModeConfig>) => void
  onOpenProjectFolder: () => void
}) {
  const subagents = extractInspectorSubagents(messages)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const projectContextSources = projectContext?.sources ?? []
  const fileChangeSummaries = extractInspectorFileChanges(messages)

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

  // 与底部 ContextMeterWithPopup 弹窗保持同一口径：优先采用 context_ledger 的完整分段总和
  // （含对话历史 / 项目上下文 / 附件），比 context_usage.estimatedTokens（仅统计本轮系统提示
  // + 用户消息）更准确，避免这里少算。
  const currentContextTokens =
    contextLedger?.totalEstimatedTokens ?? contextUsage?.estimatedTokens ?? contextInputTokens
  // 窗口大小由 Provider 显式配置决定；历史 context_usage 里可能还带旧的模型名推断值。
  const contextWindow = providerContextWindow
  // 「X% 已用」始终按硬窗口显示，对齐弹窗顶部「X% 已用 / 200K」。
  const contextRatio =
    contextWindow > 0
      ? Math.min(100, Math.round((currentContextTokens / contextWindow) * 1000) / 10)
      : 0
  // 预警阈值以「软上限」（自动压缩触发线，约窗口 70%）为基准，而非硬窗口，
  // 这样 80% / 100% 的徽标分别对应「接近 / 已达压缩线」，与弹窗口径一致。
  const softLimitTokens = contextLedger?.softLimitTokens ?? contextUsage?.softLimitTokens ?? 0
  const softLimit = softLimitTokens > 0 ? softLimitTokens : Math.floor(contextWindow * 0.7)
  const softUsedRatio = softLimit > 0 ? currentContextTokens / softLimit : 0
  const isContextWarning = softUsedRatio >= 0.8
  const isContextCritical = softUsedRatio >= 1

  return (
    <div
      className="inspector-frame"
      style={{ '--inspector-width': `${width}px` } as React.CSSProperties}
    >
      <div
        className="inspector-resize-handle"
        title="拖拽调整侧边栏宽度"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />
      <div className="inspector scroll">
        {teamConfig.enabled && (
          <TeamInspectorSection
            config={teamConfig}
            agents={agents.map((a) => ({
              id: a.id,
              name: a.name,
              description: a.description,
              builtIn: a.builtIn,
              providerProfileId: a.providerProfileId ?? null,
              modelId: a.modelId ?? null,
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
        )}
        <div className="inspector-section">
          <h4>会话信息</h4>
          {session ? (
            <>
              <div className="kv-row">
                <span className="k">ID</span>
                <span className="v mono-sm inspector-v-id">
                  {(session.id as string).slice(0, 16)}…
                </span>
              </div>
              <div className="kv-row">
                <span className="k">状态</span>
                <span className="v">{session.status}</span>
              </div>
              <div className="kv-row">
                <span className="k">消息数</span>
                <span className="v">{session.messageCount}</span>
              </div>
              <div className="kv-row">
                <span className="k">项目</span>
                <span className="v truncate">{workspace?.name ?? '未归属'}</span>
              </div>
              {workspace && (
                <div className="kv-row">
                  <span className="k">路径</span>
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
                  <span>打开文件夹</span>
                </button>
              )}
              <div className="kv-row">
                <span className="k">创建时间</span>
                <span className="v">{new Date(session.createdAt).toLocaleString()}</span>
              </div>
              <div className="kv-row">
                <span className="k">更新时间</span>
                <span className="v">{new Date(session.updatedAt).toLocaleString()}</span>
              </div>
            </>
          ) : (
            <div className="inspector-muted">未选择会话</div>
          )}
        </div>

        {workspace && (
          <div className="inspector-section">
            <WorktreePanel workspaceId={workspace.id} sessionId={session?.id ?? null} />
          </div>
        )}

        {session != null && projectContext != null && (
          <div className="inspector-section">
            <h4>
              项目上下文
              <span className="inspector-count">{projectContextSources.length}</span>
            </h4>
            <div className="kv-row">
              <span className="k">规则</span>
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
                  <span className="k">模式</span>
                  <span className="v">{projectContext.budget.mode}</span>
                </div>
                <div className="kv-row">
                  <span className="k">预算</span>
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
              <div className="inspector-muted">本轮未发现项目级规则、skills 或 agents。</div>
            )}
          </div>
        )}

        {fileChangeSummaries.length > 0 && (
          <div className="inspector-section">
            <h4>
              Change Review
              <span className="inspector-count">{fileChangeSummaries.length}</span>
            </h4>
            <div className="runtime-skill-list">
              {fileChangeSummaries.map((change) => (
                <div className="runtime-skill-row" key={change.id}>
                  <div className="runtime-skill-main min-w-0">
                    <div className="runtime-skill-name truncate">{change.path}</div>
                    <div className="runtime-skill-desc truncate">
                      {change.changeType} · +{change.adds} -{change.dels}
                      {!change.hasDiff ? ' · no diff' : ''}
                      {change.checkpointIds.length > 0
                        ? ` · checkpoint ${change.checkpointIds.join(', ')}`
                        : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {subagents.length > 0 && (
          <div className="inspector-section">
            <h4>
              <Icons.Bot size={11} /> 子 Agent
              <span className="inspector-count">{subagents.length}</span>
            </h4>
            <div className="runtime-skill-list">
              {subagents.map((sa, idx) => (
                <div
                  className={`runtime-skill-row${sa.status === 'running' ? ' running' : ''}`}
                  key={`${sa.toolCallId}-${idx}`}
                  title={sa.output ? '点击查看输出' : undefined}
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

        {/* Token Usage Section */}
        <div className="inspector-section">
          <h4>
            <Icons.Cpu size={11} /> Token 用量
          </h4>
          <TokenUsagePanel
            inputTokens={usageData.inputTokens}
            outputTokens={usageData.outputTokens}
            reasoningOutputTokens={usageData.reasoningOutputTokens}
            totalTokens={
              usageData.inputTokens + usageData.outputTokens + usageData.reasoningOutputTokens
            }
            cacheHitTokens={usageData.cacheHitTokens}
            cacheWriteTokens={usageData.cacheWriteTokens}
            estimatedCostUsd={usageData.estimatedCostUsd}
          />
        </div>

        {/* Context Window Section — 仅在已知上下文窗口大小时展示 */}
        {contextWindow > 0 && (
          <div className="inspector-section">
            <h4>
              <Icons.Database size={11} /> 上下文窗口
              {isContextCritical && (
                <span className="badge danger dot usage-warning-badge">即将满</span>
              )}
              {!isContextCritical && isContextWarning && (
                <span className="badge warning dot usage-warning-badge">接近满</span>
              )}
            </h4>
            <ContextWindowVisualization
              usedTokens={currentContextTokens}
              totalTokens={contextWindow}
              ratio={contextRatio}
              isWarning={isContextWarning}
              isCritical={isContextCritical}
            />
          </div>
        )}

        {/* Per-Turn Token Chart */}
        {usageData.turns.length > 0 && (
          <div className="inspector-section">
            <h4>
              <Icons.Activity size={11} /> 轮次用量
              <span className="inspector-count">{usageData.turns.length} 轮</span>
            </h4>
            <TurnUsageChart turns={usageData.turns.slice(-20)} />
          </div>
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
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  return `${Math.floor(diff / 86_400_000)}天前`
}

/** 截断文本 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}

/** PromptInspectorSection — 白盒提示词、运行时日志检查器 */
function PromptInspectorSection({ snapshots }: { snapshots: TurnPromptSnapshotEvent[] }) {
  return (
    <div className="inspector-section">
      <h4>
        <Icons.Eye size={11} /> 运行时日志
        <span className="inspector-count">{snapshots.length} 轮</span>
      </h4>
      <div className="prompt-snapshot-list">
        {[...snapshots].reverse().map((snapshot, idx) => (
          <TurnPromptRow
            key={snapshot.turnId}
            snapshot={snapshot}
            turnNumber={snapshots.length - idx}
          />
        ))}
      </div>
    </div>
  )
}

/** 单个 Turn 的提示词快照行，支持展开/折叠 */
const TurnPromptRow = React.memo(function TurnPromptRow({
  snapshot,
  turnNumber,
}: {
  snapshot: TurnPromptSnapshotEvent
  turnNumber: number
}) {
  const [expanded, setExpanded] = useState(false)
  const userPreview = useMemo(() => truncateText(snapshot.userMessage, 80), [snapshot.userMessage])
  const totalPromptChars = useMemo(
    () => snapshot.systemPromptSections.reduce((sum, s) => sum + s.charCount, 0),
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
        <span className="prompt-turn-user" title={snapshot.userMessage}>
          {userPreview}
        </span>
        <span className="prompt-turn-meta">
          {snapshot.systemPromptSections.length} 段 · {formatCharCount(totalPromptChars)} 字符
        </span>
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

          {/* 用户消息 */}
          <div className="prompt-section-block">
            <div className="prompt-section-label">用户消息</div>
            <pre className="prompt-section-content">{snapshot.userMessage}</pre>
          </div>

          {/* 系统提示词各段落 */}
          {snapshot.systemPromptSections.map((section, sIdx) => (
            <PromptSectionBlock key={sIdx} section={section} />
          ))}
        </div>
      )}
    </div>
  )
})

/** 单个提示词段落的展示，支持独立折叠 */
const PromptSectionBlock = React.memo(function PromptSectionBlock({
  section,
}: {
  section: { label: string; content: string; charCount: number }
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
        {section.charCount > 0 && (
          <span className="prompt-section-chars">{section.charCount} 字符</span>
        )}
      </div>
      {sectionExpanded && !isPlaceholder && (
        <pre className="prompt-section-content">{section.content}</pre>
      )}
      {isPlaceholder && <div className="prompt-section-placeholder">{section.content}</div>}
    </div>
  )
})

export function PlanSummary({
  plan,
  renderMarkdown,
}: {
  plan: SidebarPlan
  renderMarkdown: MarkdownTextComponent
}) {
  const MarkdownRenderer = renderMarkdown
  const completed = plan.items.filter((item) => item.status === 'done').length
  const total = plan.items.length
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)

  return (
    <div className="inspector-plan">
      <div className="inspector-plan-head">
        <span className="strong truncate">{plan.title}</span>
        <span className="mono-sm">
          {completed}/{total}
        </span>
      </div>
      {percent && percent > 0 ? (
        <div className="inspector-progress">
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}

      {plan.explanation && (
        <div className="inspector-plan-note md-surface">
          <MarkdownRenderer content={plan.explanation} />
        </div>
      )}
      <div className="inspector-plan-items">
        {plan.items.map((item, index) => (
          <div key={`${item.text}-${index}`} className={`inspector-plan-item ${item.status}`}>
            <span className="inspector-plan-dot-wrap">
              <span className="inspector-plan-dot">
                {item.status === 'done' && <Icons.Check size={10} />}
                {item.status === 'running' && <Icons.Spinner size={10} />}
              </span>
            </span>
            <span className="text">{renderPlanInline(item.text)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

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

function TokenUsagePanel({
  inputTokens,
  outputTokens,
  reasoningOutputTokens,
  totalTokens,
  cacheHitTokens,
  cacheWriteTokens,
  estimatedCostUsd,
}: {
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  cacheHitTokens: number
  cacheWriteTokens: number
  estimatedCostUsd: number
}) {
  const hasUsage = totalTokens > 0
  return (
    <div className="token-usage-panel">
      <div className="token-usage-stats">
        <div className="token-stat">
          <span className="token-stat-label">输入</span>
          <span className="token-stat-value">{formatTokenCount(inputTokens)}</span>
        </div>
        <div className="token-stat">
          <span className="token-stat-label">输出</span>
          <span className="token-stat-value">{formatTokenCount(outputTokens)}</span>
        </div>
        <div className="token-stat token-stat-total">
          <span className="token-stat-label">总计</span>
          <span className="token-stat-value">{formatTokenCount(totalTokens)}</span>
        </div>
      </div>
      {cacheHitTokens > 0 && (
        <div className="token-usage-row">
          <span className="token-row-label">缓存命中</span>
          <span className="token-row-value">{formatTokenCount(cacheHitTokens)}</span>
        </div>
      )}
      {reasoningOutputTokens > 0 && (
        <div className="token-usage-row">
          <span className="token-row-label">推理输出</span>
          <span className="token-row-value">{formatTokenCount(reasoningOutputTokens)}</span>
        </div>
      )}
      {cacheWriteTokens > 0 && (
        <div className="token-usage-row">
          <span className="token-row-label">缓存写入</span>
          <span className="token-row-value">{formatTokenCount(cacheWriteTokens)}</span>
        </div>
      )}
      {hasUsage && (
        <div className="token-usage-row">
          <span className="token-row-label">预估成本</span>
          <span className="token-row-value token-cost">
            $
            {estimatedCostUsd < 0.01 && estimatedCostUsd > 0
              ? '<0.01'
              : estimatedCostUsd.toFixed(4)}
          </span>
        </div>
      )}
      {!hasUsage && <div className="inspector-muted">暂无用量数据</div>}
    </div>
  )
}

function ContextWindowVisualization({
  usedTokens,
  totalTokens,
  ratio,
  isWarning,
  isCritical,
}: {
  usedTokens: number
  totalTokens: number
  ratio: number
  isWarning: boolean
  isCritical: boolean
}) {
  // Estimated breakdown percentages (approximate visual representation)
  // In a real implementation, these would come from actual API response data
  const systemPct = 5
  const toolsPct = 10
  const historyPct = Math.max(0, ratio - systemPct - toolsPct)

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
          <span>上下文窗口即将满 ({ratio}%)，建议开启新会话</span>
        </div>
      )}
      {!isCritical && isWarning && (
        <div className="context-warning-msg context-warning-warn">
          <Icons.AlertTriangle size={11} />
          <span>上下文窗口使用超过 {ratio}%，请注意</span>
        </div>
      )}
      <div className="context-usage-bar">
        <div
          className={`context-usage-fill ${barClass}`}
          style={{ width: `${Math.min(100, ratio)}%` }} /* dynamic */
        >
          <div className="context-fill-system" style={{ width: `${systemPct}%` }} /* dynamic */ />
          <div className="context-fill-tools" style={{ width: `${toolsPct}%` }} /* dynamic */ />
          <div className="context-fill-history" />
        </div>
      </div>
      <div className="context-usage-labels">
        <span className="context-label context-label-system">系统提示</span>
        <span className="context-label context-label-tools">工具定义</span>
        <span className="context-label context-label-history">对话历史</span>
        <span className="context-label context-label-remaining">剩余</span>
      </div>
      <div className="context-usage-detail">
        <div className="kv-row">
          <span className="k">已用</span>
          <span className="v">{formatTokenCount(usedTokens)}</span>
        </div>
        <div className="kv-row">
          <span className="k">总量</span>
          <span className="v">{formatTokenCount(totalTokens)}</span>
        </div>
        <div className="kv-row">
          <span className="k">使用率</span>
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

function TurnUsageChart({ turns }: { turns: UsageSnapshot[] }) {
  if (turns.length === 0) return null

  const maxTokens = Math.max(
    ...turns.map((t) => t.inputTokens + t.outputTokens + t.reasoningOutputTokens),
    1,
  )

  return (
    <div className="turn-usage-chart">
      {turns.map((turn, index) => {
        const total = turn.inputTokens + turn.outputTokens + turn.reasoningOutputTokens
        const inputPct = (turn.inputTokens / maxTokens) * 100
        const outputPct = (turn.outputTokens / maxTokens) * 100
        const reasoningPct = (turn.reasoningOutputTokens / maxTokens) * 100
        return (
          <div
            key={`${turn.turnId}-${index}`}
            className="turn-usage-bar-group"
            title={`第 ${index + 1} 轮: 输入 ${formatTokenCount(turn.inputTokens)}, 输出 ${formatTokenCount(turn.outputTokens)}, 推理 ${formatTokenCount(turn.reasoningOutputTokens)}`}
          >
            <span className="turn-usage-index">{index + 1}</span>
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

export function buildUsageDataFromEvents(events: AgentEvent[]): SessionUsageData {
  let inputTokens = 0
  let outputTokens = 0
  let reasoningOutputTokens = 0
  let cacheHitTokens = 0
  let cacheWriteTokens = 0
  let estimatedCostUsd = 0
  const turns: UsageSnapshot[] = []

  for (const event of events) {
    if (event.type !== 'usage_update') continue
    inputTokens = event.inputTokens
    outputTokens = event.outputTokens
    reasoningOutputTokens = event.reasoningOutputTokens ?? 0
    if (event.cacheHitTokens != null) cacheHitTokens = event.cacheHitTokens
    if (event.cacheWriteTokens != null) cacheWriteTokens = event.cacheWriteTokens
    if (event.estimatedCostUsd != null) estimatedCostUsd += event.estimatedCostUsd
    turns.push({
      turnId: event.turnId,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      reasoningOutputTokens: event.reasoningOutputTokens ?? 0,
      cacheHitTokens: event.cacheHitTokens ?? 0,
      cacheWriteTokens: event.cacheWriteTokens ?? 0,
      estimatedCostUsd: event.estimatedCostUsd ?? 0,
      timestamp: event.timestamp,
    })
  }

  return {
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheHitTokens,
    cacheWriteTokens,
    estimatedCostUsd,
    contextWindow: 0,
    turns,
  }
}
