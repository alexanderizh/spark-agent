import { useState } from 'react'
import { Button, Input, Modal, TextArea } from '@lobehub/ui'
import { Icons } from '../Icons'
import './RuleCreateModal.less'

/** 对齐 protocol 层 RulesCreateRequest 的字数上限（scope 由调用方固定为 user） */
const RULE_NAME_MAX = 120
const RULE_CONTENT_MAX = 20_000
const RULE_PRIORITY_MIN = -10_000
const RULE_PRIORITY_MAX = 10_000

export interface RuleCreateSubmitInput {
  name: string
  content: string
  priority: number
}

export interface RuleCreateModalProps {
  visible: boolean
  onClose: () => void
  /** 创建规则（调用 rules:create）。异常时弹窗内展示错误并保持打开。 */
  onSubmit: (input: RuleCreateSubmitInput) => Promise<void>
}

/**
 * Agent 编辑面板「新增规则」弹窗：字段对齐设置页规则表单（名称 / 优先级 / 内容）。
 * 创建走 user 作用域（个人规则随处可用；system 只读、project 需绑定工作区，
 * 都不适合从 Agent 编辑器里建）。成功后由调用方刷新列表并自动勾选进草稿。
 */
export function RuleCreateModal({ visible, onClose, onSubmit }: RuleCreateModalProps) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [priority, setPriority] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    const trimmedName = name.trim()
    const trimmedContent = content.trim()
    if (!trimmedName || !trimmedContent) {
      setError('名称和内容不能为空')
      return
    }
    if (
      !Number.isInteger(priority) ||
      priority < RULE_PRIORITY_MIN ||
      priority > RULE_PRIORITY_MAX
    ) {
      setError(`优先级需为 ${RULE_PRIORITY_MIN} ~ ${RULE_PRIORITY_MAX} 的整数`)
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSubmit({ name: trimmedName, content: trimmedContent, priority })
      // 成功后复位表单：本组件常驻（visible 只控制显隐，destroyOnHidden 重置不了
      // 这里的 useState），不清理会让下次打开残留旧值且 saving 锁死全部控件。
      setName('')
      setContent('')
      setPriority(0)
      setSaving(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建规则失败')
      setSaving(false)
    }
  }

  return (
    <Modal
      open={visible}
      title={null}
      closable={false}
      onCancel={() => {
        if (!saving) onClose()
      }}
      footer={null}
      className="rule-create-modal"
      style={{ width: 560 }}
      centered
      destroyOnHidden
    >
      <div className="rule-create-header">
        <div className="rule-create-title">
          <span>新增规则</span>
          <span className="rule-create-subtitle">
            user 作用域 · prompt 片段 · 创建后自动勾选到当前 Agent
          </span>
        </div>
        <button
          type="button"
          className="rule-create-close-btn"
          onClick={onClose}
          disabled={saving}
          aria-label="关闭新增规则弹窗"
        >
          <Icons.X size={14} />
        </button>
      </div>

      <div className="rule-create-body">
        {error && <div className="rule-create-error">{error}</div>}

        <label className="rule-create-field">
          <span>
            名称<span className="rule-create-field-sub">（必填）</span>
          </span>
          <Input
            value={name}
            maxLength={RULE_NAME_MAX}
            placeholder="例：文档规范"
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
        </label>

        <label className="rule-create-field">
          <span>
            优先级<span className="rule-create-field-sub">数字越大越优先</span>
          </span>
          <Input
            type="number"
            value={priority}
            onChange={(e) => {
              const next = Number(e.target.value)
              setPriority(Number.isNaN(next) ? 0 : Math.trunc(next))
            }}
            disabled={saving}
          />
        </label>

        <label className="rule-create-field">
          <span>
            内容<span className="rule-create-field-sub">（必填）</span>
          </span>
          <TextArea
            value={content}
            rows={6}
            maxLength={RULE_CONTENT_MAX}
            placeholder="输入要注入到 Agent prompt 的规则内容"
            onChange={(e) => setContent(e.target.value)}
            disabled={saving}
          />
        </label>
      </div>

      <div className="rule-create-footer">
        <span className="rule-create-footer-hint">创建后可在 设置 → 规则 中编辑或停用</span>
        <Button type="text" size="middle" onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button
          type="primary"
          size="middle"
          icon={<Icons.Check size={13} />}
          loading={saving}
          disabled={saving}
          onClick={handleSubmit}
        >
          创建并勾选
        </Button>
      </div>
    </Modal>
  )
}
