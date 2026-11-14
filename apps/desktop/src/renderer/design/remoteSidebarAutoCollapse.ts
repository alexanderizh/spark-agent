/**
 * 打开远程视图时自动折叠左侧菜单的判定。
 *
 * 为什么抽成纯函数：这段逻辑依赖「上一次在哪」和「这次折叠是不是我干的」两个记忆，
 * 写在 effect 里既容易被后续改动破坏（多跑一轮就来回折／展开），也没法测。
 * 这里返回「该做什么 + 新的记忆」，effect 只负责执行。
 *
 * 规则：
 *   - 刚进入远程视图时菜单展开着 → 折叠（记下是自己折的）；
 *   - 用户在远程视图里自己把菜单展开 → 记忆清零，之后离开不再替他展开；
 *   - 离开远程视图时只恢复「自己折的那次」，用户手动折的保持折着。
 */

export interface RemoteSidebarAutoTracker {
  /** 上一次渲染是否停留在远程视图 */
  wasRemoteView: boolean
  /** 当前这次的折叠是自动折叠造成的 */
  autoCollapsed: boolean
}

export const INITIAL_REMOTE_SIDEBAR_TRACKER: RemoteSidebarAutoTracker = {
  wasRemoteView: false,
  autoCollapsed: false,
}

export type RemoteSidebarAction = 'collapse' | 'restore' | 'none'

export function decideRemoteSidebarAction(
  isRemoteView: boolean,
  sidebarHidden: boolean,
  tracker: RemoteSidebarAutoTracker,
): { action: RemoteSidebarAction; next: RemoteSidebarAutoTracker } {
  if (isRemoteView) {
    if (!tracker.wasRemoteView) {
      // 进入的那一刻：本来就折着就不用动，也不欠用户一次恢复
      return sidebarHidden
        ? { action: 'none', next: { wasRemoteView: true, autoCollapsed: false } }
        : { action: 'collapse', next: { wasRemoteView: true, autoCollapsed: true } }
    }
    // 还停在远程视图、菜单却被展开了 = 用户自己点的，交出所有权
    if (!sidebarHidden && tracker.autoCollapsed) {
      return { action: 'none', next: { wasRemoteView: true, autoCollapsed: false } }
    }
    return { action: 'none', next: tracker }
  }

  if (tracker.wasRemoteView && tracker.autoCollapsed && sidebarHidden) {
    return { action: 'restore', next: INITIAL_REMOTE_SIDEBAR_TRACKER }
  }
  return { action: 'none', next: INITIAL_REMOTE_SIDEBAR_TRACKER }
}
