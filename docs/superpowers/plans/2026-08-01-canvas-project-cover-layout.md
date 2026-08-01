# 无限画布项目封面完整预览 Implementation Plan

> 状态: 待开发 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让无限画布项目详情页在固定高度内完整显示任意宽高比封面，并把完整预览、更换封面和项目操作拆成无歧义入口。

**Architecture:** 保留 `CanvasProjectDetail` 作为唯一业务组件，在其中增加独立的封面加载失败状态与封面预览 Modal；封面视觉由前景 `contain` 图片和背景 `cover + blur` 图片组成。现有上传回调、隐藏文件输入、资源预览与项目操作不改数据协议，仅重新组织 DOM 与样式。

**Tech Stack:** React 19、TypeScript、Ant Design Modal、LobeHub UI、Less、Vitest + jsdom

---

## 文件结构

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasProjectDetail.tsx` — 封面默认态、上传入口、预览状态、标题操作区。
- Modify: `apps/desktop/src/renderer/design/views/canvas/uiux-v4/projects.less` — 双层封面、悬停工具条、响应式和减少动态效果样式。
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx` — 封面行为、DOM 位置和关键 CSS 契约测试。
- Modify: `docs/superpowers/specs/2026-08-01-canvas-project-cover-layout-design.md` — 完成后把状态更新为“已落地”。
- Modify: `docs/superpowers/plans/2026-08-01-canvas-project-cover-layout.md` — 执行时勾选步骤，完成后把状态更新为“已落地”。

工作区中的 `projects.less` 已有用户修改。执行时只能在封面与标题操作区相关块追加/替换内容；提交时必须用交互式暂存或缓存补丁排除文件顶部已有的背景修改。

### Task 1: 用失败测试锁定封面交互契约

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx`

- [ ] **Step 1: 写行为测试与样式契约测试**

创建测试文件，使用轻量 UI mock 隔离项目详情页：

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasProject } from './canvas.types'

const mocks = vi.hoisted(() => ({
  openSnapshot: vi.fn(async () => ({ assets: [] })),
}))

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, loading: _loading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => <button {...props}>{children}</button>,
  Dropdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('antd', () => ({
  Modal: ({ open, title, children, onCancel }: { open: boolean; title?: React.ReactNode; children?: React.ReactNode; onCancel?: () => void }) => open ? (
    <div role="dialog">
      <span>{title}</span>
      {children}
      <button type="button" aria-label="关闭封面预览" onClick={onCancel}>关闭</button>
    </div>
  ) : null,
  Spin: () => <span>loading</span>,
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('./canvas.api', () => ({ canvasApi: { openSnapshot: mocks.openSnapshot } }))

import { CanvasProjectDetail } from './CanvasProjectDetail'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseProject: CanvasProject = {
  id: 'project-1',
  userId: 0,
  title: '电影项目',
  status: 'active',
  coverUrl: 'safe-file://project/cover.png',
  nodeCount: 3,
  assetCount: 2,
  taskCount: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
}

let container: HTMLDivElement
let root: Root

const renderDetail = async (project: CanvasProject, onUploadCover = vi.fn()) => {
  await act(async () => {
    root.render(
      <CanvasProjectDetail
        project={project}
        opening={false}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onExport={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onOpenFolder={vi.fn()}
        onTogglePin={vi.fn()}
        onUploadCover={onUploadCover}
      />,
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('CanvasProjectDetail project cover', () => {
  it('renders one decorative cover layer and one complete foreground image', async () => {
    await renderDetail(baseProject)
    const ambient = container.querySelector<HTMLImageElement>('.canvas-detail-cover-ambient')
    const foreground = container.querySelector<HTMLImageElement>('.canvas-detail-cover-image')
    expect(ambient?.getAttribute('src')).toBe('safe-file://project/cover.png')
    expect(ambient?.alt).toBe('')
    expect(foreground?.getAttribute('src')).toBe('safe-file://project/cover.png')
    expect(foreground?.alt).toBe('电影项目')
  })

  it('opens preview from the cover and keeps replacement as a separate action', async () => {
    await renderDetail(baseProject)
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    const clickFileInput = vi.spyOn(fileInput!, 'click')

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="查看项目封面：电影项目"]')?.click())
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(clickFileInput).not.toHaveBeenCalled()

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="更换项目封面"]')?.click())
    expect(clickFileInput).toHaveBeenCalledOnce()
  })

  it('keeps the empty cover as the upload entry', async () => {
    await renderDetail({ ...baseProject, coverUrl: null })
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    const clickFileInput = vi.spyOn(fileInput!, 'click')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="上传项目封面"]')?.click())
    expect(clickFileInput).toHaveBeenCalledOnce()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('falls back to the upload entry when the foreground image fails', async () => {
    await renderDetail(baseProject)
    const foreground = container.querySelector<HTMLImageElement>('.canvas-detail-cover-image')
    await act(async () => foreground?.dispatchEvent(new Event('error')))
    expect(container.textContent).toContain('封面加载失败，点击重新上传')
    expect(container.querySelector('[aria-label="上传项目封面"]')).not.toBeNull()
  })

  it('keeps pin and more actions out of the cover', async () => {
    await renderDetail(baseProject)
    const cover = container.querySelector('.canvas-detail-cover')
    const headerActions = container.querySelector('.canvas-detail-header-right')
    expect(cover?.querySelector('[aria-label="置顶"]')).toBeNull()
    expect(cover?.querySelector('[aria-label="更多项目操作"]')).toBeNull()
    expect(headerActions?.querySelector('[aria-label="置顶"]')).not.toBeNull()
    expect(headerActions?.querySelector('[aria-label="更多项目操作"]')).not.toBeNull()
  })
})

describe('CanvasProjectDetail cover styles', () => {
  const styles = readFileSync(new URL('./uiux-v4/projects.less', import.meta.url), 'utf8')

  it('contains the ambient layer, contain foreground and responsive height', () => {
    expect(styles).toContain('.canvas-detail-cover-ambient')
    expect(styles).toMatch(/\.canvas-detail-cover-image\s*\{[\s\S]*?object-fit:\s*contain/)
    expect(styles).toContain('@media (max-width: 720px)')
    expect(styles).toContain('height: 180px')
  })

  it('supports reduced motion', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('.canvas-detail-cover-toolbar')
  })
})
```

