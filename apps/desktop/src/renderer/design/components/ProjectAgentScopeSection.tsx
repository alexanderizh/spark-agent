/**
 * ProjectAgentScopeSection — 会话配置面板中的「项目 Agent」区块。
 *
 * 两个能力（保存走 workspace:update，悬空 ID 由主进程校验）：
 * 1. 项目默认 Agent：本项目内新建会话优先使用；清除后回落全局偏好。
 * 2. 项目可用 Agent 白名单：聊天/画布选择器的过滤范围；清空即解除白名单。
 *
 * 组件自管草稿态（props 变化时同步），显式点击「保存项目」才落盘。
 * 表单控件统一用 @lobehub/ui（Select/Input/Checkbox/Tag/Button），
 * 与 TeamInspectorSection / AgentsPickerModal 保持同一设计语言；
 * 主题由 LobeThemeProvider 桥接，暗色模式自动正确。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button as LobeButton,
  Checkbox as LobeCheckbox,
  Input as LobeInput,
  Select as LobeSelect,
  Tag as LobeTag,
} from '@lobehub/ui'
import { Save } from 'lucide-react'
import { Icons } from '../Icons'
import { translate, useI18n } from '../i18n'
import { useIpcInvoke } from '../hooks/useIpc'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useToast } from './Toast'
import { deriveTeamAvatar } from '../teamAvatar'
import { getAgentAvatarConfig, resolveAvatarSrc } from '../avatar'
import { AvatarImage } from './AvatarImage'
import type { ManagedAgent } from '@spark/protocol'
import './ProjectAgentScopeSection.less'

export interface ProjectAgentScopeSectionProps {
  workspaceId: string
  /** 全量 Agent 候选（SessionSidebarContext.agents，默认仅启用项） */
  agents: ManagedAgent[]
  /** workspace.defaultAgentId：null/undefined = 未设置（回落全局偏好） */
  defaultAgentId?: string | null | undefined
  /** workspace.allowedAgentIds：null/空数组 = 未绑定白名单（全部可用） */
  allowedAgentIds?: string[] | null | undefined
}

function AgentAvatar({
  id,
  name,
  metadata,
}: {
  id: string
  name: string
  metadata?: Record<string, unknown>
}) {
  const accent = deriveTeamAvatar(id, name).color
  const src = resolveAvatarSrc(getAgentAvatarConfig(metadata, id, name))
  return (
    <span className="project-scope-avatar" style={{ ['--member-accent' as string]: accent }}>
      <AvatarImage src={src} seed={id} name={name} />
    </span>
  )
}

