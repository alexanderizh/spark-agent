import { useMemo, useState } from 'react'
import { Modal, Checkbox, Input, Button, Tag, Tooltip, Empty } from '@arco-design/web-react'
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
  onClose: () => void
}

type StatusFilter = 'all' | 'enabled' | 'disabled'

export function SkillsPickerModal({
  visible,
  skills,
  selectedIds,
  onChange,
  onClose,
}: SkillsPickerModalProps) {
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const counts = useMemo(() => {
    const enabled = skills.filter((s) => s.enabled).length
    return { all: skills.length, enabled, disabled: skills.length - enabled }
  }, [skills])

  const filteredSkills = useMemo(() => {
    const lower = searchText.trim().toLowerCase()
    return skills.filter((s) => {
      if (statusFilter === 'enabled' && !s.enabled) return false
      if (statusFilter === 'disabled' && s.enabled) return false
      if (lower && !s.name.toLowerCase().includes(lower)) return false
      return true
    })
  }, [skills, searchText, statusFilter])

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
      visible={visible}
      title={null}
      closable={false}
      onCancel={onClose}
      footer={null}
      className="skills-picker-modal"
      style={{ width: 720 }}
      autoFocus={false}
      focusLock={false}
      unmountOnExit
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
        <Input.Search
          className="skills-picker-search"
          placeholder="搜索 Skills..."
          value={searchText}
          onChange={setSearchText}
          allowClear
          size="small"
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
            aria-selected={statusFilter === 'enabled'}
            className={`skills-picker-tab ${statusFilter === 'enabled' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('enabled')}
          >
            <span className="skills-picker-dot skills-picker-dot--green" />
            启用 <span className="skills-picker-tab-count">{counts.enabled}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'disabled'}
            className={`skills-picker-tab ${statusFilter === 'disabled' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('disabled')}
          >
            <span className="skills-picker-dot skills-picker-dot--gray" />
            停用 <span className="skills-picker-tab-count">{counts.disabled}</span>
          </button>
        </div>
      </div>

      <div className="skills-picker-table-wrap">
        <div className="skills-picker-table-head" role="row">
          <div className="skills-picker-cell skills-picker-cell--checkbox">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={handleSelectAll}
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
                      onChange={(v) => handleSelect(skill.id, v)}
                    />
                  </div>
                  <div className="skills-picker-cell skills-picker-cell--name">
                    <Tooltip content={skill.name} disabled={skill.name.length <= 24}>
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
          <Tag color="arcoblue" size="small">
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
            type="secondary"
            size="small"
            disabled={selectedIds.length === 0}
            onClick={() => onChange([])}
          >
            清空
          </Button>
          <Button type="primary" size="small" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </Modal>
  )
}
