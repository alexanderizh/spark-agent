/**
 * 画布级全局事件（paste / 快捷键）的输入目标守卫。
 *
 * 画布在 window 上监听 paste，把剪贴板内容落成节点；任务面板展开输入（Lexical
 * contenteditable）、agent 侧栏等输入框也会接收粘贴。两者必须互斥：当粘贴/按键
 * 目标处于任何可编辑元素或画布浮层面板容器内时，画布的全局 handler 一律放行。
 *
 * 注意与容器白名单保持同步：新增画布内嵌浮层面板（含输入区）时，应把其根容器
 * 类名加入 EDITABLE_OVERLAY_SELECTOR，避免面板内的输入形式变化（textarea ↔
 * contenteditable）后守卫漏判。
 */

const EDITABLE_OVERLAY_SELECTOR = [
  '[contenteditable="true"]',
  '.canvas-inline-ai-composer',
  '.canvas-operation-panel',
  '.canvas-operation-workbench',
  '.canvas-node-bottom-editor',
  '.canvas-agent-modal',
  '.ant-modal',
  '.ant-drawer',
].join(', ')

function isEditableElement(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  const tagName = node.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    node.isContentEditable ||
    node.closest(EDITABLE_OVERLAY_SELECTOR) != null
  )
}

/**
 * 判定全局事件目标是否处于「用户输入上下文」：
 * - 命中可编辑元素（input / textarea / select / contenteditable）或浮层面板容器，直接放行；
 * - 兜底：个别场景下事件 target 会落在 body 等非编辑元素，而真实焦点仍在输入框
 *   （焦点瞬移、面板重挂载等），此时以 document.activeElement 再核一次，
 *   避免出现「输入框收到粘贴内容 + 画布又落一个文本节点」的双写。
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (isEditableElement(target)) return true
  const ownerDocument = target instanceof Element ? target.ownerDocument : null
  const activeElement =
    (ownerDocument ?? (typeof document !== 'undefined' ? document : null))?.activeElement ?? null
  return activeElement !== target && isEditableElement(activeElement)
}
