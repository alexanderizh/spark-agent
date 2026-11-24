/**
 * 远程提示词注入过滤区块（本地 PromptInjectionFilterSection 的远程移植）。
 *
 * 双层配置语义与本地面板一致：
 * - 项目层：对项目所有会话生效；
 * - 会话层：默认「跟随项目」；开启「本会话独立配置」后以当前生效集为草稿，
 *   保存即整体接管；「恢复跟随项目」删除会话层行。
 *
 * 与本地的唯一差异是数据通道：prompt-filter:get/update → 目标端
 * /v1/sessions/:id/runtime-config（聚合读）+ PUT /v1/runtime-config/prompt-filter。
 * 样式复用本地面板类名（prompt-filter-row / prompt-filter-group 等）。
 */
import { useEffect, useState } from 'react'
import { Switch } from 'antd'
import { Save } from 'lucide-react'
import {
  PROMPT_INJECTION_SOURCES,
  type PromptInjectionSourceInfo,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
import { useToast } from '../../components/Toast'
import type { RemoteSessionRuntimeConfigState } from './useRemoteSessionRuntimeConfig'

const GROUP_ORDER = ['mcp', 'context', 'catalog', 'memory', 'platform'] as const

const GROUP_TITLE_KEY: Record<(typeof GROUP_ORDER)[number], string> = {
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

export function RemotePromptInjectionFilterSection({
  sessionId,
  workspaceId,
  runtimeConfig,
}: {
  sessionId: string
  workspaceId: string | undefined
  runtimeConfig: RemoteSessionRuntimeConfigState
}) {
  useI18n()
  const { toast } = useToast()
  const [collapsed, setCollapsed] = useState(false)
  const [projectDraft, setProjectDraft] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [sessionTakeover, setSessionTakeover] = useState(false)
  const [sessionDraft, setSessionDraft] = useState<ReadonlySet<string>>(EMPTY_SET)

  const filter = runtimeConfig.config?.filter ?? null
  useEffect(() => {
    if (filter == null) return
    setProjectDraft(new Set(filter.project.disabledSources))
    setSessionTakeover(filter.session.configured)
    // 接管基线：当前生效集（会话已配置时即会话层，否则为项目层/空）
    setSessionDraft(new Set(filter.effectiveDisabledSources))
  }, [filter])

  const saveProjectLayer = async () => {
    if (workspaceId == null) return
    const saved = await runtimeConfig.saveFilter('project', [...projectDraft].sort())
    if (saved) toast.success(translate('chatInspector.pfSaved'))
    else toast.error(runtimeConfig.error ?? translate('chatInspector.pfSaveFailed'))
  }

  const saveSessionLayer = async () => {
    const saved = await runtimeConfig.saveFilter('session', [...sessionDraft].sort())
    if (saved) toast.success(translate('chatInspector.pfSaved'))
    else toast.error(runtimeConfig.error ?? translate('chatInspector.pfSaveFailed'))
  }

  /** 删除会话层行（恢复继承项目层）。关闭接管开关与「恢复跟随项目」按钮共用。 */
  const deleteSessionLayer = async () => {
    const saved = await runtimeConfig.saveFilter('session', undefined)
    if (saved) toast.success(translate('chatInspector.pfSaved'))
    else toast.error(runtimeConfig.error ?? translate('chatInspector.pfSaveFailed'))
  }

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

  const toggleInSet =
    (setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>) =>
    (id: string, next: boolean) =>
      setter((prev) => {
        const mutable = new Set(prev)
        if (next) mutable.add(id)
        else mutable.delete(id)
        return mutable
      })

  const disabledCount = filter?.effectiveDisabledSources.length ?? 0

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
      {!collapsed && filter != null && (
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
              {renderGroupedRows(projectDraft, toggleInSet(setProjectDraft))}
              <button
                type="button"
                className="btn ghost sm runtime-save-btn"
                disabled={runtimeConfig.saving}
                onClick={() => void saveProjectLayer()}
              >
                <Save size={12} />
                {translate('chatInspector.pfSaveProject')}
              </button>
            </div>
          )}
          <div className="runtime-prompt-block">
            <div className="runtime-prompt-title">
              <Switch
                size="small"
                checked={sessionTakeover}
                onChange={(next) => {
                  // 开启接管时以当前生效集为草稿基线；关闭即落盘删除会话层行
                  //（若只改本地态，保存按钮随接管区隐藏、删行路径不可达）。
                  if (next) {
                    setSessionDraft(new Set(filter.effectiveDisabledSources))
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
                {renderGroupedRows(sessionDraft, toggleInSet(setSessionDraft))}
                <button
                  type="button"
                  className="btn ghost sm runtime-save-btn"
                  disabled={runtimeConfig.saving}
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
                {/* 防御：开关关闭即删行，正常流不显示；外部写入导致 DB 仍有会话层
                    行时，提供显式恢复入口（与本地面板一致）。 */}
                {filter.session.configured && (
                  <button
                    type="button"
                    className="btn ghost sm runtime-save-btn"
                    disabled={runtimeConfig.saving}
                    onClick={() => void deleteSessionLayer()}
                  >
                    {translate('chatInspector.pfRestore')}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