- [ ] **Step 2: 运行测试，确认旧实现不满足契约**

Run:

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx
```

Expected: FAIL，至少报告缺少 `.canvas-detail-cover-ambient`、`查看项目封面`、`更换项目封面` 和 `object-fit: contain`。

- [ ] **Step 3: 提交失败测试**

```bash
git add apps/desktop/src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx
git commit -m "test(canvas): define project cover preview behavior"
```

### Task 2: 实现完整封面、独立上传与预览

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasProjectDetail.tsx:1-20,119-150,285-390,560-610`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx`

- [ ] **Step 1: 增加封面状态与互不冲突的事件入口**

将现有 `handleCoverClick` 替换为封面预览、失败降级和文件选择逻辑：

```tsx
const coverInputRef = useRef<HTMLInputElement | null>(null)
const [coverPreviewOpen, setCoverPreviewOpen] = useState(false)
const [coverFailed, setCoverFailed] = useState(false)
const hasUsableCover = Boolean(project.coverUrl) && !coverFailed

useEffect(() => {
  setCoverPreviewOpen(false)
  setCoverFailed(false)
}, [project.id, project.coverUrl])

const openCoverPicker = useCallback(() => {
  if (onUploadCover) coverInputRef.current?.click()
}, [onUploadCover])

const openCoverPreview = useCallback(() => {
  if (hasUsableCover) setCoverPreviewOpen(true)
}, [hasUsableCover])
```

保留现有 `handleCoverFileChange`；它继续清空 input value，允许重复选择同一文件。

- [ ] **Step 2: 将封面 DOM 改为背景层、完整前景层和独立工具条**

用以下结构替换旧封面容器、整面 hover 遮罩和封面内项目操作：

```tsx
<div className={`canvas-detail-cover${onUploadCover ? ' is-uploadable' : ''}`}>
  {hasUsableCover && project.coverUrl ? (
    <>
      <button
        type="button"
        className="canvas-detail-cover-preview-trigger"
        aria-label={`查看项目封面：${project.title}`}
        onClick={openCoverPreview}
      >
        <img
          className="canvas-detail-cover-ambient"
          src={project.coverUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <img
          className="canvas-detail-cover-image"
          src={project.coverUrl}
          alt={project.title}
          draggable={false}
          onError={() => setCoverFailed(true)}
        />
      </button>
      <div className="canvas-detail-cover-toolbar">
        <button type="button" className="canvas-detail-cover-tool" onClick={openCoverPreview} aria-label="查看封面大图">
          <Icons.Maximize size={14} />
          <span>查看大图</span>
        </button>
        {onUploadCover && (
          <button type="button" className="canvas-detail-cover-tool" onClick={openCoverPicker} aria-label="更换项目封面">
            <Icons.Edit size={14} />
            <span>更换封面</span>
          </button>
        )}
      </div>
    </>
  ) : onUploadCover ? (
    <button type="button" className="canvas-detail-cover-empty" onClick={openCoverPicker} aria-label="上传项目封面">
      <Icons.Canvas size={36} />
      <span>{coverFailed ? '封面加载失败，点击重新上传' : '暂无封面，点击上传'}</span>
    </button>
  ) : (
    <div className="canvas-detail-cover-empty">
      <Icons.Canvas size={36} />
      <span>{coverFailed ? '封面加载失败' : '暂无封面，进入项目开始创作'}</span>
    </div>
  )}
  <input
    ref={coverInputRef}
    type="file"
    accept="image/*"
    className="canvas-detail-cover-input"
    onChange={handleCoverFileChange}
  />
</div>
```

`Icons.Maximize` 与 `Icons.Edit` 已存在，直接复用，不扩展全局 `Icons` 契约。

- [ ] **Step 3: 把置顶和更多菜单移动到标题操作区**

将原 `.canvas-detail-cover-actions` 中的两个按钮移动到 `.canvas-detail-header-right`，并保留现有菜单 items 与回调：

```tsx
<div className="canvas-detail-header-right">
  <Tooltip title={project.pinned ? '取消置顶' : '置顶'}>
    <button
      type="button"
      className={`canvas-detail-pin-btn${project.pinned ? ' is-pinned' : ''}`}
      aria-label={project.pinned ? '取消置顶' : '置顶'}
      onClick={() => onTogglePin(project.id)}
    >
      {project.pinned ? <Pin size={14} fill="currentColor" /> : <PinOff size={14} />}
    </button>
  </Tooltip>
  <Dropdown
    trigger={['click']}
    placement="bottomRight"
    menu={{
      items: [
        { key: 'edit', icon: <Icons.Edit size={14} />, label: '基础信息', onClick: () => onEdit(project.id) },
        { key: 'open-folder', icon: <Icons.Folder size={14} />, label: '打开文件夹', onClick: () => onOpenFolder(project.id) },
        { key: 'export', icon: <Icons.Download size={14} />, label: '导出', onClick: () => onExport(project.id) },
        { type: 'divider' as const },
        { key: 'archive', icon: <Icons.Archive size={14} />, label: project.status === 'archived' ? '恢复' : '归档', onClick: () => onArchive(project.id) },
        { key: 'delete', icon: <Icons.Trash size={14} />, label: '删除', onClick: () => onDelete(project.id) },
      ],
    }}
  >
    <Tooltip title="更多操作">
      <button type="button" className="canvas-detail-icon-btn" aria-label="更多项目操作">
        <Icons.More size={15} />
      </button>
    </Tooltip>
  </Dropdown>
  <Button
    type="primary"
    size="middle"
    loading={opening}
    disabled={opening}
    icon={<Icons.ExternalLink size={14} />}
    onClick={() => onOpen(project.id)}
  >
    {opening ? '打开中' : '打开画布'}
  </Button>
</div>
```

实现时可把现有 menu 配置原样内联移动，不能改菜单项顺序、文案或回调。

- [ ] **Step 4: 增加独立封面预览 Modal**

在资源预览 Modal 前加入：

```tsx
<Modal
  open={coverPreviewOpen && hasUsableCover}
  onCancel={() => setCoverPreviewOpen(false)}
  footer={null}
  width="min(92vw, 1200px)"
  centered
  title={`${project.title} · 项目封面`}
  className="canvas-detail-cover-preview-modal"
  destroyOnHidden
>
  {project.coverUrl && (
    <img
      src={project.coverUrl}
      alt={`${project.title} · 项目封面`}
      className="canvas-detail-cover-preview-image"
    />
  )}
</Modal>
```

Ant Design Modal 默认提供遮罩点击关闭、`Escape` 关闭、关闭按钮和焦点管理，不重复实现全局键盘监听。

- [ ] **Step 5: 运行行为测试**

Run:

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx -t "CanvasProjectDetail project cover"
```

Expected: 5 tests PASS；样式 describe 尚未执行。

- [ ] **Step 6: 提交组件行为**

```bash
git add apps/desktop/src/renderer/design/views/canvas/CanvasProjectDetail.tsx
git commit -m "feat(canvas): separate project cover preview and upload"
```

### Task 3: 实现双层封面和响应式视觉

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/uiux-v4/projects.less:193-310`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx`

- [ ] **Step 1: 替换旧封面遮罩和裁切样式**

在 `.canvas-projects-page` 范围内将封面相关样式调整为：

```less
.canvas-detail-cover {
  position: relative;
  height: 240px;
  border-radius: var(--canvas-v4-radius-md);
  overflow: hidden;
  background: #111216;
  border: 1px solid var(--canvas-v4-border);
}
.canvas-detail-cover-preview-trigger {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
  overflow: hidden;
}
.canvas-detail-cover-ambient {
  position: absolute;
  inset: -24px;
  width: calc(100% + 48px);
  height: calc(100% + 48px);
  object-fit: cover;
  filter: blur(22px) brightness(0.52) saturate(0.82);
  transform: scale(1.08);
  opacity: 0.72;
  pointer-events: none;
}
.canvas-detail-cover-image {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
  pointer-events: none;
}
.canvas-detail-cover-toolbar {
  position: absolute;
  z-index: 2;
  right: 10px;
  bottom: 10px;
  display: flex;
  gap: 6px;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.canvas-detail-cover:hover .canvas-detail-cover-toolbar,
.canvas-detail-cover:focus-within .canvas-detail-cover-toolbar {
  opacity: 1;
  transform: translateY(0);
}
.canvas-detail-cover-tool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: var(--canvas-v4-radius-sm);
  background: rgba(18, 18, 22, 0.78);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  pointer-events: auto;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.canvas-detail-cover-input { display: none; }
.canvas-detail-cover-empty {
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-faint);
  font-size: 12px;
}
button.canvas-detail-cover-empty { cursor: pointer; }
```

删除旧 `.canvas-detail-cover-overlay`、`.is-uploadable:hover` 整面遮罩、`object-fit: cover`、`object-position: top` 和 `.canvas-detail-cover-actions` 定位规则。

- [ ] **Step 2: 调整标题操作区、预览层与响应式规则**

```less
.canvas-detail-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

@media (max-width: 720px) {
  .canvas-detail-cover { height: 180px; }
  .canvas-detail-cover-tool span { display: none; }
  .canvas-detail-cover-tool { width: 32px; padding: 0; justify-content: center; }
}

@media (prefers-reduced-motion: reduce) {
  .canvas-detail-cover-toolbar { transition: none; }
}
```

在 `.canvas-projects-page` 结束后增加全局 Modal 样式：

```less
.canvas-detail-cover-preview-modal .ant-modal-body {
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: calc(92vh - 60px);
  overflow: auto;
}
.canvas-detail-cover-preview-image {
  max-width: 88vw;
  max-height: calc(92vh - 100px);
  object-fit: contain;
  border-radius: 6px;
  display: block;
}
```

- [ ] **Step 3: 运行全部封面测试**

Run:

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx
```

Expected: 7 tests PASS。

- [ ] **Step 4: 检查并仅暂存本任务样式块**

Run:

```bash
git diff -- apps/desktop/src/renderer/design/views/canvas/uiux-v4/projects.less
git add -p apps/desktop/src/renderer/design/views/canvas/uiux-v4/projects.less
git diff --cached --check
```

Expected: 缓存区只包含封面、标题操作区、预览 Modal 和响应式样式；文件顶部用户已有的背景修改保持未暂存。

- [ ] **Step 5: 提交样式与测试**

```bash
git add apps/desktop/src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx
git commit -m "style(canvas): show complete project covers"
```

### Task 4: 验证、文档落地与变更范围核对

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-canvas-project-cover-layout-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-canvas-project-cover-layout.md`

- [ ] **Step 1: 运行定向测试与 Desktop 类型检查**

Run:

```bash
pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/CanvasProjectDetail.cover.test.tsx
pnpm --filter @spark/desktop typecheck
```

Expected: 封面测试全部 PASS；两个 TypeScript project 均无错误退出。

- [ ] **Step 2: 核对影响范围**

本任务属于局部详情页交互调整，按项目降级规则不启动 GitNexus。使用以下命令确认只影响预期调用点：

```bash
rg -n "canvas-detail-cover|coverPreviewOpen|openCoverPicker" apps/desktop/src/renderer/design/views/canvas
git diff --check
git diff --stat HEAD~2..HEAD
git status --short
```

Expected: 功能改动只涉及 `CanvasProjectDetail.tsx`、`projects.less` 和新测试；工作区原有 `ProvidersView.tsx` 与媒体服务修改保持未暂存、未提交。

- [ ] **Step 3: 更新文档状态**

将设计文档和本计划的状态行改为：

```markdown
> 状态: 已落地 | 最后核对: 2026-08-01
```

- [ ] **Step 4: 提交文档状态并完成最终核验**

```bash
git add docs/superpowers/specs/2026-08-01-canvas-project-cover-layout-design.md docs/superpowers/plans/2026-08-01-canvas-project-cover-layout.md
git commit -m "docs(canvas): mark project cover layout delivered"
git diff --check
git status --short
```

Expected: 文档提交成功；状态只剩用户原有的未提交修改。
