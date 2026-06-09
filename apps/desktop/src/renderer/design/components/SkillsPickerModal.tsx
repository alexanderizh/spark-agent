import { useMemo, useState } from 'react'
import { Modal, Table, Checkbox, Input, Button, Tag } from '@arco-design/web-react'
import type { TableColumnProps } from '@arco-design/web-react'
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

export function SkillsPickerModal({
  visible,
  skills,
  selectedIds,
  onChange,
  onClose,
}: SkillsPickerModalProps) {
  const [searchText, setSearchText] = useState('')
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const filteredSkills = useMemo(() => {
    if (!searchText.trim()) return skills
    const lower = searchText.toLowerCase()
    return skills.filter((s) => s.name.toLowerCase().includes(lower))
  }, [skills, searchText])

  const handleSelect = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...selectedIds, id])
    } else {
      onChange(selectedIds.filter((sid) => sid !== id))
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onChange(filteredSkills.map((s) => s.id))
    } else {
      onChange([])
    }
  }

  const allSelected = filteredSkills.length > 0 && filteredSkills.every((s) => selectedSet.has(s.id))
  const someSelected = filteredSkills.some((s) => selectedSet.has(s.id)) && !allSelected

  const columns: TableColumnProps<SkillItemForPicker>[] = [
    {
      title: (
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={handleSelectAll}
        />
      ),
      dataIndex: 'checkbox',
      width: 48,
      align: 'center',
      render: (_, record) => (
        <Checkbox
          checked={selectedSet.has(record.id)}
          onChange={(checked) => handleSelect(record.id, checked)}
        />
      ),
    },
    {
      title: '名称',
      dataIndex: 'name',
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      align: 'center',
      render: (enabled: boolean) => (
        <Tag color={enabled ? 'green' : 'gray'} size="small">
          {enabled ? '启用' : '停用'}
        </Tag>
      ),
    },
  ]

  return (
    <Modal
      visible={visible}
      title={null}
      closable={false}
      onCancel={onClose}
      footer={
        <div className="skills-picker-footer">
          <Tag color="arcoblue" size="small">{selectedIds.length} 已选</Tag>
          <Button type="secondary" size="small" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
      className="skills-picker-modal"
      style={{ width: 560 }}
      autoFocus={false}
      focusLock={false}
      unmountOnExit
    >
      <div className="skills-picker-header">
        <div className="skills-picker-title">
          <Icons.Skills size={16} />
          <span>配置 Skills</span>
        </div>
        <Input.Search
          className="skills-picker-search"
          placeholder="搜索 Skills..."
          value={searchText}
          onChange={setSearchText}
          allowClear
          size="small"
        />
        <button className="skills-picker-close-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="skills-picker-table-wrap">
        <Table
          data={filteredSkills}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
          border={{
            wrapper: true,
            cell: true,
          }}
        />
      </div>
    </Modal>
  )
}
