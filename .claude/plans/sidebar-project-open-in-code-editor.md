# 侧栏项目菜单「打开项目」-> 内部代码编辑器面板

> 状态: 已落地 | 最后核对: 2026-08-26

## 需求

菜单栏（侧边栏）项目的**右键菜单**和**更多操作菜单**中新增「打开项目」项；点击后打开内部代码编辑器面板（ChatView 统一侧面板的「代码」tab / CodeViewerPanel），并展示该项目的文件树。

## 现状链路（已勘察）

- 项目菜单唯一来源：`SidebarSessionList.tsx` 中 `ProjectSessionGroup` 的 `projectMenuItems`（L1154），同一数组同时喂给右键 `Dropdown(trigger=['contextMenu'])` 和更多操作 `Dropdown(trigger=['click'])`——加一处，两个入口同时生效。
- 代码面板：`ChatView` 的 `UnifiedSessionSidePanel`，activeTab `'code'` 时渲染 `CodeViewerPanel`；已有现成入口函数 `openUnifiedSidePanel('code')`。
- 代码面板的工作区来自 `gitWorkspace`：无活跃会话（空 hero）时取 `activeWorkspace`，否则取活跃会话的工作区。
- 文件树可见性是全局 store（`fileExplorerVisibility.ts`），与 Git 面板 / 搜索面板共用左侧槽位、互斥。
- 跨视图通知的既有模式：`window CustomEvent` + `localStorage` 待处理标记兜底（`SkillStoreView` 的 target-tab、`teamNavigation.ts`）——解决「派发事件时 ChatView 尚未挂载（用户在其他视图）」的时序问题。
- 会话切换 effect（ChatView L1008）：active 变 null 时会收起全部面板。若「清会话 + 开面板」进入同一次 commit，直接在事件回调里开面板会被它关掉；用「state + 声明在其后的 effect」落地打开动作，同 commit 内先收起再展开，顺序确定。

## 方案

### 1. 新文件 `components/code-viewer/codeViewerNavigation.ts`（~45 行）

- `OPEN_PROJECT_CODE_VIEWER_EVENT = 'spark:open-project-code-viewer'`
- `OPEN_PROJECT_CODE_VIEWER_PENDING_KEY = 'spark-agent:open-project-code-viewer-pending'`
- `requestOpenProjectCodeViewer()`：写 pending 标记 + 派发事件（供侧栏调用）。
- `consumePendingOpenProjectCodeViewer()`：挂载时消费标记（供 ChatView 调用）。

### 2. `SidebarSessionList.tsx`

- `ProjectSessionGroup` 新增 prop `onOpenProjectInEditor: (workspace: WorkspaceInfo) => void`（与其他 on\* prop 一致，必填）。
- `projectMenuItems` 首位插入：

  ```tsx
  { icon: <Icons.Code size={14} />, label: t('sidebar.project.openInEditor'), onClick: () => onOpenProjectInEditor(group.workspace) }
  ```

- 主渲染处（L2610 附近）接线：

  ```tsx
  onOpenProjectInEditor={async (workspace) => {
    // 活跃会话属于其他项目时先退出该会话，让代码面板落到目标项目
    // （会话工作区含 worktree 时归并到 base 项目判断）
    const activeSession = ctx.sessions.find((s) => s.id === ctx.activeSessionId) ?? null
    const belongs = activeSession?.workspaceIds.some((id) =>
      id === workspace.id ||
      ctx.workspaces.find((w) => w.id === id)?.worktreeMeta?.baseWorkspaceId === workspace.id)
    if (activeSession != null && !belongs) ctx.setActiveSession(null)
    ctx.setActiveWorkspace(workspace.id)
    await ctx.handleOpenWorkspace(workspace)   // await 隔离：先让会话切换 effect 跑完
    setTweak('view', 'chat')
    requestOpenProjectCodeViewer()
  }}
  ```

### 3. `ChatView.tsx`（新增 ~30 行，薄接线）

- 导入新模块 + `closeGitPanel` / `closeSearchPanel`。
- 新 state `codeViewerOpenSignal`（计数信号）。
- 事件监听 effect（放在 OPEN_CODE_SEARCH_EVENT 监听之后，即会话切换 effect 之后）：消费 pending 标记 / 监听事件 -> `setCodeViewerOpenSignal(n => n + 1)`。
- 信号落地 effect：`closeGitPanel()` + `closeSearchPanel()` + `setCodeExplorerVisible(true)` + `openUnifiedSidePanel('code')`。

### 4. `i18n/locales.ts`

- `sidebar.project.openInEditor`：zh `打开项目` / en `Open in editor`。

### 5. `SidebarSessionList.test.tsx`

- 8 处 `<ProjectSessionGroup>` 渲染补传 `onOpenProjectInEditor={() => undefined}`。
- 新增用例：打开更多菜单出现「打开项目」项，点击回调收到对应 workspace。

## 行为设计（关键决策）

| 场景                                      | 行为                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| 无活跃会话                                | 选中该项目 + 打开代码面板展示其文件树                                                  |
| 活跃会话属于该项目（含其 worktree）       | 不动会话，直接打开代码面板                                                             |
| 活跃会话属于**其他项目**                  | 先退出该会话（可从侧栏点回），再以目标项目打开代码面板——否则面板会停留在旧会话的项目上 |
| 用户当前不在 chat 视图                    | setTweak 切到 chat；事件 + localStorage 兜底保证挂载后仍能打开                         |
| 文件树被收起 / Git / 搜索面板占用左侧槽位 | 打开项目时互斥切回文件树                                                               |

## 影响面

- `ProjectSessionGroup` 仅被本文件与测试引用，必填新 prop 只影响测试渲染点（一并更新）。
- 不改动既有菜单项、面板状态机、快照逻辑；i18n 纯新增 key。
- GitNexus MCP 本会话不可用，已按降级规则用人工调用点核对（该组件无其他调用方）。

## 验证

- `SidebarSessionList.test.tsx`（新增 + 既有用例）
- `pnpm -C apps/desktop run typecheck`
- 人工冒烟（标注未实测项）：右键 / 更多菜单出现「打开项目」；三个场景的面板落点；非 chat 视图入口。
