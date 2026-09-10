# 项目文件面板（统一侧边面板「文件」tab）

> 状态: 已落地 | 最后核对: 2026-09-10

> 验证边界（2026-09-10）：tsc（web/node）、eslint（0 错误、0 新增警告）、聚焦单测
> （store 6 项 + ChatSidePanels 6 项）已通过；端到端 UI 验证按惯例在正式构建中进行。

## 背景与目标

左侧项目列表里的任意项目，目前只能通过「代码」tab 查看文件，且「代码」tab 的文件树强绑定
当前会话的 workspace。用户需要在右侧侧边栏直接打开任意项目的文件树并查看/编辑文件内容。

## 新增前检查结论（2026-09-10）

- 文件浏览能力已齐备：`FileExplorerPanel`（文件树：懒加载 + watch 实时刷新 + 增删改名/拖拽）、
  `CodeViewerPanel`（Monaco 编辑 + 多 tab）、文件预览动态 tab（`preview:${absPath}`）、
  `fileOpenRouting` 统一打开路由、`workspace-search:*` 搜索。
- 缺口：文件树只挂在「代码」tab 内部且绑定会话 workspace，无常驻、可切换项目的入口。
- 后端 IPC 完全够用：`workspace:list-directory` / `workspace:watch-start|stop` / `file:read` /
  `file:write-text` / `file:*` 增删移均为带路径安全校验的 typed IPC。**不新建重复的后端文件服务**，
  按仓库「复用优先」规范以新前端面板模块落地。

## 方案

1. **统一侧边面板新增 kind `'files'`**（`ChatSidePanels.tsx`）：联合类型 + meta（图标/文案）+
   快捷项（加号菜单 & 空态卡片）。
2. **新模块 `design/components/project-files/`**：
   - `ProjectFilesPanel.tsx`：顶栏项目切换（antd Dropdown）+ 复用 `FileExplorerPanel`；
     文件打开走绝对路径（`resolveAbsCodePath` 对绝对路径透传），行为与「代码」tab 文件树一致：
     普通点击 = `shouldOpenInEditorByDefault` 分流（代码/文本 → 代码 tab，富预览 → 预览 tab）；
     右键显式预览/编辑同现有路由；「添加到对话」仅对当前会话绑定的项目开放
     （会话附件按会话项目根解析路径，跨项目打开会产生错误引用）。
   - `projectFilesPanelStore.ts`：选中项目 + 各项目展开目录（localStorage 持久化，跨会话/重启）+
     「项目列表菜单 → ChatView」打开请求桥（模块级事件订阅，与 `fileExplorerVisibility.ts` 同款模式）。
   - `ProjectFilesPanel.less`：自带 `--cv-*` 令牌映射到全局 token（`fe-*` 样式依赖该组令牌，
     原作用域为 `.code-viewer-panel`，本面板在其外渲染），自动适配明暗主题。
3. **ChatView**：渲染分支挂 `ProjectFilesPanel`（数据来自 `sessionCtx.workspaces`）+
   订阅打开请求桥（收到请求 → 持久化选中项目 + `openUnifiedSidePanel('files')`）。
   展开目录/选中项目由 store 持久化，不进 per-session `PanelSnapshot`。
4. **SidebarSessionList**：项目右键菜单新增「打开文件面板」→ `requestOpenProjectFiles(workspace.id)`。
5. **FileExplorerPanel / FileExplorerToolbar**：`onOpenSearch` 改为可选（未传时隐藏搜索按钮；
   「文件」面板不承载搜索，搜索仍在「代码」tab 内）。既有调用方（CodeViewerPanel）始终传值，行为不变。

## 影响面（GitNexus MCP 不可用，采用常规检索等效分析）

- `UnifiedSidePanelKind` 加宽联合：消费方为 ChatView 渲染分支与 ChatSidePanels 内部 meta/快捷项，
  新增成员向后兼容。风险：LOW。
- `FileExplorerPanelProps.onOpenSearch` 可选化：唯一调用方 CodeViewerPanel 始终传值，行为不变。
  风险：LOW。
- 其余均为新增文件或新增菜单项。风险：LOW。

## 验证

- 聚焦单测：store 持久化/桥语义、`ChatSidePanels` 快捷项与 meta。
- `pnpm typecheck`、`pnpm lint`、相关单测（design 目录 vitest）。
- 端到端 UI 验证依赖正式构建（用户按惯例在正式版本验证）。

## 已知边界

- 左侧项目菜单「打开文件面板」仅在会话视图（ChatView 已挂载）生效；画布等其他视图点击无效果。
- 跨项目文件可预览/编辑（绝对路径路由），但「添加到对话」仅对会话绑定项目开放。
