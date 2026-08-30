/**
 * 子应用目录变化事件。
 *
 * 子应用的创建/发布通常发生在 Agent 会话中，而侧栏与管理页是独立的
 * renderer 组件。用一个 renderer 内事件通知目录消费者刷新，避免把子应用
 * 强行绑定到当前会话或在侧栏里引入轮询。
 */
export const SUB_APP_DIRECTORY_CHANGED_EVENT = 'spark:sub-app-directory-changed'

export function notifySubAppDirectoryChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SUB_APP_DIRECTORY_CHANGED_EVENT))
  }
}
