import { useEffect, useState } from 'react'
import { Modal, Input, Button } from '@lobehub/ui'
import { GLOBAL_DIALOG_Z_INDEX } from './dialogZIndex'

/** 弹窗内的附加动作（如重命名弹窗的「提取标题」）：渲染在输入框下方左侧。 */
export type PromptDialogExtraAction = {
  label: string
  /** 执行动作并返回要回填到输入框的内容；null 表示失败（错误提示由调用方负责）。 */
  run: () => Promise<string | null>
}

type PromptDialogProps = {
  open: boolean
  title: string
  description?: string | undefined
  value?: string | undefined
  placeholder?: string | undefined
  confirmText?: string | undefined
  cancelText?: string | undefined
  extraAction?: PromptDialogExtraAction | undefined
  onOpenChange: (open: boolean) => void
  onConfirm: (value: string) => void | Promise<void>
}

export function PromptDialog({
  open,
  title,
  description,
  value = '',
  placeholder,
  confirmText = '确定',
  cancelText = '取消',
  extraAction,
  onOpenChange,
  onConfirm,
}: PromptDialogProps) {
  const [draft, setDraft] = useState(value)
  const [extraRunning, setExtraRunning] = useState(false)

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => setDraft(value), 0)
    return () => window.clearTimeout(id)
  }, [open, value])

  const handleExtraAction = async () => {
    if (extraAction == null || extraRunning) return
    setExtraRunning(true)
    try {
      const filled = await extraAction.run()
      const trimmed = filled?.trim() ?? ''
      if (trimmed.length > 0) setDraft(trimmed)
    } finally {
      setExtraRunning(false)
    }
  }

  return (
    <Modal
      centered
      open={open}
      title={title}
      width={440}
      zIndex={GLOBAL_DIALOG_Z_INDEX}
      okText={confirmText}
      cancelText={cancelText}
      onCancel={() => onOpenChange(false)}
      onOk={() => {
        void onConfirm(draft)
        onOpenChange(false)
      }}
      className="spark-confirm-dialog"
    >
      {description != null ? <div style={{ marginBottom: 12 }}>{description}</div> : null}
      <Input
        value={draft}
        placeholder={placeholder ?? ''}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            void onConfirm(draft)
            onOpenChange(false)
          }
        }}
      />
      {extraAction != null ? (
        <div style={{ marginTop: 4 }}>
          <Button
            type="text"
            size="small"
            style={{ color: 'var(--primary)', paddingInline: 12 }}
            loading={extraRunning}
            onClick={() => void handleExtraAction()}
          >
            {extraAction.label}
          </Button>
        </div>
      ) : null}
    </Modal>
  )
}
