# 会话附件与侧栏文件夹拖拽实施计划

> 状态: 已落地 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为会话内容区提供居中的清透毛玻璃拖拽反馈和扁平圆头附件标签，并允许把一个或多个顶层文件夹拖入左侧项目区直接添加为项目。

**Architecture:** 保留 Composer 的窗口级文件拖拽监听，但通过共享的侧栏投放区标识避免跨区域抢占。新增纯函数服务负责目录拖拽意图、路径去重、类型校验和批量项目创建；新增独立侧栏投放组件负责 React 拖拽状态，SessionSidebarContext 只做 IPC 与状态接线。

**Tech Stack:** Electron 43、React 19、TypeScript、Less/CSS、Vitest、现有 typed IPC hooks。

---

## 文件结构

- 新建 `apps/desktop/src/renderer/design/services/project-folder-drop.ts`：纯函数目录识别、侧栏命中判断和批量项目添加编排。
- 新建 `apps/desktop/src/renderer/design/services/project-folder-drop.test.ts`：目录识别、去重、混合投放、部分失败和激活行为测试。
- 新建 `apps/desktop/src/renderer/design/components/SidebarProjectDropZone.tsx`：侧栏原生文件拖拽状态与投放入口。
- 新建 `apps/desktop/src/renderer/design/components/SidebarProjectDropZone.less`：侧栏清透投放态样式。
- 新建 `apps/desktop/src/renderer/design/components/SidebarProjectDropZone.test.tsx`：投放态和路径回调组件测试。
- 新建 `apps/desktop/src/renderer/design/views/chat/ComposerAttachments.less`：附件圆头 Tag 样式，避免继续扩大超长 `views.css`。
- 修改 `apps/desktop/src/renderer/design/SessionSidebarContext.tsx`：暴露 `handleAddDroppedProjects`，接入 stat/open/refresh/active/toast。
- 修改 `apps/desktop/src/renderer/design/SidebarSessionList.tsx`：用投放组件包裹完整项目列表区域。
- 修改 `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`：侧栏命中时让行，更新遮罩结构和文案，引入附件样式。
- 修改 `apps/desktop/src/renderer/design/views/ChatView.less`：内容区毛玻璃遮罩、居中提示与减少动态效果。
- 修改 `apps/desktop/src/renderer/design/i18n/locales.ts`：补充中英文投放反馈文案。
- 修改本设计文档与本计划：交付后把状态改为“已落地”。

### Task 1：共享目录拖拽与批量添加服务

**Files:**
- Create: `apps/desktop/src/renderer/design/services/project-folder-drop.ts`
- Create: `apps/desktop/src/renderer/design/services/project-folder-drop.test.ts`

- [x] **Step 1：先写失败测试**

测试定义以下期望 API 与行为：

```ts
expect(getDirectoryDropIntent(directoryTransfer)).toBe('accept')
expect(getDirectoryDropIntent(fileTransfer)).toBe('reject')
expect(isSidebarProjectDropTarget(sidebarChild)).toBe(true)

const result = await addProjectsFromDroppedPaths(
  ['/work/alpha', '/work/readme.md', '/work/beta', '/work/alpha'],
  {
    existingRootPaths: ['/work/existing'],
    statFileKind: async ({ path }) => ({ kind: path.endsWith('.md') ? 'file' : 'directory' }),
    openWorkspace: async ({ create }) => ({ workspace: { id: `ws:${create.rootPath}` } }),
    refreshData,
    setActiveWorkspace,
  },
)

expect(result).toEqual({ added: 2, ignoredFiles: 1, duplicates: 1, failed: 0 })
expect(setActiveWorkspace).toHaveBeenCalledWith('ws:/work/beta')
```

另加用例证明：同根路径项目被跳过；`statFileKind` 或单次 `openWorkspace` 失败时继续后续目录；没有成功项时不 refresh、不切换项目；Windows 路径比较忽略分隔符差异与盘符大小写。

