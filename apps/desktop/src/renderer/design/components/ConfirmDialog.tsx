import { Modal, Button } from 'antd'

type ConfirmDialogProps = {
  open: boolean
  title: string
  description?: string | undefined
  confirmText?: string | undefined
  cancelText?: string | undefined
  danger?: boolean | undefined
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  danger,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button onClick={() => onOpenChange(false)}>{cancelText}</Button>
        <Button
          type="primary"
          danger={danger ?? false}
          onClick={() => {
            void onConfirm()
            onOpenChange(false)
          }}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  )
}
