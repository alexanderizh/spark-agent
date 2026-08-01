# 无限画布 UI 与 CSS 架构治理专项计划

> 状态: 实施中 | 最后核对: 2026-08-01

## 1. 结论与目标

这次专项不能被定义为“换一套颜色、圆角和阴影”。当前体验落后主要来自两个互相放大的问题：

1. **产品视觉层级不清**：画布、节点、工具栏、配置区、Agent 对话都在争夺注意力，真正的创作内容反而缩得很小。
2. **样式所有权失控**：历史全局样式、组件局部 Less、第三方组件样式和 `uiux-v4` 覆盖层同时生效，依靠加载顺序、选择器权重和 `!important` 维持表面稳定。

专项目标是建立一套“影视创作台”式的无限画布体验，并把它放在可长期维护的样式架构上：

- 内容优先：图片、视频、分镜和生成状态成为第一视觉层级。
- Agent 与画布协同：右侧 Agent 是持续存在的创作搭档，不是遮挡画布的普通聊天弹窗。
- 控件按需出现：常驻区域只放全局动作，节点动作在选中或悬停时出现，复杂参数进入检查器。
- 统一设计语言：画布外壳、节点、浮层、面板、任务卡、输入框共享同一组 token 和状态语义。
- 样式可证明地隔离：新样式不污染工作台，旧样式也不能通过加载顺序反向覆盖画布。
- 改造可灰度、可回滚：视觉迁移不改变生成任务、画布数据、工作流协议和持久化结构。

不复制 Seko 的品牌、图标或具体素材，只吸收其信息层级、创作流组织和交互原则。

### 1.1 当前实施进度（2026-07-29）

已完成首个可运行的 Cinematic vertical slice：

- 工作区通过唯一 `cinematic/index.less` 入口加载新视觉；历史结构样式与 Cinematic 样式由 Cascade Layer 明确排序，不再引用 V4 皮肤。
- Agent 从左侧 overlay 调整为右侧真实布局列，并保留拖拽宽度、会话保活和折叠能力。
- 底部大 Dock 改造成左侧竖向创作工具轨道。
- 顶部项目栏新增“交给 Agent”主动作，并统一保存、导出、上传和自动整理的层级。
- 多选网格排列支持松开鼠标后保留划选高亮；右上角自动整理在宫格模式复用同一列数选择交互。
- 新增真实可操作的空画布创作入口，可打开 Agent、Inline AI、工作流库或导入文件。
- 节点、端口、连线、选中态、运行态和上下文工具条进入 Cinematic 视觉体系。
- 新增 `overview / compact / detail` 三档缩放 LOD，低缩放级别会主动减少不可读信息。
- 新样式拆分为 token、vendor、shell、nodes、agent、overlays 六个 owner，并由单一入口装配；连同 Overlay Host CSS Module 共 1,347 行，单文件低于 600 行，没有新增 `!important` 或任意数字 z-index。
- Electron production build、空画布、三素材节点、右侧 Agent 与工作流抽屉的真实 E2E 截图验收已通过。
- Phase 2 已移除新画布根节点的 `canvas-uiux-v4` 标记和 V4 样式入口依赖；旧结构样式进入低优先级 `canvas-legacy` Cascade Layer，新 owner 统一进入 `canvas-cinematic` Layer。
- XYFlow 基础样式与画布第三方覆盖进入 `cinematic/vendor.less`；新增画布专属 Overlay Host，host 本身使用 CSS Module，Dropdown / Select / Popover 不再默认直接污染 `body`。
- Workspace 顶部 Chrome、右侧属性面板、节点编辑器、浮动节点工具条、截图工具、布局工具、任务输入和影视工具已由独立模块接管；`CanvasWorkspaceView.tsx` 从基线 10,123 行降至 8,045 行，Phase 2 继续拆分 Controller / Commands。
- 图片和视频统一为扁平满铺媒体 Frame；loaded / empty 不再切换额外标题栏高度，避免加载前后布局跳动。文本、操作和分组保留各自尺寸语义，运行跑马灯、失败边界和 LOD 均有真实状态矩阵截图。

尚未完成：把 `CanvasWorkspaceView.tsx` Controller 拆到 3,000 行以下、迁移全部专用工作台和将画布历史样式总量降低 40%。这些继续按 Phase 2–5 推进。

