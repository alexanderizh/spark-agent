> 状态: 已落地 | 最后核对: 2026-07-11

# 画布 Agent 助手 — 对话窗口 UI 升级

## 一、目标

把画布 Agent 助手侧面板从「头部参数 + 底部输入」升级为 **Claude / ChatGPT 风格**：
头部极简化、参数选择器下沉为底部胶囊行、输入框改为圆角浮岛、发送按钮内嵌右下角、扁平化收紧间距。

设计稿：`docs/design/canvas-agent-panel-redesign.html`

## 二、审查结论（开工前必读）

### 已确认的关键事实

| 事实 | 结论 |
|------|------|
| `ChatPanel` 的使用者 | **仅 `CanvasAgentModal` 一处**（grep 验证），可放心改结构，无需兼容其他场景 |
| 宽度阈值位置 | 改 `CanvasWorkspaceView.tsx:547-549`（`CANVAS_AGENT_PANEL_*_WIDTH`），不动 `CanvasAgentModal.tsx` 的旧悬浮面板常量（侧栏化后已被 `!important` 覆盖失效） |
| Picker 下拉方向 | 由 `useComposerDropdownPlacement`（`CanvasAgentModal.tsx:287-326`）运行时自适应，移到底部后自动向下展开，**无需改方向逻辑** |
| 共享组件 | `AgentPickerInline`/`ProviderModelPickerInline` 被 3 文件复用 + 2 测试 mock，**只加 className 不改 API**；`SessionPickerInline`/`SkillPickerInline` 仅画布用，可自由改 |
| composer prop 位置 | 渲染在 textarea **上方**（`ChatPanel.tsx:486`），不满足"参数行在下方"的需求，需**新增底部 prop** |

### 必须处理的问题清单

| # | 问题 | 位置 | 处理方式 |
|---|------|------|----------|
| 1 | focus 光晕硬编码 `rgba(22,119,255,...)` 与项目 `--primary`(indigo) 不符 | `ChatPanel.less:803` | 改为 `color-mix(in srgb, var(--primary) 14%, transparent)` |
| 2 | `.canvas-agent-panel { min-width:560px }` 会撑破侧栏（前人注释警告） | `CanvasWorkspaceView.less:10349` | `.canvas-agent-side-panel-inner` 已有 `min-width:0 !important` 覆盖，确认仍成立 |
| 3 | composer prop 在 textarea 上方，需新增底部参数行 prop | `ChatPanel.tsx` | 新增 `composerBelow` prop |
| 4 | 发送按钮需从 input-actions 移入浮岛容器右下角 | `ChatPanel.tsx:503-551` | 重构输入区结构 |
| 5 | textarea 无 auto-resize，需加自适应高度 | `ChatPanel.tsx:517` | onChange 加 `scrollHeight` 自适应，max-height 160px |
| 6 | 头部背景硬编码 `#ffffff 6%/2%` | `CanvasWorkspaceView.less:3436-3437` | 改用变量 |
| 7 | `ChatPanel.less:773-780` + `views.css:3997-4000` 有"强制向上"死 CSS | 两处 | 迁移后清理（因 portal 实际不决定方向，但可能造成偏移） |

## 三、改动清单（7 个文件）

### 文件总览

| 文件 | 改动类型 | 要点 |
|------|----------|------|
| `ChatPanel.tsx` | 结构重构 | 输入区浮岛化 + 新增 `composerBelow` prop + 发送按钮内嵌 + textarea 自适应 |
| `ChatPanel.less` | 样式重构 | 浮岛容器 + 参数行 + 内嵌发送按钮 + 扁平化收紧 + 修 focus 光晕 bug |
| `CanvasAgentModal.tsx` | 布局调整 | 头部极简化 + composerBar 移至底部 + 副标题移入 context-badge |
| `CanvasWorkspaceView.less` | 头部样式 | 极简头部覆盖 + 头部背景改变量 |
| `CanvasWorkspaceView.tsx` | 常量调整 | 宽度阈值 MIN 320→300, DEFAULT 380→400 |
| `views.css` | 清理 | 移除"强制向上"死 CSS（如验证确认不需要） |
| `docs/design/canvas-agent-panel-redesign.html` | 设计稿 | 已完成 v2 |