- [x] **Step 2：运行测试并确认按预期失败**

Run:

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/services/project-folder-drop.test.ts
```

Expected: FAIL，提示 `project-folder-drop` 模块或导出不存在。

- [x] **Step 3：实现最小纯函数服务**

实现以下公开边界：

```ts
export const SIDEBAR_PROJECT_DROP_ZONE_SELECTOR = '[data-sidebar-project-drop-zone]'
export type DirectoryDropIntent = 'accept' | 'reject' | 'unknown'
export type DroppedProjectSummary = {
  added: number
  ignoredFiles: number
  duplicates: number
  failed: number
}

export function getDirectoryDropIntent(dataTransfer: DataTransfer | null): DirectoryDropIntent
export function isSidebarProjectDropTarget(target: EventTarget | null): boolean
export async function addProjectsFromDroppedPaths(
  paths: string[],
  dependencies: AddProjectsFromDroppedPathsDependencies,
): Promise<DroppedProjectSummary>
```

`getDirectoryDropIntent` 仅检查顶层 `DataTransferItem`；只要一个 entry 为目录就返回 `accept`，所有可识别 entry 都是文件时返回 `reject`，平台没有 entry API 但携带文件时返回 `unknown`。批量服务逐项校验、创建并累计摘要，只在至少成功一次时刷新并激活最后一个成功项目。

- [x] **Step 4：运行测试并确认通过**

Run 同 Step 2。Expected: PASS，所有目录分类与批量添加用例通过。

- [x] **Step 5：提交任务 1**

```bash
git add apps/desktop/src/renderer/design/services/project-folder-drop.ts \
  apps/desktop/src/renderer/design/services/project-folder-drop.test.ts
git commit -m "feat(desktop): add project folder drop service"
```

### Task 2：SessionSidebarContext 接入批量项目添加

**Files:**
- Modify: `apps/desktop/src/renderer/design/SessionSidebarContext.tsx`
- Modify: `apps/desktop/src/renderer/design/i18n/locales.ts`
- Test: `apps/desktop/src/renderer/design/services/project-folder-drop.test.ts`

- [x] **Step 1：扩展失败测试约束结果摘要文案**

在服务测试中新增：

```ts
expect(formatDroppedProjectSummary({ added: 2, ignoredFiles: 1, duplicates: 1, failed: 1 }))
  .toBe('已添加 2 个项目；忽略 1 个文件、1 个重复目录，1 个目录添加失败')
```

- [x] **Step 2：运行目标测试并确认失败**

Expected: FAIL，提示 `formatDroppedProjectSummary` 不存在。

- [x] **Step 3：接入 Context 与 IPC**

在 `SessionSidebarCtx` 增加：

```ts
handleAddDroppedProjects: (paths: string[]) => Promise<void>
```

Provider 内新增 `useIpcInvoke('file:stat-kind')`，并通过 `addProjectsFromDroppedPaths` 注入当前 `workspaces.map(w => w.rootPath)`、`openWorkspace`、`refreshData` 和 `setActiveWorkspaceId`。根据摘要调用 success/info/warning；全部无法解析或创建失败时使用 error。该回调不得调用 `handleNewSession`。

为侧栏提示、不可解析错误和结果摘要增加中英文 i18n key，保持中文结果与测试一致。

- [x] **Step 4：运行服务测试与类型检查**

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/services/project-folder-drop.test.ts
pnpm --filter @spark/desktop typecheck
```

Expected: PASS，类型检查无新增错误。

- [x] **Step 5：提交任务 2**

```bash
git add apps/desktop/src/renderer/design/SessionSidebarContext.tsx \
  apps/desktop/src/renderer/design/i18n/locales.ts \
  apps/desktop/src/renderer/design/services/project-folder-drop.test.ts \
  apps/desktop/src/renderer/design/services/project-folder-drop.ts
git commit -m "feat(desktop): add dropped folders as projects"
```

