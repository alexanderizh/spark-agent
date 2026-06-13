import { useEffect, useState } from 'react'
import { Modal, Button, Input } from '@lobehub/ui'

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
      open={open}
      onCancel={() => onOpenChange(false)}
      title={title}
      footer={null}
      width={440}
      className="spark-confirm-dialog"
    >
      {description != null ? <p>{description}</p> : null}
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button onClick={() => onOpenChange(false)}>{cancelText}</Button>
        <Button
          type="primary"
          onClick={() => {
            void onConfirm(draft)
            onOpenChange(false)
          }}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  )
}
