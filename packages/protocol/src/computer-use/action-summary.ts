import type { ComputerAction } from './action.js'

/**
 * Builds the one-line human summary shown in the Computer Use activity log.
 * The log is what the user watches while the agent drives the desktop, so the
 * summary must say WHAT the agent is about to do / did — not the transport
 * details. Element ids refer to the tree the deciding model saw, which makes
 * them meaningful in context of the visible tree text.
 */
export function describeComputerAction(action: ComputerAction): string {
  switch (action.type) {
    case 'click':
      return `点击 ${describeTarget(action)}${action.count === 3 ? '（三击）' : action.count === 2 ? '（双击）' : ''}${action.button === 'right' ? '（右键）' : action.button === 'middle' ? '（中键）' : ''}`
    case 'type_text': {
      const text = truncate(action.text, 60)
      return `输入 “${text}”`
    }
    case 'set_value':
      return `设置 [${action.elementId}] 的值为 “${truncate(action.value, 60)}”`
    case 'invoke_element':
      return `${describeElementAction(action.action ?? 'invoke')} [${action.elementId}]`
    case 'select_text':
      return `在 [${action.elementId}] 中选取 “${truncate(action.text, 40)}”`
    case 'scroll': {
      const axis = action.deltaY !== 0 ? 'Y' : 'X'
      const delta = action.deltaY !== 0 ? action.deltaY : (action.deltaX ?? 0)
      const direction = delta > 0 ? '下' : '上'
      return `滚动${axis === 'X' ? (delta > 0 ? '右' : '左') : direction} ${Math.abs(Math.round(delta))}px`
    }
    case 'drag':
      return `拖拽 ${describePoint(action.from)} → ${describePoint(action.to)}`
    case 'keypress':
      return `按键 ${action.keys.map((key) => key.toLowerCase()).join('+')}`
    case 'move':
      return `移动指针到 ${describePoint(action.point)}`
    case 'focus_window':
      return `聚焦窗口 ${action.windowId}`
    case 'wait_for':
      return `等待条件满足（上限 ${action.timeoutMs}ms）`
    case 'observe':
      return '重新观察界面'
    case 'app_command':
      return `应用命令 ${action.command.name}`
    default: {
      // Exhaustiveness guard: a new action type must add its own branch.
      const exhausted: never = action
      return `执行动作 ${(exhausted as { type: string }).type}`
    }
  }
}

function describeTarget(action: { elementId?: string; point?: { x: number; y: number } }): string {
  if (action.elementId != null) return `元素 [${action.elementId}]`
  if (action.point != null) return describePoint(action.point)
  return '目标位置'
}

function describePoint(point: { x: number; y: number }): string {
  // Normalized window-relative coordinates are shown as percentages — pixel
  // values would imply a coordinate space the log reader cannot see.
  return `(${Math.round(point.x * 100)}%, ${Math.round(point.y * 100)}%)`
}

type InvokeElementAction = NonNullable<
  Extract<ComputerAction, { type: 'invoke_element' }>['action']
>

function describeElementAction(action: InvokeElementAction): string {
  switch (action) {
    case 'invoke':
      return '激活'
    case 'select':
      return '选中'
    case 'focus':
      return '聚焦'
    case 'expand':
      return '展开'
    case 'collapse':
      return '折叠'
    default: {
      const exhausted: never = action
      return `操作 ${(exhausted as string).toString()}`
    }
  }
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}
