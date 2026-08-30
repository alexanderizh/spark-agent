import { useCallback } from 'react'
import { Modal } from 'antd'

/** 大型画布弹窗统一的未保存离开阻拦。 */
export function useCanvasUnsavedChangesGuard(input: {
  dirty: boolean
  onClose: () => void
  subject: string
}) {
  return useCallback(() => {
    if (!input.dirty) {
      input.onClose()
      return
    }
    Modal.confirm({
      title: `放弃未保存的${input.subject}更改？`,
      content: '当前修改尚未保存。离开后这些内容无法恢复。',
      okText: '放弃并离开',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      centered: true,
      onOk: input.onClose,
    })
  }, [input.dirty, input.onClose, input.subject])
}
