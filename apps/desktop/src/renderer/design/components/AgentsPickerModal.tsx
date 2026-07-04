import { useMemo, useState } from 'react'
import { Modal, Checkbox, Button, Tag, Tooltip, Empty } from '@lobehub/ui'
import { Input as AntdInput } from 'antd'
import { Icons } from '../Icons'
import { AvatarImage } from './AvatarImage'
import './AgentsPickerModal.less'

export interface AgentItemForPicker {
  id: string
  name: string
  /** 头像地址（由调用方用 resolveAvatarSrc(getAgentAvatarConfig(...)) 预解析） */
  avatarSrc: string
  builtIn?: boolean
  enabled?: boolean
}

export interface AgentsPickerModalProps {
  visible: boolean
  /** 当前要分发的 Skill 名称，用于标题展示 */
  skillName: string
  agents: AgentItemForPicker[]
  /** 已分发该 Skill 的 Agent ids（预勾选） */
  selectedIds: string[]
  onChange: (ids: string[]) => void
  /** 确认提交（点击「完成」） */
  onConfirm: () => void
  /** 取消/关闭 */
  onClose: () => void
}

type StatusFilter = 'all' | 'configured' | 'unconfigured'

/**
 * AgentsPickerModal —— 把一个 Skill 分发给多个 Agent。
 * 结构对称于 SkillsPickerModal（方向相反：此处选 Agent，而非选 Skill）。
 */
export function AgentsPickerModal({
  visible,
  skillName,
  agents,
  selectedIds,
  onChange,
  onConfirm,
  onClose,
}: AgentsPickerModalProps) {
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // 内置 Agent 置顶,其余按中文/英文名称升序
  const sortedAgents = useMemo(
    () =>
      [...agents].sort((a, b) => {
        if (a.builtIn && !b.builtIn) return -1
        if (!a.builtIn && b.builtIn) return 1
        return a.name.localeCompare(b.name, 'zh-CN')
      }),
    [agents],
  )

  const counts = useMemo(() => {
    const configured = sortedAgents.filter((a) => selectedSet.has(a.id)).length
    return {
      all: sortedAgents.length,
      configured,
      unconfigured: sortedAgents.length - configured,
    }
  }, [sortedAgents, selectedSet])

  const filteredAgents = useMemo(() => {
    const lower = searchText.trim().toLowerCase()
    return sortedAgents.filter((a) => {
      if (statusFilter === 'configured' && !selectedSet.has(a.id)) return false
      if (statusFilter === 'unconfigured' && selectedSet.has(a.id)) return false
      if (lower && !a.name.toLowerCase().includes(lower)) return false
      return true
    })
  }, [sortedAgents, searchText, statusFilter, selectedSet])

  const handleSelect = (id: string, checked: boolean) => {
    if (checked) onChange([...selectedIds, id])
    else onChange(selectedIds.filter((sid) => sid !== id))
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const visibleIds = filteredAgents.map((a) => a.id)
      onChange(Array.from(new Set([...selectedIds, ...visibleIds])))
    } else {
      const visibleIdSet = new Set(filteredAgents.map((a) => a.id))
      onChange(selectedIds.filter((id) => !visibleIdSet.has(id)))
    }
  }

  const allSelected = filteredAgents.length > 0 && filteredAgents.every((a) => selectedSet.has(a.id))
  const someSelected = filteredAgents.some((a) => selectedSet.has(a.id)) && !allSelected

  return (
    <Modal
      open={visible}
      title={null}
      closable={false}
      onCancel={onClose}
      footer={null}
      className="agents-picker-modal"
      style={{ width: 720 }}
      centered
      destroyOnHidden
    >
      <div className="agents-picker-header">
        <div className="agents-picker-title">
          <span>将「{skillName}」安装给 Agent</span>
          <span className="agents-picker-subtitle">选择可以使用该 Skill 的 Agent</span>
        </div>
        <button className="agents-picker-close-btn" onClick={onClose} aria-label="关闭">
          <Icons.X size={14} />
        </button>
      </div>

      <div className="agents-picker-toolbar">
        <AntdInput.Search
          className="agents-picker-search"
          placeholder="搜索 Agent..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          size="middle"
        />
        <div className="agents-picker-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'all'}
            className={`agents-picker-tab ${statusFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            全部 <span className="agents-picker-tab-count">{counts.all}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'configured'}
            className={`agents-picker-tab ${statusFilter === 'configured' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('configured')}
          >
            已分发 <span className="agents-picker-tab-count">{counts.configured}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'unconfigured'}
            className={`agents-picker-tab ${statusFilter === 'unconfigured' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('unconfigured')}
          >
            未分发 <span className="agents-picker-tab-count">{counts.unconfigured}</span>
          </button>
        </div>
      </div>

      <div className="agents-picker-table-wrap">
        <div className="agents-picker-table-head" role="row">
          <div className="agents-picker-cell agents-picker-cell--checkbox">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={(checked) => handleSelectAll(checked)}
            />
          </div>
          <div className="agents-picker-cell agents-picker-cell--name">Agent</div>
          <div className="agents-picker-cell agents-picker-cell--status">状态</div>
        </div>

        <div className="agents-picker-table-body">
          {filteredAgents.length === 0 ? (
            <div className="agents-picker-empty">
              <Empty description={searchText ? '没有匹配的 Agent' : '暂无可选 Agent'} />
            </div>
          ) : (
            filteredAgents.map((agent) => {
              const checked = selectedSet.has(agent.id)
              return (
                <div
                  key={agent.id}
                  role="row"
                  tabIndex={0}
                  className={`agents-picker-row ${checked ? 'is-checked' : ''}`}
                  onClick={() => handleSelect(agent.id, !checked)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelect(agent.id, !checked)
                    }
                  }}
                >
                  <div
                    className="agents-picker-cell agents-picker-cell--checkbox"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox checked={checked} onChange={(c) => handleSelect(agent.id, c)} />
                  </div>
                  <div className="agents-picker-cell agents-picker-cell--name">
                    <span className="agents-picker-avatar">
                      <AvatarImage
                        src={agent.avatarSrc}
                        seed={agent.id}
                        name={agent.name}
                        alt={agent.name}
                      />
                    </span>
                    <Tooltip title={agent.name}>
                      <span className="agents-picker-name-text">{agent.name}</span>
                    </Tooltip>
                    {agent.builtIn && (
                      <Tag size="middle" color="default">
                        内置
                      </Tag>
                    )}
                  </div>
                  <div className="agents-picker-cell agents-picker-cell--status">
                    {agent.enabled === false ? (
                      <span className="agents-picker-status agents-picker-status--disabled">
                        <span className="agents-picker-dot agents-picker-dot--gray" />
                        停用
                      </span>
                    ) : (
                      <span className="agents-picker-status agents-picker-status--enabled">
                        <span className="agents-picker-dot agents-picker-dot--green" />
                        启用
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="agents-picker-footer">
        <div className="agents-picker-footer-left">
          <Tag color="blue" size="middle">
            {selectedIds.length} 已选
          </Tag>
          {(searchText || statusFilter !== 'all') && (
            <span className="agents-picker-footer-hint">
              筛选结果 {filteredAgents.length} / {agents.length}
            </span>
          )}
        </div>
        <div className="agents-picker-footer-right">
          <Button
            type="text"
            size="middle"
            disabled={selectedIds.length === 0}
            onClick={() => onChange([])}
          >
            清空
          </Button>
          <Button type="primary" size="middle" onClick={onConfirm}>
            完成
          </Button>
        </div>
      </div>
    </Modal>
  )
}
