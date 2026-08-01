# 无限画布编组折叠 Implementation Plan

> 状态: 实施中 | 最后核对: 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为无限画布编组增加可持久化的文件夹式折叠卡、插页预览悬浮动画和双击展开/折叠交互，同时保持真实组尺寸与子节点布局不变。

**Architecture:** `CanvasNodeData.collapsed` 保存状态；独立纯函数模块从现有 Flow 投影计算隐藏后代、可见边、成员数量和两张封面预览。`CanvasStage` 只消费投影并传递封面数据，`CanvasNode` 负责折叠卡 DOM、菜单和双击切换，样式集中在现有画布样式文件。

**Tech Stack:** React 19、TypeScript、`@xyflow/react`、Less、Vitest。

---

## 文件结构

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.ts` — 折叠投影、后代收集、封面选择和固定尺寸常量。
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.test.ts` — 纯函数行为测试。
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.types.ts` — 增加持久化折叠字段。
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx` — 应用折叠投影并向节点传递封面数据。
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx` — 渲染折叠卡、切换动作和菜单。
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less` — 文件夹三层视觉与悬浮动画。
- Modify: `apps/desktop/src/renderer/design/views/canvas/cinematic/nodes.less` — 避免电影主题覆盖折叠卡结构。
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts` — 关键交互与样式接线回归测试。

### Task 1: 折叠投影与封面模型

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.types.ts`

- [ ] **Step 1: 写失败的纯函数测试**

测试构造展开组、折叠组、嵌套子组、三张图片和跨节点边，断言：

```ts
const projection = buildCanvasGroupCollapseProjection(nodes, edges)
expect(projection.visibleNodes.map((node) => node.id)).toEqual(['group'])
expect(projection.visibleEdges).toEqual([])
expect(projection.presentationByGroupId.get('group')).toMatchObject({
  childCount: 4,
  previews: [
    { kind: 'image', nodeId: 'new-image', url: 'safe-file://new.png' },
    { kind: 'image', nodeId: 'old-image', url: 'safe-file://old.png' },
  ],
})
```

另写测试断言单图补一个 fallback、无图补两个 fallback、父组展开后保留已折叠子组状态、缺少 `collapsed` 的旧节点保持展开。

- [ ] **Step 2: 运行定向测试并确认 RED**

Run:

```bash
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasGroupCollapse.test.ts
```

Expected: FAIL，提示 `canvasGroupCollapse` 模块不存在。

- [ ] **Step 3: 增加类型与最小投影实现**

在 `CanvasNodeData` 增加：

```ts
/** 编组是否以紧凑封面卡展示；缺省为展开。 */
collapsed?: boolean
```

新模块导出固定尺寸、预览类型和投影函数：

```ts
export const COLLAPSED_GROUP_SIZE = { width: 246, height: 218 } as const

export type CanvasGroupPreview =
  | { kind: 'image'; nodeId: string; url: string; title: string }
  | { kind: 'fallback'; slot: 0 | 1 }

export function buildCanvasGroupCollapseProjection(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): {
  visibleNodes: CanvasNode[]
  visibleEdges: CanvasEdge[]
  presentationByGroupId: Map<string, CanvasCollapsedGroupPresentation>
}
```

实现使用 `parentNodeId` 邻接表迭代收集全部后代；只把 `type === 'group' && data.collapsed === true` 作为折叠根。预览从后代图片中过滤有效 `thumbnailUrl ?? url`，按 `createdAt` 降序取两张，并补足两个 fallback。边只要任一端点在隐藏集合中就过滤。

- [ ] **Step 4: 运行定向测试并确认 GREEN**

Run:

```bash
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasGroupCollapse.test.ts
```

Expected: PASS。

### Task 2: 接入 React Flow 投影

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.test.ts`

- [ ] **Step 1: 扩展失败测试覆盖投影尺寸契约**

增加测试断言折叠组 presentation 存在且尺寸常量为 `{ width: 246, height: 218 }`，展开组没有 presentation。

- [ ] **Step 2: 运行测试并确认 RED**

Run 同 Task 1，Expected: FAIL 于缺失的 presentation 尺寸字段。

- [ ] **Step 3: 在 `CanvasStage` 最小接线**

在操作节点投影之后计算：

```ts
const groupCollapseProjection = useMemo(
  () => buildCanvasGroupCollapseProjection(
    operationProjection.visibleNodes,
    operationProjection.visibleEdges,
  ),
  [operationProjection.visibleEdges, operationProjection.visibleNodes],
)
```

节点映射改用 `groupCollapseProjection.visibleNodes`，边映射改用 `groupCollapseProjection.visibleEdges`。`toFlowNode` 新增可选的 `collapsedGroupPresentation` 参数；存在时用固定尺寸覆盖渲染宽高、把 presentation 写入 `CanvasFlowNodeData`，并令 `draggable` 保持现状、`NodeResizer` 由节点组件禁用。持久化的 `node.width` 与 `node.height` 不变。

- [ ] **Step 4: 运行测试与类型检查**

```bash
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasGroupCollapse.test.ts
pnpm --filter @spark/desktop typecheck
```

Expected: 两条命令退出码均为 0。

### Task 3: 文件夹折叠卡与交互

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts`

