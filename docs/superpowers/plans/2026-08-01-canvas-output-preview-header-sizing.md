# 画布产物预览头部与媒体尺寸实施计划

> 状态: 已落地 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固定节点产物工作台第二、第三层头部行高，并限制未全屏图片/视频尺寸，避免媒体挤压头部或遮挡大部分画布。

**Architecture:** 保留现有 React 结构，用工作台全屏修饰类区分尺寸策略；CSS Grid 为头部的每个自动行提供固定 `40px` 行高，预览区只能消费剩余空间。未全屏媒体上限为 `640 × 360px`，外层面板继续使用原有响应式宽度，避免误触 `720px` 窄容器断点；全屏继续填满可用空间。

**Tech Stack:** React 19、TypeScript、Less、Vitest

---

### Task 1: 建立布局回归契约

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasOperationWorkbenchLayout.test.ts`
- Read: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.tsx`
- Read: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.less`
- Read: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationOutputPreview.less`
- Read: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less`

- [x] **Step 1: 写入当前会失败的样式与全屏状态契约测试**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('operation workbench media layout', () => {
  it('固定每层工作台头部行高，避免预览媒体挤压导航', () => {
    const styles = readSource('./CanvasOperationWorkbench.less')
    expect(styles).toMatch(
      /\.canvas-operation-workbench-head\s*\{[\s\S]*?grid-auto-rows:\s*40px[\s\S]*?flex:\s*0 0 auto/,
    )
    expect(styles).toMatch(/\.canvas-operation-workbench-tabs[\s\S]*?height:\s*40px/)
    expect(styles).toMatch(/\.canvas-operation-workbench-context[\s\S]*?height:\s*40px/)
    expect(styles).toMatch(/\.canvas-operation-workbench-actions[\s\S]*?height:\s*40px/)
  })

  it('只在未全屏时限制详情媒体，不改变外层面板宽度断点', () => {
    const source = readSource('./CanvasOperationWorkbench.tsx')
    const previewStyles = readSource('./CanvasOperationOutputPreview.less')
    const workspaceStyles = readSource('./CanvasWorkspaceView.less')
    expect(source).toContain("canvas-operation-workbench${fullscreen ? ' is-fullscreen' : ''}")
    expect(previewStyles).toMatch(
      /\.canvas-operation-workbench:not\(\.is-fullscreen\)[\s\S]*?max-width:\s*min\(640px, 100%\)[\s\S]*?max-height:\s*min\(360px, 100%\)/,
    )
    expect(workspaceStyles).not.toMatch(
      /\.canvas-node-bottom-editor:not\(\.is-fullscreen\)[\s\S]*?:has\(\s*\.canvas-operation-workbench-preview \.canvas-operation-output-media\.is-detail\s*\)\s*\{[^}]*width:/s,
    )
  })
})
```

- [x] **Step 2: 运行测试并确认因目标约束尚不存在而失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasOperationWorkbenchLayout.test.ts`

Expected: FAIL，失败断言指向缺少 `grid-auto-rows: 40px` 或未全屏媒体尺寸规则，而不是导入或语法错误。

### Task 2: 固定头部并限制未全屏媒体

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationOutputPreview.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationWorkbenchLayout.test.ts`

- [x] **Step 1: 给工作台根节点增加全屏修饰类**

```tsx
<div className={`canvas-operation-workbench${fullscreen ? ' is-fullscreen' : ''}`}>
```

- [x] **Step 2: 固定头部网格行与三个区域高度**

在 `.canvas-operation-workbench-head` 添加 `grid-auto-rows: 40px`，保留 `flex: 0 0 auto`；给 `.canvas-operation-workbench-tabs`、`.canvas-operation-workbench-context`、`.canvas-operation-workbench-actions` 添加 `height: 40px` 和 `min-height: 40px`。已有横向滚动和省略规则保持不变。

- [x] **Step 3: 限制未全屏媒体并保持全屏填充**

```less
.canvas-operation-workbench:not(.is-fullscreen) .canvas-operation-output-media.is-detail {
  width: auto;
  height: auto;
  max-width: min(640px, 100%);
  max-height: min(360px, 100%);
}

.canvas-operation-workbench.is-fullscreen .canvas-operation-output-media.is-detail {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
}
```

同时将 `.canvas-operation-workbench-preview` 的对齐改为水平、垂直居中。

- [x] **Step 4: 保留外层面板原有响应式宽度**

不得为媒体预览增加 `.canvas-node-bottom-editor` 宽度覆盖；继续使用原有 `width: min(1040px, calc(100% - 32px))`，让常规桌面宽度下上下文区与操作区保持在同一行。

- [x] **Step 5: 运行布局契约并确认通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasOperationWorkbenchLayout.test.ts`

Expected: PASS，2 tests passed。

### Task 3: 回归验收与文档收口

**Files:**

- Modify: `docs/superpowers/specs/2026-08-01-canvas-output-preview-header-sizing-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-canvas-output-preview-header-sizing.md`

- [x] **Step 1: 运行相关组件回归测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasOperationWorkbenchLayout.test.ts src/renderer/design/views/canvas/CanvasOperationWorkbench.test.tsx src/renderer/design/views/canvas/CanvasOperationOutputPreview.test.tsx src/renderer/design/views/canvas/canvasVideoPresentationLifecycle.test.ts`

Expected: 所有相关测试通过，0 failed。

- [x] **Step 2: 运行桌面项目类型检查**

Run: `pnpm --filter @spark/desktop typecheck`

Expected: 命令退出码为 0；若仓库既有错误与本次无关，记录具体错误并额外证明本次文件没有新增错误。

- [x] **Step 3: 检查格式与变更范围**

Run: `pnpm exec prettier --check apps/desktop/src/renderer/design/views/canvas/canvasOperationWorkbenchLayout.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.tsx docs/superpowers/specs/2026-08-01-canvas-output-preview-header-sizing-design.md docs/superpowers/plans/2026-08-01-canvas-output-preview-header-sizing.md`

Run: `git diff --check`

Run: `git diff -- apps/desktop/src/renderer/design/views/canvas/canvasOperationWorkbenchLayout.test.ts apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.tsx apps/desktop/src/renderer/design/views/canvas/CanvasOperationWorkbench.less apps/desktop/src/renderer/design/views/canvas/CanvasOperationOutputPreview.less apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less docs/superpowers/specs/2026-08-01-canvas-output-preview-header-sizing-design.md docs/superpowers/plans/2026-08-01-canvas-output-preview-header-sizing.md`

Expected: 无空白错误；差异仅包含本计划声明的固定头部、媒体尺寸、测试和文档状态更新。

- [x] **Step 4: 更新文档状态**

把设计与计划文档的状态更新为 `已落地`，保留 `最后核对: 2026-08-01`。
