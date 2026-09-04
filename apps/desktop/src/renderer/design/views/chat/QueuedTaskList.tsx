import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import type { SessionQueuePauseState } from '@spark/protocol'
import type { QueuedMessage } from './ChatComposerTypes'
import { Icons } from '../../Icons'
import './QueuedTaskList.less'

type QueuedTaskListProps = {
  messages: readonly QueuedMessage[]
  clearing: boolean
  reordering: boolean
  paused: SessionQueuePauseState | null
  recovering: 'retry' | 'resume' | null
  canRetry: boolean
  onClear: () => void
  onRetry: () => void
  onResume: () => void
  onEdit: (message: QueuedMessage) => void
  onSendNow: (message: QueuedMessage) => void
  onRemove: (message: QueuedMessage) => void
  onReorder: (turnIds: readonly string[]) => void | Promise<void>
}

type SortableQueuedTaskProps = {
  message: QueuedMessage
  disabled: boolean
  onEdit: (message: QueuedMessage) => void
  onSendNow: (message: QueuedMessage) => void
  onRemove: (message: QueuedMessage) => void
}

function SortableQueuedTask({
  message,
  disabled,
  onEdit,
  onSendNow,
  onRemove,
}: SortableQueuedTaskProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: message.turnId, disabled })
  const effectiveProviderProfileId =
    message.runtime?.cliSparkOverride?.providerProfileId ?? message.runtime?.providerProfileId
  const effectiveModelId = message.runtime?.cliSparkOverride?.modelId ?? message.runtime?.modelId

  return (
    <div
      ref={setNodeRef}
      className={`composer-queue-item${isDragging ? ' is-dragging' : ''}${
        isOver && !isDragging ? ' is-drop-target' : ''
      }`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="composer-queue-drag-handle"
        aria-label="拖动调整任务顺序"
        title="拖动调整任务顺序"
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <Icons.GripVertical size={14} />
      </button>
      <div className="composer-queue-copy">
        <span className="composer-queue-text">{message.content}</span>
        {effectiveModelId != null && effectiveModelId.length > 0 && (
          <span
            className="composer-queue-model"
            title={
              effectiveProviderProfileId == null
                ? `模型：${effectiveModelId}`
                : `Provider：${effectiveProviderProfileId} · 模型：${effectiveModelId}`
            }
          >
            {effectiveModelId}
          </span>
        )}
      </div>
      <div className="composer-queue-actions">
        {message.editable && (
          <button
            type="button"
            className="composer-queue-icon-btn composer-queue-edit-btn"
            title="编辑"
            aria-label="编辑排队任务"
            disabled={disabled}
            onClick={() => onEdit(message)}
          >
            <Icons.Edit size={14} />
          </button>
        )}
        <button
          type="button"
          className="composer-queue-icon-btn composer-queue-send-btn"
          title="立即执行"
          aria-label="立即执行排队任务"
          disabled={disabled}
          onClick={() => onSendNow(message)}
        >
          <Icons.Send size={14} />
        </button>
        <button
          type="button"
          className="composer-queue-icon-btn"
          title="移除"
          aria-label="移除排队任务"
          disabled={disabled}
          onClick={() => onRemove(message)}
        >
          <Icons.Trash size={14} />
        </button>
      </div>
    </div>
  )
}

export function QueuedTaskList({
  messages,
  clearing,
  reordering,
  paused,
  recovering,
  canRetry,
  onClear,
  onRetry,
  onResume,
  onEdit,
  onSendNow,
  onRemove,
  onReorder,
}: QueuedTaskListProps) {
  const disabled = clearing || reordering || recovering != null
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over == null || active.id === over.id || reordering) return
    const oldIndex = messages.findIndex((message) => message.turnId === String(active.id))
    const newIndex = messages.findIndex((message) => message.turnId === String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    void onReorder(arrayMove([...messages], oldIndex, newIndex).map((message) => message.turnId))
  }

  return (
    <div className="composer-queue-panel">
      {paused != null && (
        <div className="composer-queue-pause" role="status" aria-live="polite">
          <Icons.AlertTriangle className="composer-queue-pause-icon" size={15} />
          <span className="composer-queue-pause-copy">当前回复出错，队列已暂停（内容未丢失）</span>
          <span className="composer-queue-pause-actions">
            <button
              type="button"
              className="composer-queue-pause-action"
              disabled={disabled || !canRetry}
              title={canRetry ? '使用当前模型重试失败消息' : '失败消息无法安全还原'}
              onClick={onRetry}
            >
              {recovering === 'retry' ? '重试中…' : '重试'}
            </button>
            <button
              type="button"
              className="composer-queue-pause-action"
              disabled={disabled}
              title="跳过失败消息，并使用当前模型继续剩余队列"
              onClick={onResume}
            >
              {recovering === 'resume' ? '继续中…' : '跳过继续'}
            </button>
          </span>
        </div>
      )}
      {messages.length > 1 && (
        <div className="composer-queue-header">
          <span className="composer-queue-hint">拖动调整执行顺序</span>
          <button
            type="button"
            className="composer-queue-clear-btn"
            title="取消全部排队消息，不影响当前正在执行的任务"
            aria-label="清空队列"
            disabled={disabled}
            onClick={onClear}
          >
            <Icons.Trash size={13} />
            {clearing ? '清空中…' : '清空队列'}
          </button>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={messages.map((message) => message.turnId)}
          strategy={verticalListSortingStrategy}
        >
          <div className="composer-queue-list">
            {messages.map((message) => (
              <SortableQueuedTask
                key={message.turnId}
                message={message}
                disabled={disabled}
                onEdit={onEdit}
                onSendNow={onSendNow}
                onRemove={onRemove}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