### Task 3：侧栏项目投放组件

**Files:**
- Create: `apps/desktop/src/renderer/design/components/SidebarProjectDropZone.tsx`
- Create: `apps/desktop/src/renderer/design/components/SidebarProjectDropZone.less`
- Create: `apps/desktop/src/renderer/design/components/SidebarProjectDropZone.test.tsx`
- Modify: `apps/desktop/src/renderer/design/SidebarSessionList.tsx`

- [x] **Step 1：写组件失败测试**

使用 jsdom 渲染组件，并分开验证：目录 `dragenter` 后出现 `.sidebar-project-drop-overlay`；嵌套 `dragleave` 不提前关闭；目录 drop 调用 `onDropPaths(['/work/a', '/work/b'])`；普通文件 entry 不显示有效投放态；窗口 blur 清理状态。

```tsx
act(() => fireNativeDrag(zone, 'dragenter', directoryTransfer))
expect(zone.classList.contains('is-file-drop-active')).toBe(true)
act(() => fireNativeDrag(zone, 'drop', directoryTransfer))
expect(onDropPaths).toHaveBeenCalledWith(['/work/a', '/work/b'])
```

- [x] **Step 2：运行组件测试并确认失败**

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/components/SidebarProjectDropZone.test.tsx
```

Expected: FAIL，组件模块不存在。

- [x] **Step 3：实现投放组件并接入侧栏**

组件根节点设置 `data-sidebar-project-drop-zone`，使用 drag depth ref 管理进入/离开；`accept` 与 `unknown` 状态阻止默认行为并显示覆盖层，`reject` 不显示。drop 时用共享 `getDataTransferFilePaths` 只提取顶层投放项，并调用 `onDropPaths`；无法解析时显示明确错误。

在 `SidebarSessionList` 的最外层项目列表容器接入：

```tsx
<SidebarProjectDropZone onDropPaths={ctx.handleAddDroppedProjects}>
  <div className="sidebar-session-list-inner">…</div>
</SidebarProjectDropZone>
```

样式使用半透明浅蓝层、`backdrop-filter: blur(12px)`、虚线内轮廓和居中提示，并为暗色主题与 `prefers-reduced-motion` 提供覆盖。

- [x] **Step 4：运行组件与现有侧栏测试**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/components/SidebarProjectDropZone.test.tsx \
  src/renderer/design/SidebarSessionList.test.tsx
```

Expected: PASS，现有排序/分页测试不回归。

- [x] **Step 5：提交任务 3**

```bash
git add apps/desktop/src/renderer/design/components/SidebarProjectDropZone.tsx \
  apps/desktop/src/renderer/design/components/SidebarProjectDropZone.less \
  apps/desktop/src/renderer/design/components/SidebarProjectDropZone.test.tsx \
  apps/desktop/src/renderer/design/SidebarSessionList.tsx
git commit -m "feat(desktop): accept project folders in sidebar"
```

### Task 4：内容区遮罩与附件 Tag 视觉

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`
- Create: `apps/desktop/src/renderer/design/views/chat/ComposerAttachments.less`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.less`
- Modify: `apps/desktop/src/renderer/tests/composer-drag-drop.test.ts`

- [x] **Step 1：先写区域让行失败测试**

在 composer 拖拽测试中构造带 `data-sidebar-project-drop-zone` 的元素，验证共享命中函数对其子元素返回 true、普通主内容元素返回 false。该测试证明 Composer 可以可靠跳过侧栏区域。

- [x] **Step 2：运行测试并确认失败**

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/tests/composer-drag-drop.test.ts
```

Expected: FAIL，侧栏命中判断尚未被测试文件导入或行为未接线。

- [x] **Step 3：实现内容区让行与新遮罩结构**

Composer 的 `shouldHandle` 增加目标参数：

```ts
const shouldHandle = (event: DragEvent) =>
  !sending &&
  hasFileDataTransfer(event.dataTransfer) &&
  !isSidebarProjectDropTarget(event.target)
