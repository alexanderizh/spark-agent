import { Modal } from 'antd'
import { CanvasPromptLibraryPanel, type CanvasPromptLibraryEntry } from './CanvasPromptLibraryPanel'
import { resolvePromptQuickUseAction } from './canvasPromptLibraryQuickUse'
import type { CanvasAsset } from './canvas.types'
import './canvas-prompt-library.less'

export function CanvasPromptLibraryQuickUseModal({
  open,
  assets,
  selectedNodeCount,
  onClose,
  onApply,
}: {
  open: boolean
  assets: CanvasAsset[]
  selectedNodeCount: number
  onClose: () => void
  onApply: (entry: CanvasPromptLibraryEntry) => Promise<boolean>
}) {
  const action = resolvePromptQuickUseAction(selectedNodeCount)
  const selectionHint =
    action === 'apply-to-selection'
      ? `将应用到 ${selectedNodeCount} 个选中节点旁`
      : '将插入到当前视口'

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      centered
      destroyOnHidden
      className="canvas-prompt-quick-use-modal"
      title={
        <div className="canvas-prompt-quick-use-title">
          <div>
            <strong>使用提示词</strong>
            <span>{selectionHint}</span>
          </div>
          <kbd>⌘ / Ctrl + T</kbd>
        </div>
      }
    >
      <CanvasPromptLibraryPanel
        assets={assets}
        title="提示词库"
        subtitle="搜索后直接应用或复制"
        placeholder="搜索提示词、镜头、动作…"
        className="canvas-prompt-quick-use-panel"
        showSystemPromptFilter
        getApplyLabel={() => (action === 'apply-to-selection' ? '应用' : '插入')}
        onApply={async (entry) => {
          const applied = await onApply(entry)
          if (applied) onClose()
        }}
      />
    </Modal>
  )
}
