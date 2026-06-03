import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@spark/ui-kit'

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="spark-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description != null
            ? <DialogDescription>{description}</DialogDescription>
            : <DialogDescription className="sr-only">请确认是否继续执行此操作。</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            size="sm"
            onClick={() => {
              void onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