- [ ] **Step 1: 写失败的交互接线测试**

读取 `CanvasNode.tsx` 源码并断言以下稳定契约存在：

```ts
expect(source).toContain("node.type === 'group' && node.data.collapsed")
expect(source).toContain("actions.updateNodeData?.(node.id, { collapsed: !node.data.collapsed })")
expect(source).toContain('canvas-node-collapsed-group')
expect(source).toContain('canvas-collapsed-group-insert')
expect(source).toContain("node.data.collapsed ? '展开编组' : '折叠编组'")
```

同时断言普通节点的 `actions.editNode(node.id)` 分支保留。

- [ ] **Step 2: 运行测试并确认 RED**

```bash
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts
```

Expected: FAIL 于缺少折叠卡和动作接线。

- [ ] **Step 3: 实现折叠卡 DOM 与动作**

`CanvasFlowNodeData` 增加：

```ts
collapsedGroupPresentation?: CanvasCollapsedGroupPresentation
```

组折叠时：

- 根节点增加 `canvas-node-collapsed-group` 类。
- 不渲染普通 `nodeMetaBar`、`canvas-node-core` 和 quick footer，改为后壳、两个插页、SVG 前挡板、左右图标、节点数和标题组成的专用结构。
- 图片插页使用规范化后的 URL；`onError` 把单个插页切换为 fallback 外观。
- `showResizer` 增加 `!collapsedGroupPresentation` 条件。
- 双击组调用 `updateNodeData` 切换 `collapsed`；非组仍调用 `editNode`。
- 右键组菜单在“多图合并”前增加动态“折叠编组/展开编组”。

- [ ] **Step 4: 运行交互测试并确认 GREEN**

```bash
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts
```

Expected: PASS。

### Task 4: 三层视觉、动画与主题兼容

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/cinematic/nodes.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts`

- [ ] **Step 1: 增加失败的样式契约测试**

断言 Less 中包含 `.canvas-collapsed-group-back`、`.canvas-collapsed-group-insert`、`.canvas-collapsed-group-front`、折叠组 hover 位移，以及：

```less
@media (prefers-reduced-motion: reduce)
```

- [ ] **Step 2: 运行测试并确认 RED**

Run 同 Task 3，Expected: FAIL 于缺少样式选择器。

- [ ] **Step 3: 实现已确认的 A 方案样式**

样式使用约 246×218 的纵向卡片比例：后壳圆角 28px；两张插页位于后壳和前挡板之间；前挡板通过内联 SVG path 绘制左高右低的柔和边缘；左右分别显示编组网格图标和状态线图标。hover 时两张插页分别 `translateY(-17px)` 与 `translateY(-20px)`，动画为约 320ms 的缓出曲线。减少动态效果偏好下禁用位移和过渡。

电影主题只调整配色，不再把折叠组正文设为透明或覆盖专用层级。

- [ ] **Step 4: 运行交互测试与格式检查**

```bash
pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts
git diff --check
```

Expected: 测试通过且 `git diff --check` 无输出。

### Task 5: 全量验证、文档落地与 GitNexus 更新

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-canvas-collapsible-groups-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-canvas-collapsible-groups.md`

- [ ] **Step 1: 运行相关画布测试**

```bash
pnpm --filter @spark/desktop test:unit -- \
  src/renderer/design/views/canvas/canvasGroupCollapse.test.ts \
  src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts \
  src/renderer/design/views/canvas/canvasNodeChrome.test.ts \
  src/renderer/design/views/canvas/canvasOperationProjection.test.ts
```

Expected: 全部通过。

- [ ] **Step 2: 运行 Desktop 类型检查**

```bash
pnpm --filter @spark/desktop typecheck
```

Expected: 退出码 0。

- [ ] **Step 3: 更新文档状态**

把设计文档和实施计划顶部状态改为：

```md
> 状态: 已落地 | 最后核对: 2026-08-01
```

- [ ] **Step 4: 更新 GitNexus 索引并核对变更**

```bash
npx gitnexus analyze
git diff --check
git status --short
```

Expected: GitNexus 分析完成；diff 无空白错误；状态仅包含本功能文件和用户原有未提交修改。

- [ ] **Step 5: 提交实现**

仅暂存本功能文件，保留工作区中与侧栏、MCP、定时任务等相关的用户修改：

```bash
git add \
  apps/desktop/src/renderer/design/views/canvas/canvas.types.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapse.test.ts \
  apps/desktop/src/renderer/design/views/canvas/canvasGroupCollapseIntegration.test.ts \
  apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx \
  apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx \
  apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less \
  apps/desktop/src/renderer/design/views/canvas/cinematic/nodes.less \
  docs/superpowers/specs/2026-08-01-canvas-collapsible-groups-design.md \
  docs/superpowers/plans/2026-08-01-canvas-collapsible-groups.md
git commit -m "feat(canvas): add collapsible group covers"
```
