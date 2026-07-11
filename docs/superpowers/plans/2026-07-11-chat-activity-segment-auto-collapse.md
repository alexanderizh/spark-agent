# 会话中间活动段自动折叠 Implementation Plan

> 状态: [实施中] | 最后核对: 2026-07-11
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单轮会话中已封闭的思考/工具活动段自动折叠为一行摘要，同时保留每段独立展开和用户人工接管能力。

**Architecture:** 在 `chat/` 下新增纯函数模块负责活动块识别、稳定分段和摘要；新增独立 React 组件负责单段的 `open/userExpanded` 状态。`ChatView.tsx` 仅把现有块渲染接到活动段组件，现有 `tool-logs-hidden` 总隐藏层保持不变。

**Tech Stack:** React 19、TypeScript、Vitest、jsdom、现有 UIBlock/Icons/appearance 设置。

---

### Task 1: 活动段切分与摘要

**Files:**

- Create: `apps/desktop/src/renderer/design/views/chat/ChatActivitySegments.ts`
- Test: `apps/desktop/src/renderer/design/views/chat/ChatActivitySegments.test.ts`

- [ ] **Step 1: 写活动段切分红灯测试**

覆盖连续 thinking/tool/terminal/file_change 合并、正文/subagent 边界封口、最后一段未封口以及稳定 key：

```ts
const items = splitChatActivitySegments([
  thinking('think-1', false),
  tool('read-1', 'Read', 'success'),
  text('定位完成'),
  tool('bash-1', 'Bash', 'running'),
])

expect(items).toMatchObject([
  { kind: 'activity', key: 'activity:thinking:think-1', sealed: true },
  { kind: 'content' },
  { kind: 'activity', key: 'activity:tool:bash-1', sealed: false },
])
```

- [ ] **Step 2: 运行测试确认因模块不存在而失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/ChatActivitySegments.test.ts`

Expected: FAIL，提示 `ChatActivitySegments` 模块或导出不存在。

- [ ] **Step 3: 实现最小切分与身份逻辑**

```ts
export type ChatActivityTimelineItem =
  | { kind: 'activity'; key: string; blocks: UIBlock[]; sealed: boolean }
  | { kind: 'content'; key: string; block: UIBlock }

export function splitChatActivitySegments(blocks: UIBlock[]): ChatActivityTimelineItem[] {
  const items: ChatActivityTimelineItem[] = []
  let active: Extract<ChatActivityTimelineItem, { kind: 'activity' }> | null = null
  blocks.forEach((block, index) => {
    if (isChatActivityBlock(block)) {
      active ??= { kind: 'activity', key: activityKey(block, index), blocks: [], sealed: false }
      active.blocks.push(block)
      return
    }
    if (active != null) active.sealed = true
    active = null
    items.push({ kind: 'content', key: contentKey(block, index), block })
  })
  return items
}
```

实现必须把新活动段加入 `items`，并优先使用 `segmentId/toolCallId/checkpointId/path`；只有旧块缺少稳定身份时才回退 turn 内序号。

- [ ] **Step 4: 写摘要与运行状态红灯测试**

```ts
expect(summarizeChatActivitySegment(blocks)).toEqual(
  '查看了 2 个文件 · 运行了 1 条命令 · 修改了 1 个文件 · 进行了思考',
)
expect(isChatActivitySegmentRunning(blocks)).toBe(true)
```

- [ ] **Step 5: 实现分类、摘要和运行状态并跑绿**

分类沿用当前 `getToolLogGroupKind` 语义：Read/Grep/Search 为 read，Bash/Shell 为 command，Edit/Write/apply_patch 为 write，其余 tool_call 为 tool。thinking 的 `isStreaming`、tool 的 pending/running、terminal 的 `isStreaming` 决定运行状态。

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/ChatActivitySegments.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交纯函数切片**

```bash
git add apps/desktop/src/renderer/design/views/chat/ChatActivitySegments.ts \
  apps/desktop/src/renderer/design/views/chat/ChatActivitySegments.test.ts
git commit -m "feat: model chat activity segments"
```

### Task 2: 独立活动段组件

**Files:**

- Create: `apps/desktop/src/renderer/design/views/chat/ActivitySegment.tsx`
- Create: `apps/desktop/src/renderer/design/views/chat/ActivitySegment.css`
- Test: `apps/desktop/src/renderer/design/views/chat/ActivitySegment.test.tsx`

- [ ] **Step 1: 写运行、封口与人工接管红灯测试**

使用 `rerender` 模拟同一稳定 key 的状态更新：

```tsx
root.render(
  <ActivitySegment summary="查看了 2 个文件" running sealed={false}>
    明细
  </ActivitySegment>,
)
expect(toggle()).toHaveAttribute('aria-expanded', 'true')

root.render(
  <ActivitySegment summary="查看了 2 个文件" running={false} sealed>
    明细
  </ActivitySegment>,
)
expect(toggle()).toHaveAttribute('aria-expanded', 'false')

toggle().click()
root.render(
  <ActivitySegment summary="查看了 3 个文件" running={false} sealed>
    更新明细
  </ActivitySegment>,
)
expect(toggle()).toHaveAttribute('aria-expanded', 'true')
```

再添加两个组件实例，验证点击第一段不会改变第二段。

- [ ] **Step 2: 运行测试确认组件不存在**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/ActivitySegment.test.tsx`

Expected: FAIL，提示组件模块不存在。

- [ ] **Step 3: 实现组件状态机**

