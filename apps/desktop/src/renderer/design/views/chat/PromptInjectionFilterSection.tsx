import { useCallback, useEffect, useState } from 'react'
import { Switch } from 'antd'
import { Save } from 'lucide-react'
import {
  PROMPT_INJECTION_SOURCES,
  type PromptFilterConfigGetResponse,
  type PromptInjectionGroup,
  type PromptInjectionSourceInfo,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
import { useToast } from '../../components/Toast'
import { useIpcInvoke } from '../../hooks/useIpc'

/**
 * 提示词注入过滤区块（ChatConfigPanel）。
 *
 * 双层配置（会话层显式接管语义，见 prompt-injection-filter.ts）：
 * - 项目层：对本项目所有会话生效；
 * - 会话层：默认「跟随项目」；开启「本会话独立配置」后以当前生效集快照为草稿，
 *   保存即整体接管（可临时开回项目层禁项）；「恢复跟随项目」删除会话层行。
 *
 * 注册表（PROMPT_INJECTION_SOURCES）与主进程过滤口径同源；tier:'locked' 条目
 * 仅作锁定展示。文案 key 按 id 派生（`chatInspector.pf.source.${id 去冒号}`）。
 */

const GROUP_ORDER: readonly PromptInjectionGroup[] = ['mcp', 'context', 'catalog', 'memory', 'platform']

const GROUP_TITLE_KEY: Record<PromptInjectionGroup, string> = {
  mcp: 'chatInspector.pfGroupMcp',
  context: 'chatInspector.pfGroupContext',
  catalog: 'chatInspector.pfGroupCatalog',
  memory: 'chatInspector.pfGroupMemory',
  platform: 'chatInspector.pfGroupPlatform',
}

/** id（mcp:spark_platform）→ i18n key（chatInspector.pf.source.mcp.spark_platform）。 */
function sourceLabelKey(id: string): string {
  return `chatInspector.pf.source.${id.replace(/:/g, '.')}`
}

/** 特定条目的局限说明（引擎差异 / 不可控的原生读取）。 */
function sourceNoteKey(id: string): string | undefined {
  if (id === 'mcp:spark_platform') return 'chatInspector.pfPlatformNote'
  if (id === 'inject:projectContext') return 'chatInspector.pfProjectContextNote'
  return undefined
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>()

interface PromptFilterSectionProps {
  sessionId?: string | undefined
  workspaceId?: string | undefined
}

export function PromptInjectionFilterSection({ sessionId, workspaceId }: PromptFilterSectionProps) {
  // 本组件使用非响应式 translate()：订阅语言变化，保证切换语言后重渲染。
  useI18n()
  const { toast } = useToast()
  const [collapsed, setCollapsed] = useState(false)
  const [config, setConfig] = useState<PromptFilterConfigGetResponse | null>(null)
  const [projectDraft, setProjectDraft] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [sessionTakeover, setSessionTakeover] = useState(false)
  const [sessionDraft, setSessionDraft] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [saving, setSaving] = useState(false)
  const { invoke: getFilter } = useIpcInvoke('prompt-filter:get')
  const { invoke: updateFilter } = useIpcInvoke('prompt-filter:update')

  const loadConfig = useCallback(async () => {
    try {
      const res = await getFilter({
        ...(workspaceId != null ? { workspaceId } : {}),
        ...(sessionId != null ? { sessionId } : {}),
      })
      setConfig(res)
      setProjectDraft(new Set(res.project.disabledSources))
      setSessionTakeover(res.session.configured)
      // 接管基线：当前生效集（会话已配置时即会话层，否则为项目层/空）。
      setSessionDraft(new Set(res.effectiveDisabledSources))
    } catch {
      setConfig(null)
    }
  }, [getFilter, sessionId, workspaceId])

  useEffect(() => {
    if (sessionId == null && workspaceId == null) {
      setConfig(null)
      return
    }
    void loadConfig()
  }, [loadConfig, sessionId, workspaceId])

  const saveProjectLayer = useCallback(async () => {
    if (workspaceId == null) return
    setSaving(true)
    try {
      await updateFilter({
        scope: 'project',
        scopeRef: workspaceId,
        disabledSources: [...projectDraft].sort(),
      })
      // update 响应只含被写层（后端 refs 单层），完整双层态以重新 get 为准——
      // 否则会话层已接管时 sessionDraft 会被单层响应污染成项目层集合。
      await loadConfig()
      toast.success(translate('chatInspector.pfSaved'))
    } catch {
      toast.error(translate('chatInspector.pfSaveFailed'))
    } finally {
      setSaving(false)
    }
  }, [projectDraft, toast, updateFilter, workspaceId, loadConfig])

  const saveSessionLayer = useCallback(async () => {
    if (sessionId == null) return
    setSaving(true)
    try {
      await updateFilter({
        scope: 'session',
        scopeRef: sessionId,
        disabledSources: [...sessionDraft].sort(),
      })
      await loadConfig()
      toast.success(translate('chatInspector.pfSaved'))
    } catch {
      toast.error(translate('chatInspector.pfSaveFailed'))
    } finally {
      setSaving(false)
    }
  }, [sessionDraft, sessionId, toast, updateFilter, loadConfig])

  /** 删除会话层行（恢复继承项目层）。关闭接管开关与「恢复跟随项目」按钮共用。 */
  const deleteSessionLayer = useCallback(async () => {
    if (sessionId == null) return
    setSaving(true)
    try {
      await updateFilter({
        scope: 'session',
        scopeRef: sessionId,
        disabledSources: undefined,
      })
      await loadConfig()
      toast.success(translate('chatInspector.pfSaved'))
    } catch {
      toast.error(translate('chatInspector.pfSaveFailed'))
    } finally {
      setSaving(false)
    }
  }, [sessionId, toast, updateFilter, loadConfig])

  const renderSourceRow = (
    source: PromptInjectionSourceInfo,
    disabledSet: ReadonlySet<string> | null,
    onToggle?: (id: string, next: boolean) => void,
  ) => {
    const locked = source.tier === 'locked'
    const checked = disabledSet?.has(source.id) ?? false
    const noteKey = sourceNoteKey(source.id)
    return (
      <div key={source.id} className="prompt-filter-row">
        <Switch
          size="small"
          checked={checked}
          disabled={locked || disabledSet == null || onToggle == null}
          onChange={(next) => onToggle?.(source.id, next)}
        />
        <span className={`prompt-filter-label${locked ? ' prompt-filter-locked' : ''}`}>
          {translate(sourceLabelKey(source.id))}
          {source.approxTokens > 0 && (
            <span className="prompt-filter-tokens">
              {translate('chatInspector.pfTokenBadge', { tokens: source.approxTokens })}
            </span>
          )}
        </span>
        {locked ? (
          <span className="prompt-filter-note" title={translate('chatInspector.pfLockedReason')}>
            <Icons.Lock size={10} />
            {translate('chatInspector.pfLockedReason')}
          </span>
        ) : noteKey != null ? (
          <span className="prompt-filter-note">{translate(noteKey)}</span>
        ) : null}
      </div>
    )
  }

  const renderGroupedRows = (
    disabledSet: ReadonlySet<string> | null,
    onToggle?: (id: string, next: boolean) => void,
  ) =>
    GROUP_ORDER.map((group) => {
      const sources = PROMPT_INJECTION_SOURCES.filter((source) => source.group === group)
      if (sources.length === 0) return null
      return (
        <div key={group} className="prompt-filter-group">
          <div className="prompt-filter-group-title">{translate(GROUP_TITLE_KEY[group])}</div>
          {sources.map((source) => renderSourceRow(source, disabledSet, onToggle))}
        </div>
      )
    })

  const toggleInSet = (setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>) => {
    return (id: string, next: boolean) =>
      setter((prev) => {
        const mutable = new Set(prev)
        if (next) mutable.add(id)
        else mutable.delete(id)
        return mutable
      })
  }

  const disabledCount = config?.effectiveDisabledSources.length ?? 0

  return (
    <div className="inspector-section">
      <h4 className="config-panel-header">
        <button
          type="button"
          className="session-panel-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icons.Filter size={11} />
          {translate('chatInspector.pfTitle')}
          <span className="spacer" />
          {disabledCount > 0 && (
            <span className="session-panel-count">
              {translate('chatInspector.pfCountBadge', { count: disabledCount })}
            </span>
          )}
          <Icons.ChevronRight size={10} className={`chev ${collapsed ? '' : 'chev-open'}`} />
        </button>
      </h4>
      {!collapsed && config != null && (
        <>
          <div className="session-panel-caption">{translate('chatInspector.pfDesc')}</div>
          {workspaceId != null && (
            <div className="runtime-prompt-block">
              <div className="runtime-prompt-title">
                {translate('chatInspector.t5')}
                <span className="session-panel-count">
                  {translate('chatInspector.pfCountBadge', { count: projectDraft.size })}
                </span>
              </div>
              {renderGroupedRows(projectDraft, (id, next) =>
                toggleInSet(setProjectDraft)(id, next),
              )}
              <button
                type="button"
                className="btn ghost sm runtime-save-btn"
                disabled={saving}
                onClick={() => void saveProjectLayer()}
              >
                <Save size={12} />
                {translate('chatInspector.pfSaveProject')}
              </button>
            </div>
          )}
          {sessionId != null && (
            <div className="runtime-prompt-block">
              <div className="runtime-prompt-title">
                <Switch
                  size="small"
                  checked={sessionTakeover}
                  onChange={(next) => {
                    // 开启接管时以当前生效集为草稿基线；关闭即落盘删除会话层行
                    //（若只改本地态，保存按钮随接管区隐藏、删行路径不可达，
                    // UI 会显示「跟随项目」而实际仍接管）。
                    if (next) {
                      setSessionDraft(new Set(config.effectiveDisabledSources))
                      setSessionTakeover(true)
                    } else {
                      setSessionTakeover(false)
                      void deleteSessionLayer()
                    }
                  }}
                />
                {translate(sessionTakeover ? 'chatInspector.pfTakeover' : 'chatInspector.pfFollow')}
              </div>
              {sessionTakeover ? (
                <>
                  <div className="session-panel-caption">
                    {translate('chatInspector.pfTakeoverDesc')}
                  </div>
                  {renderGroupedRows(sessionDraft, (id, next) =>
                    toggleInSet(setSessionDraft)(id, next),
                  )}
                  <button
                    type="button"
                    className="btn ghost sm runtime-save-btn"
                    disabled={saving}
                    onClick={() => void saveSessionLayer()}
                  >
                    <Save size={12} />
                    {translate('chatInspector.pfSaveSession')}
                  </button>
                </>
              ) : (
                <>
                  <div className="session-panel-caption">
                    {translate('chatInspector.t14Desc')}
                  </div>
                  {/* 防御：开关关闭即删行，正常流不显示；删行失败（或外部写入）导致
                      DB 仍有会话层行时，提供显式恢复入口。 */}
                  {config.session.configured && (
                    <button
                      type="button"
                      className="btn ghost sm runtime-save-btn"
                      disabled={saving}
                      onClick={() => void deleteSessionLayer()}
                    >
                      {translate('chatInspector.pfRestore')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
