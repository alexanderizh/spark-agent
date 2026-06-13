# File Ownership Map (并发拆分)

> 每个 worker 只动自己"负责"的文件,避免和别的 worker 改同一文件。

## Group A — 顶层 view (5 个 worker,按视图切)

### A1. `ChatView` (大型, ~10000+ 行,独立 worker)
- `apps/desktop/src/renderer/design/views/ChatView.tsx`

### A2. `BoardView` (大型,~800+ 行,独立 worker)
- `apps/desktop/src/renderer/design/views/BoardView.tsx`

### A3. `Providers` + `provider-import-export` (1 个 worker)
- `apps/desktop/src/renderer/design/views/ProvidersView.tsx`
- `apps/desktop/src/renderer/design/views/provider-import-export/ImportPreviewModal.tsx`
- `apps/desktop/src/renderer/design/views/provider-import-export/MultiSelectToolbar.tsx`

### A4. `Settings` + `Workflow` (1 个 worker)
- `apps/desktop/src/renderer/design/views/SettingsView.tsx`
- `apps/desktop/src/renderer/design/views/WorkflowView.tsx`

### A5. `Skill` + `Mcp` + `ScheduledTasks` (1 个 worker)
- `apps/desktop/src/renderer/design/views/SkillStoreView.tsx`
- `apps/desktop/src/renderer/design/views/McpView.tsx`
- `apps/desktop/src/renderer/design/views/ScheduledTasksView.tsx`

## Group B — Canvas 视图 (高耦合,合并到 2 个 worker)

### B1. `Canvas` 项目/任务队列/节点/工具栏/舞台 (1 个 worker,5 文件)
- `apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasTaskQueue.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasToolbar.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`

### B2. `Canvas` 检视器/资产抽屉/AI 面板/内联 AI 合成器/工作区 (1 个 worker,5 文件)
- `apps/desktop/src/renderer/design/views/canvas/CanvasInspector.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasAssetDrawer.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasAiPanel.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasInlineAiComposer.tsx`
- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`

## Group C — 通用组件 / Sidebar (1 个 worker,5 文件)

- `apps/desktop/src/renderer/design/SidebarSessionList.tsx`
- `apps/desktop/src/renderer/design/SidebarFilterMenu.tsx`
- `apps/desktop/src/renderer/design/TweaksPanel.tsx`
- `apps/desktop/src/renderer/design/components/SkillsPickerModal.tsx`
- `apps/desktop/src/renderer/design/components/ClickableFilePath.tsx`
- `apps/desktop/src/renderer/design/components/MarkdownCodeBlock.tsx`
- `apps/desktop/src/renderer/design/components/PromptDialog.tsx`
- `apps/desktop/src/renderer/design/views/overlays.tsx`

## Group D — 特殊独立 (各 1 个 worker)

- **D1.** `AgentsView` (已经部分迁移,只需扫尾 `Dropdown`/`Switch`/`Message` 三处) — 1 个 worker
- **D2.** 测试文件 `apps/desktop/src/renderer/tests/ui-system.test.tsx` — 1 个 worker
- **D3.** 删除 `FormControls.tsx` + `SparkOverlays.tsx` — final task,**必须**在所有 Group A/B/C/D 完成后跑
- **D4.** 全局验证 + followups 收口 — final task

## 依赖图

```
Group A (A1..A5) ─┐
Group B (B1, B2)  ─┼─> D3 (删两个 wrapper 文件) ─> D4 (全局验证)
Group C           ─┤
D1 (AgentsView)  ─┤
D2 (测试)        ─┘
```

D1 和 D2 也不依赖 A/B/C — 它们可以完全并行启动。
D3 必须在所有 produce task 都通过 verifier 后才能跑 (depends_on: A1..A5, B1..B2, C, D1, D2)。
D4 必须在 D3 后跑。