```tsx
const [open, setOpen] = useState(running || !sealed)
const userExpandedRef = useRef(false)

useEffect(() => {
  if (running && !userExpandedRef.current) setOpen(true)
  else if (sealed && autoCollapseEnabled && !userExpandedRef.current) setOpen(false)
}, [autoCollapseEnabled, running, sealed])

const toggle = () => {
  setOpen((current) => {
    if (!current) userExpandedRef.current = true
    return !current
  })
}
```

组件使用现有 `ActivityLogSummaryIcon`、`Icons.Spinner` 和 chevron。默认只显示一行摘要，明细区域继续渲染现有 ToolLogGroup/ThinkingSection。

- [ ] **Step 4: 增加 `autoCollapseEnabled=false` 与父级隐藏恢复测试**

父级隐藏通过 wrapper class/style 模拟，重新显示后断言组件 `aria-expanded` 未重置。

- [ ] **Step 5: 运行组件测试并确认通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/chat/ActivitySegment.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交组件切片**

```bash
git add apps/desktop/src/renderer/design/views/chat/ActivitySegment.tsx \
  apps/desktop/src/renderer/design/views/chat/ActivitySegment.css \
  apps/desktop/src/renderer/design/views/chat/ActivitySegment.test.tsx
git commit -m "feat: add independent activity segment disclosure"
```

### Task 3: 接入主会话并保持隐藏层独立

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.less`
- Test: `apps/desktop/src/renderer/design/views/chat/ChatActivitySegments.test.ts`
- Test: `apps/desktop/src/renderer/tests/renderer.test.ts`

- [ ] **Step 1: 写渲染组合红灯测试**

为公开的纯组合函数提供 blocks，断言“正文 → 活动 → 正文 → 活动”形成两段，第一段 `sealed=true`、第二段 `sealed=false`；断言 subagent 卡片也切断活动段。

- [ ] **Step 2: 用活动段时间线替换顶层工具批次循环**

`renderBlocksGrouped` 先调用 `splitChatActivitySegments`。content 项仍调用 `renderBlocks`；activity 项渲染：

```tsx
<ActivitySegment
  key={item.key}
  summary={summarizeChatActivitySegment(item.blocks)}
  running={isChatActivitySegmentRunning(item.blocks)}
  sealed={item.sealed}
  autoCollapseEnabled={readAppearance().autoCollapseTools}
>
  {renderActivityBlocks(item.blocks, options)}
</ActivitySegment>
```

原工具同类分组循环改名为 `renderActivityBlocks` 并保持内部行为不变。把 `getToolLogGroupKind` 移到纯函数模块，减少 `ChatView.tsx` 行数。

- [ ] **Step 3: 保持总隐藏逻辑独立**

在现有规则中只增加 activity wrapper：

```less
.msg-bubble-agent.tool-logs-hidden .chat-activity-segment,
.msg-bubble-agent.tool-logs-hidden .tool-log-group,
... {
  display: none;
}
```

不得用 `open=false` 实现总隐藏，也不得让总开关清空段组件的人工状态。

- [ ] **Step 4: 运行聚焦回归**

Run:

```bash
pnpm --filter @spark/desktop exec vitest run \
  src/renderer/design/views/chat/ChatActivitySegments.test.ts \
  src/renderer/design/views/chat/ActivitySegment.test.tsx \
  src/renderer/tests/event-mapper.test.ts
```

Expected: PASS。

- [ ] **Step 5: 运行类型、lint、构建和视觉验证**

Run:

```bash
pnpm --filter @spark/desktop typecheck
pnpm --filter @spark/desktop exec eslint \
  src/renderer/design/views/chat/ChatActivitySegments.ts \
  src/renderer/design/views/chat/ChatActivitySegments.test.ts \
  src/renderer/design/views/chat/ActivitySegment.tsx \
  src/renderer/design/views/chat/ActivitySegment.test.tsx
pnpm --filter @spark/desktop build
```

使用 Playwright Electron 截图验证宽屏/窄屏的运行态、自动折叠态、人工展开态；摘要不得与 spinner/箭头重叠。

- [ ] **Step 6: GitNexus 检测并提交集成切片**

```bash
git add apps/desktop/src/renderer/design/views/ChatView.tsx \
  apps/desktop/src/renderer/design/views/ChatView.less
npx --no-install gitnexus detect-changes --scope staged --repo .
git commit -m "feat: auto collapse completed chat activity segments"
```

### Task 4: 文档落地与终态审查

**Files:**

- Modify: `docs/superpowers/specs/2026-07-11-chat-activity-segment-auto-collapse-design.md`
- Modify: `docs/superpowers/plans/2026-07-11-chat-activity-segment-auto-collapse.md`

- [ ] **Step 1: 五轴审查**

检查正确性、可读性、架构、安全和性能；特别确认稳定 key、用户接管 ref、历史 hydration、总隐藏 CSS 和 React key 没有冲突。

- [ ] **Step 2: 更新文档状态**

测试与视觉验证通过后，把 spec/plan 状态改为 `[已落地]` 并刷新日期为 `2026-07-11`。

- [ ] **Step 3: 检测并提交文档**

```bash
git add docs/superpowers/specs/2026-07-11-chat-activity-segment-auto-collapse-design.md \
  docs/superpowers/plans/2026-07-11-chat-activity-segment-auto-collapse.md
npx --no-install gitnexus detect-changes --scope staged --repo .
git commit -m "docs: record activity segment auto collapse"
```
