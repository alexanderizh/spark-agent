import { useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@spark/ui-kit'
import { SparkInput } from './FormControls'

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="spark-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description != null
            ? <DialogDescription>{description}</DialogDescription>
            : <DialogDescription className="sr-only">请输入内容并确认。</DialogDescription>}
        </DialogHeader>
        <SparkInput
          value={draft}
          placeholder={placeholder}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void onConfirm(draft)
              onOpenChange(false)
            }
          }}
        />
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void onConfirm(draft)
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