### 详细任务

#### Task 1: 宽度阈值调整 — `CanvasWorkspaceView.tsx`
```
CANVAS_AGENT_PANEL_DEFAULT_WIDTH: 380 → 400
CANVAS_AGENT_PANEL_MIN_WIDTH:     320 → 300
CANVAS_AGENT_PANEL_MAX_WIDTH:     560 → 560（不变）
```
确认 `.canvas-agent-side-panel-inner { min-width: 0 !important }` 仍覆盖 `.canvas-agent-panel { min-width:560px }`。

#### Task 2: ChatPanel 输入区结构重构 — `ChatPanel.tsx`

**新增 prop**：
```ts
/** 输入框下方的参数行（如会话/Agent/模型/技能选择器） */
composerBelow?: React.ReactNode
```

**输入区新结构**（`chat-panel-input-area` 内）：
```
[sendError]                      ← 错误提示条（浮岛上方）
┌──────────────────────────┐
│ [ref chip] [att chip]     │     ← chip 区（框内顶部）
│ textarea...          [↑]  │     ← textarea + 内嵌发送按钮
└──────────────────────────┘     ← 圆角浮岛容器
[composerBelow]                  ← 参数行（输入框下方）
```

关键改动：
1. textarea + 发送按钮包进 `.chat-panel-input-box` 容器
2. 发送按钮从 `.chat-panel-input-actions` 移出，改为 absolute 定位右下角
3. 「添加文件/目录」按钮缩为图标，移入 `composerBelow`（由 CanvasAgentModal 渲染）
4. textarea 加 auto-resize：onChange 设 `height = scrollHeight`，max-height 160px
5. textarea 右侧 padding 留出发送按钮空间

**状态机保持不变**（`ChatPanel.tsx:417-420`）：
- `disabled`, `canSubmit`, `isWorking`, `canCancel` 逻辑不动
- 发送按钮双态（发送/终止）逻辑不动，只改位置

#### Task 3: ChatPanel 样式重构 — `ChatPanel.less`

**新增样式**：
- `.chat-panel-input-box`：圆角浮岛容器，border + focus 光晕（用 `--primary`）
- `.chat-panel-input-box:focus-within`：border-primary + box-shadow
- 发送按钮 absolute 内嵌样式
- 参数行（复用 composer-bar 下方位置）
- textarea auto-resase + max-height + 右侧 padding

**扁平化收紧**：
- `chat-panel-input-area` padding: `10px 12px 12px` → `6px 10px 8px`
- 消息区 `chat-panel-messages` padding: `12px` → `10px`
- chip 高度 24→22px，间距收紧

**修 bug**：
- `chat-panel-input:focus` 光晕 `rgba(22,119,255,...)` → `color-mix(in srgb, var(--primary) 14%, transparent)`

**清理**：
- `.chat-panel-composer-bar .composer-menu { bottom:100% }` 死 CSS（如验证确认不需要）

#### Task 4: CanvasAgentModal 头部极简化 — `CanvasAgentModal.tsx`

**头部改动**（`canvas-bottom-floating-head`）：
- 移除 `canvas-agent-head-composer`（composerBar 不再在头部渲染）
- 标题精简："画布 Agent 助手" → "画布助手"
- 移除副标题 span（"实时取数 · 固定全权模式..."）
- 全屏/关闭按钮保留

**composerBar 下沉**：
- 通过 ChatPanel 新增的 `composerBelow` prop 传入
- 4 个 Picker 组件 + 附件图标按钮组成参数行
- Picker 组件只加 className 做胶囊化，不改 API