export function ProjectAgentScopeSection({
  workspaceId,
  agents,
  defaultAgentId,
  allowedAgentIds,
}: ProjectAgentScopeSectionProps) {
  // 非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const { toast } = useToast()
  const { invoke: updateWorkspace } = useIpcInvoke('workspace:update')
  const { refreshData } = useSessionSidebar()

  const [defaultAgentDraft, setDefaultAgentDraft] = useState(defaultAgentId ?? '')
  const [allowedDrafts, setAllowedDrafts] = useState<Set<string>>(
    () => new Set(allowedAgentIds ?? []),
  )
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)

  // workspace 变化（含保存后 refreshData 重拉）时同步草稿。
  // 注意：agents 不进依赖——后台刷新列表不应打断用户未保存的编辑。
  useEffect(() => {
    setDefaultAgentDraft(defaultAgentId ?? '')
    setAllowedDrafts(new Set(allowedAgentIds ?? []))
  }, [workspaceId, defaultAgentId, allowedAgentIds])

  const agentOptions = useMemo(
    () => agents.map((agent) => ({ label: agent.name, value: agent.id })),
    [agents],
  )

  const normalizedFilter = filter.trim().toLowerCase()
  // 白名单列表视图：按名称过滤 + 已选置顶，Agent 多时便于查找
  const visibleAgents = useMemo(() => {
    const filtered = agents.filter(
      (agent) => normalizedFilter === '' || agent.name.toLowerCase().includes(normalizedFilter),
    )
    return filtered.sort(
      (a, b) => Number(allowedDrafts.has(b.id)) - Number(allowedDrafts.has(a.id)),
    )
  }, [agents, normalizedFilter, allowedDrafts])

  const allVisibleSelected =
    visibleAgents.length > 0 && visibleAgents.every((agent) => allowedDrafts.has(agent.id))
  const someVisibleSelected =
    visibleAgents.some((agent) => allowedDrafts.has(agent.id)) && !allVisibleSelected

  const toggleAgent = useCallback((id: string) => {
    setAllowedDrafts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 全选/取消全选只作用于当前过滤视图（与 AgentsPickerModal 一致），不吞掉视图外的已选
  const toggleAllVisible = useCallback(
    (checked: boolean) => {
      setAllowedDrafts((prev) => {
        const next = new Set(prev)
        for (const agent of visibleAgents) {
          if (checked) next.add(agent.id)
          else next.delete(agent.id)
        }
        return next
      })
    },
    [visibleAgents],
  )

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await updateWorkspace({
        workspaceId,
        // '' 归一化为清除（null）；主进程写入前校验 Agent 存在性
        defaultAgentId: defaultAgentDraft !== '' ? defaultAgentDraft : null,
        allowedAgentIds: allowedDrafts.size > 0 ? Array.from(allowedDrafts) : null,
      })
      await refreshData()
      toast.success(translate('chatInspector.t3Desc'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('chatInspector.t4Desc'))
    } finally {
      setSaving(false)
    }
  }, [workspaceId, defaultAgentDraft, allowedDrafts, updateWorkspace, refreshData, toast])

  return (
    <div className="project-scope">
      {/* 项目默认 Agent */}
      <div className="project-scope-field">
        <div className="project-scope-field-title">{translate('chatInspector.t52')}</div>
        <div className="session-panel-caption">{translate('chatInspector.t67Desc')}</div>
        <LobeSelect
          className="project-scope-default-select"
          size="small"
          showSearch
          allowClear
          aria-label={translate('chatInspector.t52')}
          placeholder={translate('chatInspector.t68')}
          value={defaultAgentDraft !== '' ? defaultAgentDraft : undefined}
          onChange={(value) => setDefaultAgentDraft(typeof value === 'string' ? value : '')}
          options={agentOptions}
          optionFilterProp="label"
        />
      </div>

      {/* 项目可用 Agent（白名单） */}
      <div className="project-scope-field">
        <div className="project-scope-field-head">
          <span className="project-scope-field-title">{translate('chatInspector.t69')}</span>
          <span className="project-scope-count">
            {allowedDrafts.size > 0
              ? translate('chatInspector.t119Desc', {
                  selected: allowedDrafts.size,
                  total: agents.length,
                })
              : translate('chatInspector.t120Desc', { total: agents.length })}
          </span>
        </div>
        <div className="project-scope-toolbar">
          <LobeInput
            className="project-scope-search"
            size="small"
            allowClear
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={translate('chatInspector.t116Desc', { count: agents.length })}
            prefix={<Icons.Search size={12} />}
            aria-label={translate('chatInspector.t53')}
          />
          <LobeButton
            size="small"
            disabled={allowedDrafts.size === 0}
            onClick={() => setAllowedDrafts(new Set())}
          >
            {translate('chatInspector.t70')}
          </LobeButton>
        </div>
        {visibleAgents.length > 0 ? (
          <div className="project-scope-list">
            <div
              className="project-scope-option project-scope-option--head"
              onClick={() => toggleAllVisible(!allVisibleSelected)}
            >
              <span className="project-scope-check" onClick={(event) => event.stopPropagation()}>
                <LobeCheckbox
                  checked={allVisibleSelected}
                  indeterminate={someVisibleSelected}
                  onChange={toggleAllVisible}
                />
              </span>
              <span className="project-scope-option-name">{translate('chatInspector.t117')}</span>
            </div>
            {visibleAgents.map((agent) => {
              const checked = allowedDrafts.has(agent.id)
              return (
                <div
                  key={agent.id}
                  role="row"
                  tabIndex={0}
                  className={`project-scope-option ${checked ? 'is-checked' : ''}`}
                  onClick={() => toggleAgent(agent.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleAgent(agent.id)
                    }
                  }}
                >
                  <span
                    className="project-scope-check"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <LobeCheckbox checked={checked} onChange={() => toggleAgent(agent.id)} />
                  </span>
                  <AgentAvatar id={agent.id} name={agent.name} metadata={agent.metadata} />
                  <span
                    className="project-scope-option-name"
                    title={agent.description.trim().length > 0 ? agent.description : agent.name}
                  >
                    {agent.name}
                  </span>
                  {agent.builtIn ? (
                    <LobeTag size="small" color="default">
                      {translate('chatInspector.t71')}
                    </LobeTag>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="project-scope-empty">
            {translate('chatInspector.t118Desc', { query: filter.trim() })}
          </div>
        )}
      </div>

      <LobeButton
        className="project-scope-save"
        block
        size="small"
        icon={<Save size={12} />}
        loading={saving}
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {translate('chatInspector.t15')}
      </LobeButton>
    </div>
  )
}