```

遮罩提示改为：

```tsx
<div className="composer-file-drop-target">
  <span className="composer-file-drop-icon"><Icons.FilePlus size={42} /></span>
  <strong>松开即可添加到会话</strong>
  <span>支持文件和文件夹</span>
</div>
```

- [x] **Step 4：实现清透样式**

`ChatView.less` 将遮罩左边界设为 `var(--sidebar-offset, 210px)`，侧栏隐藏时归零；背景采用低对比半透明蓝灰、`blur(16px) saturate(1.16)`。提示卡移除大面积实体块，使用紧凑圆形图标底和两级文字，并加入 160ms 淡入/上移动效与 reduced-motion。

`ComposerAttachments.less` 为文件与目录 chip 提供 `999px` 圆角、有底色弱描边、焦点可见和目录色阶；保持图片卡片现状。文件 chip 补全 `title={attachment.path}` 与具体移除 aria-label。

- [x] **Step 5：运行相关测试和类型检查**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/tests/composer-drag-drop.test.ts \
  src/renderer/design/components/SidebarProjectDropZone.test.tsx
pnpm --filter @spark/desktop typecheck
```

Expected: PASS，类型检查无新增错误。

- [x] **Step 6：提交任务 4**

```bash
git add apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx \
  apps/desktop/src/renderer/design/views/chat/ComposerAttachments.less \
  apps/desktop/src/renderer/design/views/ChatView.less \
  apps/desktop/src/renderer/tests/composer-drag-drop.test.ts
git commit -m "style(desktop): refine composer drop and attachment tags"
```

### Task 5：文档、索引与完整验证

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-composer-and-sidebar-folder-drop-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-composer-and-sidebar-folder-drop.md`

- [ ] **Step 1：运行完整静态与自动化验证**

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/services/project-folder-drop.test.ts \
  src/renderer/design/components/SidebarProjectDropZone.test.tsx \
  src/renderer/tests/composer-drag-drop.test.ts \
  src/renderer/design/SidebarSessionList.test.tsx
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/desktop lint
pnpm --filter @spark/desktop build
```

Expected: 所有命令退出码为 0，无测试失败、类型错误、lint 错误或构建错误。

- [ ] **Step 2：桌面端视觉与行为验收**

启动开发版并检查：内容区遮罩不覆盖侧栏且提示居中；文件、目录和长名称 Tag 正确；侧栏只接受顶层目录；混合投放只创建目录；多个目录批量添加；重复路径不创建；添加后切换项目但不新建任务；深浅主题与 reduced-motion 正确。

- [ ] **Step 3：核对变更影响与文档状态**

GitNexus 健康时运行 `detect_changes` 并更新索引；不可用时按项目降级规则使用直接调用点检索、相关测试与 `git diff --check`。将设计文档和实施计划状态更新为：

```md
> 状态: 已落地 | 最后核对: 2026-08-01
```

- [ ] **Step 4：提交交付状态**

```bash
git add docs/superpowers/specs/2026-08-01-composer-and-sidebar-folder-drop-design.md \
  docs/superpowers/plans/2026-08-01-composer-and-sidebar-folder-drop.md
git commit -m "docs(desktop): mark folder drop experience delivered"
```

## 交付验证记录

- 相关 Vitest：5 个测试文件、34 个用例通过。
- Desktop TypeScript 类型检查通过。
- 本次涉及的 TS/TSX 文件定向 lint 为 0 error；全量 lint 被既有 `AppControlBridge.ts:68` 的 `no-useless-assignment` error 阻断。
- Electron/Vite 主进程、preload 与 renderer 生产编译通过；标准 `pnpm build` 在编译前因本地缺失 file-viewer WASM/vendor 静态资源而停止。
- GitNexus MCP 未在当前会话暴露，影响与变更范围按项目降级规则使用直接调用点检索、相关测试和 Git diff 核对。
