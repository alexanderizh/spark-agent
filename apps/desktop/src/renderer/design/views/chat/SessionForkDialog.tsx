import { useState } from 'react'
import { Modal } from 'antd'
import { Icons } from '../../Icons'
import './SessionForkDialog.less'

interface SessionForkDialogProps {
  open: boolean
  sourceTitle: string
  turnOrdinal?: number
  onCancel: () => void
  onConfirm: (title: string) => Promise<boolean>
}

export function SessionForkDialog({
  open,
  sourceTitle,
  turnOrdinal,
  onCancel,
  onConfirm,
}: SessionForkDialogProps) {
  const fallbackTitle = `${sourceTitle.trim() || '新会话'} · 分支`
  const [title, setTitle] = useState(fallbackTitle)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const created = await onConfirm(title.trim() || fallbackTitle)
      if (!created) return
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="从此处分支"
      footer={null}
      width={460}
      destroyOnHidden
      onCancel={() => {
        if (!submitting) onCancel()
      }}
    >
      <div className="session-fork-dialog">
        <div className="session-fork-dialog-summary">
          <span className="session-fork-dialog-icon" aria-hidden="true">
            <Icons.GitBranch size={18} />
          </span>
          <div>
            <strong>创建一个独立会话副本</strong>
            <p>
              将复制《{sourceTitle || '未命名会话'}》从开始到
              {turnOrdinal != null ? `第 ${turnOrdinal} 轮` : '此处'}的已完成历史。
            </p>
          </div>
        </div>
        <label className="session-fork-dialog-label" htmlFor="session-fork-title">
          新会话标题
        </label>
        <input
          id="session-fork-title"
          className="session-fork-dialog-input"
          value={title}
          maxLength={200}
          autoFocus
          disabled={submitting}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className="session-fork-dialog-hint">
          新会话会继承当前会话的工作区和运行配置，但不会继续源会话正在执行的任务。
        </div>
        <div className="session-fork-dialog-actions">
          <button
            type="button"
            className="session-fork-dialog-button ghost"
            disabled={submitting}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="session-fork-dialog-button primary"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? <Icons.Spinner size={13} /> : <Icons.GitBranch size={13} />}
            复制会话
          </button>
        </div>
      </div>
    </Modal>
  )
}