## 2. 调研范围与证据

本计划基于：

- 用户提供的 6 张 Seko 首页、创作输入、Agent 对话和无限画布截图。
- Seko [产品说明](https://seko.sensetime.com/about)与商汤对无限画布的[公开介绍](https://www.sensetime.com/kr/news-detail/51170723?categoryId=51172&gioIndex=1)。
- 当前仓库中的画布源码、样式入口、E2E 截图和现有 `uiux-v4` 规则。

邀请页面本身受访问策略限制，无法完整抓取交互 DOM。因此竞品结论以截图和公开产品资料为依据，不推断未被观察到的实现细节。

## 3. 为什么竞品显得更成熟

### 3.1 它先设计“创作空间”，再设计控件

竞品的无限画布以大面积纯黑工作区承载内容，顶部导航、左侧工具组、底部视口控制和右侧 Agent 都贴边或悬浮，中央始终留给素材和生成结果。控件本身没有大面积背景和强分割线，因此用户首先看到的是作品，而不是软件框架。

当前 Spark 画布虽然功能更丰富，但顶部条、底部 Dock、检查器、节点壳和各种操作入口同时存在，视觉上更接近“功能控制台”。内容在适配全图后被缩得过小，节点标题、类型标签、状态和连线又使用相近灰度，导致信息多但识别慢。

### 3.2 它把复杂度放进渐进披露

竞品首页只给一个主输入框、少量 Skill 推荐和内容模板；进入画布后，生成任务通过右侧 Agent 的结构化卡片呈现，节点选中后才显示操作。复杂能力存在，但不会在第一眼全部暴露。

Spark 当前不少节点同时承载标题、类型、Prompt、参数、任务状态、输出、操作按钮和血缘信息。每个能力都“可见”，但没有定义哪一个是当前阶段最重要的。

### 3.3 它的视觉语法非常克制

- 大多数表面只使用 3–4 档中性黑灰。
- 强调色只用于主动作、确认态和会员信息，不负责装饰。
- 卡片圆角、描边、阴影、图标尺寸和控件高度高度一致。
- 图片和视频尽量满幅展示，文本退到标题或说明层。
- 连线默认弱化，选中或执行时才提高对比度。
- Agent 工具调用被折叠成状态行或小卡片，避免日志淹没对话。

这使界面即使信息很多，也不会显得“每一块都是一个独立插件”。

### 3.4 它把 Agent 结果直接映射为生产对象

竞品右侧不是纯文本聊天：提示词确认、参考素材、生成任务、分镜结果和重新提交都用具有明确状态的卡片承载。画布上的节点和 Agent 中的执行记录形成同一套对象语言。

Spark 已经具备画布 Agent、工具调用、节点引用和任务能力，但视觉层仍大量复用通用 ChatPanel 与通用组件样式，导致“能力很强，呈现像普通聊天”。

## 4. 当前工程基线与根因

以下数字是 2026-07-29 对当前源码的静态审计结果：

| 项目                        |              当前值 | 风险                                                                  |
| --------------------------- | ------------------: | --------------------------------------------------------------------- |
| `CanvasWorkspaceView.tsx`   |           10,123 行 | 状态、命令、布局和渲染耦合，任何视觉调整都可能碰到业务逻辑            |
| `CanvasStage.tsx`           |            2,770 行 | 已接近项目 3,000 行红线                                               |
| `CanvasNode.tsx`            |            1,582 行 | 多种节点语义集中在单一渲染器                                          |
| `CanvasWorkspaceView.less`  |           14,175 行 | 同一类组件在文件不同位置多次定义                                      |
| 画布目录样式总量            |        约 28,200 行 | 缺少明确 owner，删除旧规则困难                                        |
| 画布样式中的 `!important`   |              274 处 | 通过权重修补冲突，而不是通过边界解决                                  |
| 画布样式中的 `z-index`      |              139 处 | 没有统一层级协议，出现 64、90、999、1000、1450、3400、9999 等多套尺度 |
| 全设计目录中的 `!important` |    553 处 / 29 文件 | 污染不只存在于画布内部                                                |
| `views.css`                 | 16,783 行并全局加载 | 通用类和第三方组件覆盖会进入所有页面                                  |

### 4.1 样式加载顺序不是稳定契约

`main.tsx` 一次性全局加载：

1. `styles.css`
2. `views.css`
3. `interactions.css`
4. `board.css`
5. `global-overrides.css`

进入画布后，又由组件异步加载 `CanvasWorkspaceView.less`、`canvas-workflow.less`、`uiux-v4/index.less` 和多个功能 Less。`canvas-workflow.less` 目前被三个组件重复导入，`@xyflow/react/dist/style.css` 也存在多个入口。Vite 可能去重资源，但代码分包、懒加载和进入路由的先后顺序仍会改变样式注入时机。

因此，“哪个规则最后赢”依赖运行路径，而不是显式架构。

### 4.2 V4 是覆盖层，不是替换层

当前 `.canvas-workspace.canvas-uiux-v4` 在旧 `CanvasWorkspaceView.less` 之上继续覆盖按钮、Ant 表单、节点、面板和工作台。旧规则仍然存在，新规则必须不断提高作用域或追加 `!important`。

只要继续沿用该方式，V5、V6 都会变成新的补丁层，无法真正结束污染。

### 4.3 第三方组件和 Portal 破坏局部作用域

Ant Modal、Popover、Dropdown 等内容可能 Portal 到 `body`。如果样式只写在 `.canvas-workspace` 下，Portal 内容拿不到局部 token 或作用域；如果为了让 Portal 生效而直接覆盖 `.ant-*`，又会污染普通聊天、设置页和工作台。

仓库现有 E2E 产物曾出现画布工作流抽屉接近裸 DOM 的状态，说明“源码里有 CSS”不等于“生产构建里按预期生效”。现有测试主要检查元素存在或源码包含某段字符串，尚未把最终计算样式和截图作为回归门槛。

### 4.4 类名和层级缺少所有权

当前可以观察到：

- `.canvas-agent-modal` 等类在同一大文件的不同位置重复定义。
- `.ant-btn`、`.ant-select`、`.ant-modal-content` 等第三方类在多个文件重复接管。
- `.muted`、`.modal-title`、`.alert-banner` 等语义过宽的类在不同功能中重复出现。
- z-index 使用业务数字而不是层级 token，新浮层只能继续加大数字。
- 组件文件自行导入共享样式，同一个功能没有唯一的样式入口。

## 5. 目标体验：“Cinematic Production Desk”

### 5.1 总体布局

```text
┌────────────────────────── 48px 顶部项目栏 ──────────────────────────┬──────────────┐
│ 项目 / 画布名 / 保存状态                分享  导出  更多            │ Agent 标题栏  │
├──────┬──────────────────────────────────────────────────────────────┤              │
│ 44px │                                                              │ 360–480px    │
│ 工具 │                    无限画布内容区                              │ Agent 时间线  │
│ 轨道 │                                                              │              │
│      │         节点选中时出现上下文工具条                            │ 工具调用卡片  │
│      │                                                              │ 生成任务卡片  │
│      │                                                              │              │
│      │  左下：缩放/适配       中下：选区动作       右下：小地图       │ 底部输入器    │
└──────┴──────────────────────────────────────────────────────────────┴──────────────┘
```

布局原则：

- 画布永远是面积最大的主区域。
- 顶部栏只放项目级动作，不放节点级动作。
- 左侧工具轨道只放创建、选择、手型、资源和工作流入口。
- 节点级操作跟随选区出现，不长期占用顶部和底部空间。
- 右侧 Agent 默认为 400px，可收起、拖宽到 520px；窄窗口下改为覆盖式抽屉。
- 小地图、缩放和自动整理分离，避免一个巨大 Dock 承载所有能力。

### 5.2 视觉基调

深色模式作为首个旗舰体验，浅色模式从相同语义 token 派生，不再分别写两套组件规则。

| 语义             | 深色建议值              | 用途                 |
| ---------------- | ----------------------- | -------------------- |
| `canvas.bg`      | `#0B0D10`               | 无限画布底色         |
| `surface.1`      | `#121519`               | 工具条、Agent 主表面 |
| `surface.2`      | `#181C21`               | 节点、输入器、浮层   |
| `surface.3`      | `#20252B`               | 悬停、选中前状态     |
| `border.subtle`  | `rgba(255,255,255,.07)` | 默认边界             |
| `border.strong`  | `rgba(255,255,255,.14)` | 激活浮层和可拖拽边界 |
| `text.strong`    | `#F2F4F7`               | 标题和关键数据       |
| `text.default`   | `#C4CBD4`               | 正文                 |
| `text.muted`     | `#7D8795`               | 辅助信息             |
| `accent.primary` | `#7167F5`               | 主操作、选中和焦点   |
| `state.success`  | `#38C98B`               | 已完成               |
| `state.warning`  | `#F0B85A`               | 等待和警告           |
| `state.danger`   | `#F06A72`               | 失败和破坏性操作     |

具体色值在实施前通过真实屏幕对比和 WCAG 对比度校验微调，语义名称与使用规则先固定。

### 5.3 空间、圆角和动效

- 基础 4px 网格；常用间距 4 / 8 / 12 / 16 / 24 / 32。
- 图标按钮 32px，主要输入和桌面表单 36px；触控模式扩展到 44px。
- 节点圆角 10px，浮层 12px，输入器 14px；不在同一层级混用大量圆角。
- 常规动效 160–220ms；进入用 ease-out，退出用 ease-in。
- 只动画 `transform` 与 `opacity`，拖拽和缩放期间禁用装饰性动画。
- 完整支持 `prefers-reduced-motion`。

### 5.4 节点体系

节点不再由一个万能卡片承担所有内容，拆成明确家族：

| 节点家族            | 第一视觉层级 | 默认展示                        | 复杂信息去向         |
| ------------------- | ------------ | ------------------------------- | -------------------- |
| 图片/角色/场景/道具 | 素材本身     | 满幅预览 + 单行标题 + 状态      | 检查器               |
| 视频/分镜           | 画面与时间   | 预览 + 时长/镜头号              | 检查器或视频工作台   |
| 文本/剧本           | 可读内容     | 标题 + 6–10 行摘要              | 双击编辑或专用编辑器 |
| 生成操作            | 任务状态     | 输入摘要 + 模型 + 进度 + 主动作 | 展开任务详情         |
| 分组/章节           | 结构关系     | 标题、数量、完成度              | 组级检查器           |

统一状态语法：

- 默认：弱描边，无重阴影。
- Hover：边界提高一档，不缩放节点。
- Selected：2px accent focus ring + 轻微外发光。
- Running：边缘或底部显示可停用的进度动效，不让整卡闪烁。
- Success：成功色只出现在状态点和完成图标。
- Error：错误色边界 + 简短原因 + 就地重试，不整卡铺红。

### 5.5 缩放层级（LOD）

无限画布必须随缩放改变信息密度：

- `< 45%`：只显示素材缩略图、节点类型和状态点，隐藏正文与次级按钮。
- `45%–80%`：显示标题、关键状态和单行摘要。
- `> 80%`：显示完整节点内容和可编辑入口。
- 选中节点无论缩放级别都保留标题与选中状态，但复杂操作仍放在上下文工具条。

这样用户既能看全局流程，也能在局部进行精细编辑，而不是把整张 UI 等比缩成不可读的小图。

### 5.6 连线和血缘

- 默认连线使用低对比中性灰，避免形成“蜘蛛网”。
- 选中节点时仅高亮它的一跳上下游；其余连线降到 12%–18% 不透明度。
- 任务执行时高亮当前路径，完成后恢复中性状态。
- 连线颜色表达关系类型时必须同时配合端口形状或标签，不能只依赖颜色。
- 自动布局优先降低交叉；同源多线允许在视觉层合束，但数据层仍保留独立 edge。

### 5.7 Agent 侧栏

Agent 侧栏继续复用现有运行时和会话数据，但使用画布专属呈现层：

- 顶部：Agent 身份、模型、连接状态、历史会话和收起按钮。
- 中部：自然语言消息、折叠后的工具调用、画布对象引用、任务卡和异常卡。
- 任务卡：缩略图、类型、状态、模型、耗时、重新执行和“定位到画布”。
- 工具调用：默认一行摘要；只有排障时展开参数和原始结果。
- 底部输入器：选中节点引用、附件、Skill、模型和发送动作形成一个完整表面。
- Agent 新建或修改节点后，画布短暂聚焦结果并显示可撤销反馈。

## 6. CSS 架构目标

### 6.1 单一功能样式入口

新增一个唯一入口：

```text
canvas/styles/index.less
├── layers.less
├── tokens.less
├── foundation.less
├── vendor/
│   ├── xyflow.less
│   └── antd.less
├── shell/
├── nodes/
├── panels/
├── overlays/
└── utilities.less
```

只有画布功能边界导入 `canvas/styles/index.less`。子组件不再重复导入共享 Less；真正独立的组件使用 `*.module.less` 并随组件导入。

### 6.2 Cascade Layer 明确优先级

统一声明：

```css
@layer canvas.reset, canvas.tokens, canvas.vendor, canvas.base,
       canvas.components, canvas.utilities, canvas.overrides;
```

- `reset`：仅画布根下的局部 reset。
- `tokens`：主题、密度、层级和动效变量。
- `vendor`：XYFlow、Ant/Lobe 的唯一适配层。
- `base`：画布排版和可访问性基础。
- `components`：Shell、节点、面板和浮层。
- `utilities`：少量稳定工具类。
- `overrides`：迁移期白名单；最终应接近空文件。

不再依靠文件“最后加载”来解决冲突。

### 6.3 CSS Modules + 根命名空间

- 新组件默认使用 `*.module.less`，避免类名进入全局空间。
- 必须覆盖第三方 DOM 时，只能写在 `vendor/` 中，并以 `.spark-canvas-root` 或专用 `rootClassName` 为边界。
- 禁止在画布组件文件内直接写裸 `.ant-btn`、`.ant-modal-content`、`button`、`input`、`.muted` 等选择器。
- 对外暴露的稳定测试钩子使用 `data-ui` / `data-state`，不让测试依赖模块哈希类名。

### 6.4 Portal 统一归宿

新增 `CanvasOverlayHost`：

- 在 `.spark-canvas-root` 内创建 overlay 容器。
- Ant Popover、Dropdown、Tooltip、Select、Modal 优先通过 `getPopupContainer` / `getContainer` 放入该容器。
- 必须挂到 `body` 的窗口级 Modal 使用唯一 `rootClassName="spark-canvas-overlay"`，token 同步到 overlay root。
- E2E 覆盖 Portal 打开前后，验证计算样式、焦点、裁切和 z-index。

这能同时解决“局部规则管不到 Portal”和“全局 `.ant-*` 污染其它页面”两个问题。

### 6.5 统一 z-index 协议

禁止继续写业务数字，改用 token：

| Token                  |  值 | 层级                      |
| ---------------------- | --: | ------------------------- |
| `--z-canvas-content`   |   0 | 节点与连线                |
| `--z-canvas-selection` |  10 | 选框、端口、选中状态      |
| `--z-canvas-chrome`    |  20 | 工具轨道、缩放和小地图    |
| `--z-canvas-context`   |  30 | 节点上下文工具条、菜单    |
| `--z-canvas-panel`     |  40 | 检查器、Agent、工作流面板 |
| `--z-canvas-popover`   |  50 | Select、Popover、Dropdown |
| `--z-canvas-modal`     |  60 | 模态工作台                |
| `--z-canvas-toast`     |  70 | Toast 和阻断错误          |

不同层级通过 `isolation: isolate` 建立可预测的 stacking context，不再出现 `9999` 竞争。

### 6.6 样式治理门禁

引入 Stylelint 或等价的仓库脚本，至少执行：

- 禁止新增 `!important`；vendor 白名单必须带原因注释。
- 限制最大选择器嵌套深度和 specificity。
- 禁止画布模块出现未限定的标签选择器和通用语义类。
- 禁止任意 z-index 数字。
- 检查重复选择器和同一组件多 owner。
- 检查单样式文件行数，建议不超过 600，硬上限 1,000。
- PR 中输出画布 CSS 总体积、规则数、`!important` 数和重复选择器变化。

## 7. React 组件拆分方案

视觉重构前先把 10,123 行的 `CanvasWorkspaceView.tsx` 拆成可独立验证的边界。拆分不改变现有数据结构和任务行为。

```text
canvas/workspace/
├── CanvasWorkspacePage.tsx          # 路由/加载/错误边界，目标 < 300 行
├── CanvasWorkspaceShell.tsx         # 外壳与区域布局，目标 < 500 行
├── CanvasWorkspaceChrome.tsx        # 顶栏、工具轨道、视口控件
├── CanvasSelectionToolbar.tsx       # 选区上下文动作
├── CanvasOverlayHost.tsx            # Portal 与层级入口
├── CanvasAgentDock.tsx              # 画布专属 Agent 呈现层
├── controller/
│   ├── useCanvasWorkspaceController.ts
│   ├── useCanvasPersistence.ts
│   ├── useCanvasViewportCommands.ts
│   ├── useCanvasFileDrop.ts
│   └── useCanvasKeyboardShortcuts.ts
└── commands/
    ├── nodeCommands.ts
    ├── mediaCommands.ts
    ├── filmCommands.ts
    └── workflowCommands.ts
```

节点渲染拆分为：

```text
canvas/nodes/
├── CanvasNodeFrame.tsx
├── MediaNode.tsx
├── TextNode.tsx
├── OperationNode.tsx
├── GroupNode.tsx
├── NodeStatus.tsx
├── NodePorts.tsx
└── useCanvasNodeLod.ts
```

约束：

- 单一代码文件不得超过项目规定的 3,000 行；本专项目标是页面/组件通常不超过 800 行。
- 业务命令与 React 展示分离，视觉替换不重写任务提交逻辑。
- 节点家族共享 `CanvasNodeFrame`，不再复制标题栏、状态、选中态和端口样式。
- 通用 ChatPanel 只保留数据/Markdown 能力，画布 Agent 的任务卡和工具卡拥有独立 renderer。

## 8. 分阶段实施路线

以下估时按 1 名前端主力计算；若两人并行，样式架构与节点/Agent 可交错进行，但合并仍按阶段门禁。

### Phase 0：基线与止血（2–3 人日）

交付：

- 固定 1440×900、1920×1080、1280×720 三档截图基线。
- 覆盖空画布、复杂流程、节点选中、任务运行、Agent 打开、Modal/Popover、浅色和深色。
- 增加 `test:e2e:visual`，测试前强制生成新 production build，避免读取陈旧 `out/`。
- 生成样式清单：文件 owner、入口、选择器数量、`!important`、z-index、重复选择器和 Portal 列表。
- 规定迁移期间不得继续向 `CanvasWorkspaceView.less`、`views.css` 添加画布视觉规则。
- 添加 `canvas-ui-next` 特性开关，允许新旧 UI 即时回退。

退出条件：每个后续改动都能用稳定截图和指标比较，不再依赖人工“看起来差不多”。

### Phase 1：一周可见的垂直样板（4–5 人日）

先做一个可评审的真实切片，而不是先重构数周：

- 建立新 token、单一样式入口、Cascade Layer 和 Overlay Host。
- 实现新画布 Shell、顶部栏、左工具轨道、右 Agent 外框、缩放控件和小地图外观。
- 迁移一种图片节点和一种生成操作节点，包含 LOD、选中态、运行态和错误态。
- 使用真实项目数据和真实生成任务，不做脱离代码的静态 Demo。
- 输出深色 1440×900 样板截图，与竞品截图并排评审信息层级。

退出条件：证明新样式不会污染普通聊天/设置页，并确定后续节点语言。

### Phase 2：样式隔离与 Workspace 拆分（5–7 人日）

- 拆出 Workspace Shell、Controller、Commands、Chrome 和 Overlay Host。
- 清理重复的共享样式 import，只保留功能级入口。
- 把 Ant/Lobe/XYFlow 覆盖迁入 vendor adapter。
- 建立 z-index token 和 Portal 容器。
- 将已迁移组件改为 CSS Modules。
- 为旧 UI 添加明确的 legacy root，禁止旧选择器命中新 UI。

退出条件：新 UI 不再依赖 `uiux-v4` 的覆盖顺序；主要外壳文件低于 3,000 行。

### Phase 3：节点、连线与画布交互（5–7 人日）

- 完成媒体、文本、操作、分组四类节点家族。
- 引入缩放 LOD、统一状态、上下文工具条和检查器职责。
- 优化连线默认态、选中血缘、执行路径和端口可发现性。
- 调整自动布局的节点间距、分组边界和多线交叉策略。
- 对 300 节点 / 400 连线基准项目做 React Profiler 和帧率测试。

退出条件：所有节点类型进入新 Frame；拖拽、缩放、框选和任务更新无明显掉帧或布局跳动。

### Phase 4：Agent、任务卡与工作台（4–6 人日）

- 把 Canvas Agent 从“通用聊天皮肤”升级为画布专属 Dock。
- 统一工具调用、提示词确认、引用素材、生成任务和失败重试卡片。
- 迁移工作流抽屉、参数配置器、预设中心、批任务面板和常用 Modal。
- 所有 Overlay 接入统一 host；消除 Portal 全局覆盖。
- 在 Agent 执行结果与画布节点之间建立“定位、选中、重试、撤销”的视觉闭环。

退出条件：核心路径可从自然语言输入持续完成“创建节点—生成—查看—修改—重试”，不需要用户在多个风格割裂的面板间切换。

### Phase 5：删除旧层与发布验收（3–5 人日）

- 删除已被替代的 `CanvasWorkspaceView.less` 段落和 `uiux-v4` 覆盖，不保留双轨规则。
- 将 `canvas-ui-next` 设为默认，保留一个版本周期的回退开关。
- 跑视觉、交互、无障碍、性能、类型检查、单测和 Electron E2E。
- 更新官网无限画布截图与用户引导，避免营销素材继续展示旧 UI。
- 一个稳定版本后删除 legacy 开关和剩余旧样式。

退出条件：新 UI 成为唯一默认路径，CSS 指标达到第 9 节门槛。

## 9. 硬性验收标准

### 9.1 视觉与体验

- 在 1440×900 下，画布打开 Agent 后仍有至少 900px 的有效创作宽度，或自动进入覆盖式窄屏策略。
- 主要素材节点在 100% 缩放下无需悬停即可识别内容、标题和状态。
- 45% 以下缩放不显示不可读正文，改用 LOD 摘要。
- 同一屏只允许一个主强调色；成功、警告、错误只表达状态。
- 所有图标来自统一 SVG 图标集，尺寸、线宽和按钮盒一致。
- 普通文字对比度不低于 4.5:1；焦点清晰可见；关键操作可键盘完成。
- 深色和浅色模式都通过空画布、复杂画布、Agent、Modal、Popover 的截图矩阵。

### 9.2 CSS 与组件架构

- `CanvasWorkspaceView.tsx` 完成拆分且低于 3,000 行；新增组件原则上低于 800 行。
- 删除 `CanvasWorkspaceView.less` 巨型 owner，单样式文件硬上限 1,000 行。
- 画布样式总量从约 28,200 行至少下降 40%，且不存在重复迁移层。
- 画布 `!important` 从 274 处降到不超过 12 处；每一处均位于 vendor 白名单并带原因。
- z-index 只使用设计 token，不允许新增任意数字。
- 画布模块中不存在未隔离的 `.ant-*` 覆盖。
- `canvas-workflow.less`、XYFlow 样式等共享资源只有一个生产入口。
- 新样式不改变 Chat、Settings、Providers、Workflow 等非画布页面的计算样式和视觉快照。

### 9.3 稳定性与性能

- Electron production build 后再执行视觉测试，不能复用陈旧 `out/`。
- 300 节点 / 400 连线基准画布平移和缩放的目标平均帧率不低于 55 FPS，P95 交互帧不高于 24ms；测试机器需固定并记录。
- 拖拽期间不触发大面积阴影、模糊和布局属性动画。
- Agent 流式输出不导致整个画布或全部节点重渲染。
- Modal、Dropdown、Tooltip、Select 在窗口缩放、侧栏收起和全屏下均不被裁切或压在错误层级。
- 关键截图差异必须人工确认后更新 baseline，不能用批量覆盖快照掩盖回归。

## 10. 测试矩阵

| 维度   | 场景                                               |
| ------ | -------------------------------------------------- |
| 主题   | 深色、浅色、高对比度                               |
| 视口   | 1280×720、1440×900、1920×1080                      |
| 内容   | 空、20 节点、100 节点、300 节点                    |
| 节点   | 图片、视频、文本、操作、分组、失败、运行中         |
| 缩放   | 25%、45%、75%、100%、160%                          |
| 面板   | Agent 开/关、检查器开/关、双侧栏、窄屏覆盖         |
| 浮层   | Tooltip、Select、Popover、Dropdown、Modal、Toast   |
| 输入   | 鼠标、触控板、键盘、reduced motion                 |
| 工作流 | 创建、连线、生成、重试、取消、删除、撤销、自动布局 |

测试类型：

- 单元测试：LOD、状态映射、布局策略、token 和 z-index 契约。
- 组件测试：节点家族、任务卡、Agent 卡片、Overlay Host。
- 计算样式测试：关键组件的 display、position、颜色、层级和可点击区域。
- Playwright/Electron 视觉回归：真实 production build 的截图断言。
- 性能基准：固定数据集、固定窗口、固定机器记录 React commit 和帧率。
- 人工设计走查：每个 Phase 只评审有限的关键屏，不在最后一次性发现系统性问题。

## 11. 风险、边界与回滚

### 11.1 主要风险

- **大文件拆分误伤行为**：先迁移纯函数和命令，再移动状态；每一步保持测试通过。
- **Portal 改宿主影响焦点**：专门测试 focus trap、Esc、窗口拖拽区域和多窗口模式。
- **新旧样式并存互相命中**：新 UI 使用独立 root 与 CSS Modules；旧样式只在 legacy root 下生效。
- **美观但性能下降**：禁用大面积 blur 和持续动画，节点阴影在低缩放级别降级。
- **一次迁移范围过大**：每个节点家族独立迁移，特性开关允许整页回退，而不是运行时混搭单个节点皮肤。

### 11.2 本专项不改

- Canvas snapshot、节点/边/任务协议。
- Provider 路由、媒体生成参数和任务执行语义。
- 画布工作流持久化和 Agent 工具契约。
- 图片标注、3D 导演台、视频工作台的业务功能；只统一它们的入口和外层视觉。

### 11.3 回滚方式

- `canvas-ui-next` 以页面级开关控制，不在节点级混用两套 UI。
- 新 UI 只消费现有 workspace API；出现阻断问题时可退回 legacy renderer。
- legacy 保留一个稳定版本周期；达到视觉、功能和性能门槛后再删除。

## 12. 首个迭代的具体文件范围

首个迭代建议只触碰以下边界，避免同时改业务协议：

- 新增：`apps/desktop/src/renderer/design/views/canvas/styles/`
- 新增：`apps/desktop/src/renderer/design/views/canvas/workspace/CanvasWorkspaceShell.tsx`
- 新增：`apps/desktop/src/renderer/design/views/canvas/workspace/CanvasOverlayHost.tsx`
- 新增：`apps/desktop/src/renderer/design/views/canvas/nodes/CanvasNodeFrame.tsx`
- 新增：`apps/desktop/src/renderer/design/views/canvas/nodes/MediaNode.tsx`
- 新增：`apps/desktop/src/renderer/design/views/canvas/nodes/OperationNode.tsx`
- 修改：`CanvasWorkspaceView.tsx`，仅接入新 Shell/开关并迁出展示职责。
- 修改：`CanvasStage.tsx`，仅接入新节点 renderer、LOD 与层级 token。
- 修改：Electron E2E 配置和画布用例，加入 production build 与截图断言。
- 新增：样式治理脚本/Stylelint 配置和 CSS 指标报告。

进入代码修改前，仍需对这些核心组件做影响范围核对。若 GitNexus 可用，按项目规范运行 impact；不可用时使用直接调用点、相关测试、`git diff` 和构建结果完成降级核对。

## 13. 最终交付物

- 可灰度的新无限画布 UI。
- 画布设计 token、组件状态规范和 z-index 协议。
- 节点家族、Agent 卡片和 Overlay 使用说明。
- CSS owner 清单、Stylelint/治理门禁和指标报告。
- 真实 production build 的视觉回归基线。
- 300 节点性能基准报告。
- 更新后的官网截图和新手引导。
- 删除旧 V4/legacy 规则后的迁移记录。
