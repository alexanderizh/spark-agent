import { useMemo, useState } from 'react'
import { Modal, Checkbox, Button, Tag, Tooltip, Empty } from '@lobehub/ui'
import { Input as AntdInput } from 'antd'
import { Icons } from '../Icons'
import './SkillsPickerModal.less'

export interface SkillItemForPicker {
  id: string
  name: string
  enabled?: boolean
}

export interface SkillsPickerModalProps {
  visible: boolean
  skills: SkillItemForPicker[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  /** 确认提交（点击「完成」）。提交当前已选内容。 */
  onConfirm: () => void
  /** 取消/关闭（点击 X、遮罩、Esc）。不提交。 */
  onClose: () => void
}

type StatusFilter = 'all' | 'configured' | 'unconfigured'

export function SkillsPickerModal({
  visible,
  skills,
  selectedIds,
  onChange,
  onConfirm,
  onClose,
}: SkillsPickerModalProps) {
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const counts = useMemo(() => {
    const configured = skills.filter((s) => selectedSet.has(s.id)).length
    return {
      all: skills.length,
      configured,
      unconfigured: skills.length - configured,
    }
  }, [skills, selectedSet])

  const filteredSkills = useMemo(() => {
    const lower = searchText.trim().toLowerCase()
    return skills.filter((s) => {
      if (statusFilter === 'configured' && !selectedSet.has(s.id)) return false
      if (statusFilter === 'unconfigured' && selectedSet.has(s.id)) return false
      if (lower && !s.name.toLowerCase().includes(lower)) return false
      return true
    })
  }, [skills, searchText, statusFilter, selectedSet])

  const handleSelect = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...selectedIds, id])
    } else {
      onChange(selectedIds.filter((sid) => sid !== id))
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // 合并当前可见 + 已选（保留搜索外的选中）
      const visibleIds = filteredSkills.map((s) => s.id)
      const merged = Array.from(new Set([...selectedIds, ...visibleIds]))
      onChange(merged)
    } else {
      // 只取消当前可见的
      const visibleIdSet = new Set(filteredSkills.map((s) => s.id))
      onChange(selectedIds.filter((id) => !visibleIdSet.has(id)))
    }
  }

  const allSelected = filteredSkills.length > 0 && filteredSkills.every((s) => selectedSet.has(s.id))
  const someSelected = filteredSkills.some((s) => selectedSet.has(s.id)) && !allSelected

  return (
    <Modal
      open={visible}
      title={null}
      closable={false}
      onCancel={onClose}
      footer={null}
      className="skills-picker-modal"
      style={{ width: 720 }}
      centered
      destroyOnHidden
    >
      <div className="skills-picker-header">
        <div className="skills-picker-title">
          <span>配置 Skills</span>
          <span className="skills-picker-subtitle">为当前会话选择可用的 Skills</span>
        </div>
        <button className="skills-picker-close-btn" onClick={onClose} aria-label="关闭">
          <Icons.X size={14} />
        </button>
      </div>

      <div className="skills-picker-toolbar">
        <AntdInput.Search
          className="skills-picker-search"
          placeholder="搜索 Skills..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          size="middle"
        />
        <div className="skills-picker-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'all'}
            className={`skills-picker-tab ${statusFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            全部 <span className="skills-picker-tab-count">{counts.all}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'configured'}
            className={`skills-picker-tab ${statusFilter === 'configured' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('configured')}
          >
            已配置 <span className="skills-picker-tab-count">{counts.configured}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'unconfigured'}
            className={`skills-picker-tab ${statusFilter === 'unconfigured' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('unconfigured')}
          >
            未配置 <span className="skills-picker-tab-count">{counts.unconfigured}</span>
          </button>
        </div>
      </div>

      <div className="skills-picker-table-wrap">
        <div className="skills-picker-table-head" role="row">
          <div className="skills-picker-cell skills-picker-cell--checkbox">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={(checked) => handleSelectAll(checked)}
            />
          </div>
          <div className="skills-picker-cell skills-picker-cell--name">名称</div>
          <div className="skills-picker-cell skills-picker-cell--status">状态</div>
        </div>

        <div className="skills-picker-table-body">
          {filteredSkills.length === 0 ? (
            <div className="skills-picker-empty">
              <Empty description={searchText ? '没有匹配的 Skills' : '暂无可选 Skills'} />
            </div>
          ) : (
            filteredSkills.map((skill) => {
              const checked = selectedSet.has(skill.id)
              return (
                <div
                  key={skill.id}
                  role="row"
                  className={`skills-picker-row ${checked ? 'is-checked' : ''}`}
                  onClick={() => handleSelect(skill.id, !checked)}
                >
                  <div
                    className="skills-picker-cell skills-picker-cell--checkbox"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={(c) => handleSelect(skill.id, c)}
                    />
                  </div>
                  <div className="skills-picker-cell skills-picker-cell--name">
                    <Tooltip title={skill.name}>
                      <span className="skills-picker-name-text">{skill.name}</span>
                    </Tooltip>
                  </div>
                  <div className="skills-picker-cell skills-picker-cell--status">
                    {skill.enabled ? (
                      <span className="skills-picker-status skills-picker-status--enabled">
                        <span className="skills-picker-dot skills-picker-dot--green" />
                        启用
                      </span>
                    ) : (
                      <span className="skills-picker-status skills-picker-status--disabled">
                        <span className="skills-picker-dot skills-picker-dot--gray" />
                        停用
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="skills-picker-footer">
        <div className="skills-picker-footer-left">
          <Tag color="blue" size="middle">
            {selectedIds.length} 已选
          </Tag>
          {(searchText || statusFilter !== 'all') && (
            <span className="skills-picker-footer-hint">
              筛选结果 {filteredSkills.length} / {skills.length}
            </span>
          )}
        </div>
        <div className="skills-picker-footer-right">
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