**副标题信息**：
- 合并进 contextBadge：`{项目名} · {画板名} · 已引用 N 节点`
- 详细摘要（节点/资产/任务数）放 tooltip

#### Task 5: 头部样式覆盖 — `CanvasWorkspaceView.less`

- `.canvas-agent-side-panel-inner .canvas-bottom-floating-head`：极简化（去掉 head-composer 的 flex-wrap 布局）
- 头部背景 `#ffffff 6%/2%` → 变量化（`var(--divider)` 或 `var(--bg-soft)`）
- 移除不再需要的 `.canvas-agent-head-composer` 覆盖规则

#### Task 6: 清理死 CSS — `views.css`

- 验证 `.composer-menu { bottom: calc(100% + 6px) }` 在浮岛模式下是否造成偏移
- 如确认不需要则移除或改为不强制方向

## 四、功能完整性检查表

升级后必须保持以下功能正常（均为现有功能，不能丢）：

### 输入区
- [ ] 发送按钮双态：空闲=发送 / 运行中=终止（红方块）
- [ ] 动态 placeholder：初始化中/发送中/回复中/终止中/等待问题回复
- [ ] sendError 错误提示条
- [ ] 节点引用 chip（框内顶部，主色调）
- [ ] 文件附件 chip（框内顶部，中性色）
- [ ] 附件折叠（超 3 个 → "还有 N 个"）
- [ ] 附件上限 toast（超 20 个提示）
- [ ] textarea auto-resize（新增）
- [ ] Enter 发送 / Shift+Enter 换行
- [ ] IME 组合输入判断（`isComposing` / keyCode 229）

### 参数行（新增底部）
- [ ] 会话选择器（SessionPickerInline）
- [ ] Agent 选择器（AgentPickerInline）
- [ ] 模型选择器（ProviderModelPickerInline）
- [ ] 技能入口（SkillPickerInline，打开 SkillsPickerModal）
- [ ] 添加文件按钮（图标）
- [ ] 添加目录按钮（图标）
- [ ] 4 个 Picker 互斥打开（openMenu 状态）
- [ ] Picker 运行中禁用（running/creating）

### 消息区
- [ ] 用户消息 / 助手消息气泡
- [ ] 流式光标 ▋
- [ ] 工具调用卡片（running/完成/折叠详情）
- [ ] 用户问题卡片（多题导航/选项/跳过/提交）
- [ ] 空状态引导
- [ ] pending 消息（用户消息发送中占位 / assistant 执行中占位）
- [ ] 自动滚动（仅当在底部时）

### 面板级
- [ ] loading 覆盖（加载配置中）
- [ ] error 覆盖（致命错误）
- [ ] contextBadge 画布上下文
- [ ] 全屏切换
- [ ] 面板拖拽拉伸（新阈值 300-560px）
- [ ] 草稿持久化（localStorage）
- [ ] composer 偏好持久化（agent/adapter/provider/model/skills）

### 非视觉逻辑（不改动，确认不受影响）
- [ ] 会话创建/切换/历史加载
- [ ] 实时事件订阅（stream:session:agent-event 等）
- [ ] 发送逻辑（handleSend：首轮绑定信息 / 后续轮节点上下文）
- [ ] 草稿防抖落盘 + 卸载 flush

## 五、实施顺序

1. **Task 1**：宽度阈值（最简单，先改）
2. **Task 2 + Task 3**：ChatPanel 结构 + 样式（核心，一起改）
3. **Task 4 + Task 5**：CanvasAgentModal 头部 + 样式覆盖
4. **Task 6**：清理死 CSS
5. **验证**：tsc + 手动检查所有状态

## 六、风险与回滚

- ChatPanel 结构改动较大，但只有 CanvasAgentModal 一个使用者，影响面可控
- Picker 组件不改 API，只加 className，其他 3 个复用方不受影响
- 宽度阈值改动可立即回滚（改回 320/380）
- 设计稿 HTML 作为视觉对照基准
