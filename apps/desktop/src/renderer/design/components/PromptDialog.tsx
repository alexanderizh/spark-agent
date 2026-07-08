import { useEffect, useState } from 'react'
import { Modal, Input } from '@lobehub/ui'

type PromptDialogProps = {
  open: boolean
  title: string
  description?: string | undefined
  value?: string | undefined
  placeholder?: string | undefined
  confirmText?: string | undefined
  cancelText?: string | undefined
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
  onOpenChange,
  onConfirm,
}: PromptDialogProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => setDraft(value), 0)
    return () => window.clearTimeout(id)
  }, [open, value])

  return (
    <Modal
      centered
      open={open}
      title={title}
      width={440}
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
    </Modal>
  )
}
