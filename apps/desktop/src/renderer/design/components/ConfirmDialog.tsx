import { Modal } from '@lobehub/ui'

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
      centered
      open={open}
      title={title}
      width={440}
      okText={confirmText}
      cancelText={cancelText}
      okButtonProps={{ danger: danger ?? false }}
      onCancel={() => onOpenChange(false)}
      onOk={() => {
        void onConfirm()
        onOpenChange(false)
      }}
      className="spark-confirm-dialog"
    >
      {description != null ? <div>{description}</div> : null}
    </Modal>
  )
}
