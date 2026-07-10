# ChatView.tsx 安全拆解计划

> 状态: 实施中 | 最后核对: 2026-07-10

> 目标：按职责边界拆出可独立理解、测试和复用的模块，让 `ChatView` 保留清晰的页面编排职责。**不设置硬性行数目标**；文件大小只作为复杂度信号，不以牺牲功能完整性、引入巨型 props 或制造循环依赖来换取降行数。
> 沿用既有约定：`chat/` 下扁平 + PascalCase 前缀，命名导出，无 barrel index，相对路径，`type` 别量 + 内联 props。
> 安全底线：**只搬不改** —— 不动 props、不改 className、不改交互行为。每步 = 一次提取 + **影响分析 + tsc --noEmit + 定向测试 + 桌面 build** 验证；失败时用 `apply_patch` 精确修复或撤回本步骤，绝不通过 `git checkout` 覆盖脏工作区里的既有修改。

---

## 进度盘点（已完成部分）

| 文件 | 行数 | 内容 |
|---|---|---|
| `chat/ComposerV2.tsx` | 5,046 | ✅ 整个 composer + 11 辅助 + `useCloseOnOutside` |
| `chat/ChatInspectorPanel.tsx` | 1,599 | ✅ ChatConfigPanel/ChatInspector/PlanSummary + `buildUsageDataFromEvents` |
| `chat/ChatInspectorUtils.ts` | 393 | ✅ inspector 数据抽取 |
| `chat/QuestionAnswerCache.ts` | 83 | ✅ 问答答案内存/持久缓存与摘要转换 |
| `chat/ChatGitUtils.ts` | 313 | ✅ Git 纯函数、树/diff 数据契约、标签和尺寸常量 |
| `chat/ChatGitDialogs.tsx` | 334 | ✅ commit/branch/create 对话框 |
| `chat/ChatGitEnv.tsx` | 295 | ✅ Git 入口、环境、目标和任务进度 |
| `chat/ChatGitReview.tsx` | 606 | ✅ review、文件树、diff、stash 和调宽状态 |
| `chat/ChatFileIcon.tsx` | 13 | ✅ review 与消息附件共享的文件图标原语 |
| `chat/ChatHero.tsx` | 435 | ✅ 单 Agent/团队空态、提示轮播与 Agent 展示查找 |
| `chat/ChatTabbar.tsx` | 249 | ✅ 会话顶部栏与清空确认、环境/面板入口联动 |
| `chat/ChatMarkdown.tsx` | 346 | ✅ Markdown React 渲染、mention/路径/URL 高亮 |
| `chat/ChatMarkdownUtils.ts` | 136 | ✅ Markdown 纯解析与 block 数据契约 |
| `chat/ChatDocumentOutput.tsx` | 186 | ✅ Markdown 与 block 渲染共享的文档产物卡片 |
| 其余 chat/ 文件 | — | ✅ types/diff/team-activity/toolbar/titlebar/sidepanels/dock 等 |

**ChatView.tsx 当前 7,134 行**（仅作复杂度观察），集中在以下未拆 cluster：

| Cluster | 大致行数 | 状态 |
|---|---|---|
| Git UI（组件 + 纯函数 + 常量/类型） | — | ✅ 已完成 |
| ChatStream（虚拟化消息列表，文件内独享，无外部引用） | ~1,170 | 未拆 |
| 消息行组件（UserMsg/AgentMsg/菜单/附件） | ~1,030 | 未拆 |
| Inline 卡片（8 个 Card） | ~830 | 未拆 |
| Block 渲染（renderBlocks 巨函数 + 团队块） | ~660 | 未拆 |
| Tool-log/thinking | ~570 | 未拆 |
| Markdown（含导出的 MarkdownText） | — | ✅ 已完成 |
| Hero + Tabbar | — | ✅ 已完成 |
| Plan | ~210 | 未拆 |
| **共享问答缓存**（跨组件可变状态） | — | ✅ 已完成 |

> 行号说明：下文括号中的行号来自拆解前快照，Phase 0/1 完成后已整体偏移，仅用于辨认原始范围。后续执行必须按符号名 + GitNexus context/impact 定位，不能依赖旧行号机械截取。

---

## 关键约束（决定执行顺序）

1. **`MarkdownText` 对外导出** —— 有 4 个外部 importer：
   - `components/FilePreviewPanel.tsx:22`
   - `components/ChatPanel.tsx:26`
   - `ChatInteractions.tsx:19`
   - `views/SkillStoreView.tsx:38`

   全部从 `'../views/ChatView'` 导入。**拆分后 ChatView 必须保留 re-export**：
   ```ts
   export { MarkdownText } from './chat/ChatMarkdown'
   ```
   这样 4 个外部 importer 零改动。

2. **`questionAnswerCache` 跨组件可变状态**（ChatView 行 340–407）—— ChatView 的 `handleAnswerQuestion` 写入、`InlineQuestionCard` 读取。两者一旦分家就断链。**必须 Phase 0 先抽到独立模块**，再搬卡片。

3. **`renderBlocks` 引用链是文件内闭环** —— 被 `ChatStream`(5576)、`TeamMemberActivity`(6615)、`AgentMsg`(8677/9129/9140) 调用，无外部引用。因此 **Block 渲染 + 消息行 + ChatStream 要作为一组**顺序搬迁，搬完后它们之间的 import 互指新文件，与 ChatView 解耦。

4. **`ChatStream` 无外部引用** —— 可整体抽出，不涉及对外 API。

---

## 执行阶段

### Phase 0 — 前置基石

**Step 0.1　新建 `chat/QuestionAnswerCache.ts`**
- 搬：`questionAnswerCache` Map(340–343) + `QUESTION_ANSWER_STORAGE_PREFIX`(344) + `getQuestionAnswerCacheKey`(346–348) + `buildQuestionAnswerSummaries`(352–375) + `persistQuestionAnswerSummaries`(377–387) + `readPersistedQuestionAnswerSummaries`(389–407) + `QuestionAnswerSummary` type(350)。
- ChatView 改为 import。
- **验证关键**：提问 → 提交 → agent 重发同问，确认 `InlineQuestionCard` 仍命中缓存回显。
- **风险**：低（纯搬迁共享状态）。
- **状态**：✅ 已完成。

---

### Phase 1 — Git UI 整簇（最大独立块，最先拿下）

Git cluster 完全自包含（~1,500 行），内部耦合但对外只通过组件 props，最适合先整组拆出。

**Step 1.1　新建 `chat/ChatGitUtils.ts`（纯函数 + 类型 + 常量）**
- 搬纯函数：`formatSignedNumber`(3020)、`getGitSourceLabel`(3024)、`buildDefaultCommitMessage`(3029)、`buildAgentCommitMessage`(3043)、`splitGitFilePath`(3708)、`getGitChangeStageLabel`(3724)、`createGitReviewTreeNode`(3746)、`addGitChangeToTreeNodeStats`(3760)、`sortGitReviewTreeNodes`(3772)、`buildGitReviewTree`(3783)、`buildDefaultExpandedTreeDirs`(3807)、`matchesGitReviewStageFilter`(3819)、`getGitTreeStageClass`(3828)、`formatGitStashDate`(3835)、`parseGitDiffViewSegments`(3858)、`goalStatusLabel`(3300)、`goalPhaseLabel`(3319)。
- 搬类型：`GitReviewStageFilter`(3731)、`GitReviewTreeNode`(3733)、`GitDiffViewLine`(3847)、`GitDiffViewSegment`(3854)。
- 搬常量：`GIT_REVIEW_TREE_*`(4256–4260)。
- **风险**：极低（纯函数无状态）。
- **状态**：✅ 已完成；新增 4 个定向测试保护 tree/diff/过滤/提交提示词契约。

**Step 1.2　新建 `chat/ChatGitDialogs.tsx`（commit/branch/create 对话框）**
- 搬：`GitDialogShell`(3381)、`GitCommitDialog`(3412)、`GitBranchDialog`(3551)、`GitCreateBranchDialog`(3637)、`GitFileTypeBadge`(3715)。
- 从 `./ChatGitUtils` 引入所需辅助函数。
- **修正**：`GitFileTypeBadge` 只服务 review，不属于 dialogs，已随 Step 1.4 迁移。
- **状态**：✅ 已完成。

**Step 1.3　新建 `chat/ChatGitEnv.tsx`（trigger/env/goal/task）**
- 搬：`GitSessionTrigger`(3065)、`GitEnvPanel`(3123)、`GitGoalSection`(3218)、`GitTaskProgressList`(3330)、`GitTaskProgressItem`(3354)。
- **状态**：✅ 已完成。

**Step 1.4　新建 `chat/ChatGitReview.tsx`（review 面板 + 文件树）**
- 搬：`GitReviewDiffLine`(3942)、`GitReviewFileDiff`(3966)、`GitReviewTreePanel`(4063)、`GitReviewTreeNodeRow`(4184)、`GitReviewPanel`(4262)。
- 从 `./ChatGitUtils` 引入树辅助函数 + 常量。
- **修正**：review 与用户附件共同依赖 `FileChipIcon`；已先抽为 `chat/ChatFileIcon.tsx`，避免 review 反向依赖 `ChatView` 或后续消息组件。
- **状态**：✅ 已完成。

**完成结果**：Git 展示组件、内部状态和纯函数均已离开 `ChatView`，父级只保留 Git 状态编排、IPC action 与组件 props 连接。

---

### Phase 2 — Hero + Tabbar（小而独立，快速收益）

**Step 2.1　新建 `chat/ChatHero.tsx`**
- 搬：`SINGLE_AGENT_HERO_ACTIONS`(2389)、`SINGLE_AGENT_HERO_VISIBLE_COUNT/ROTATE_MS`(2432/2434)、`HERO_TIP_LABEL`(2471)、`HERO_TIPS`(2466)、`HeroGreetingCopy`/`HeroTipKind`/`HeroTip` 类型、`getHeroGreeting`(2437)、`resolveAgentDisplay`(2370)、`HeroTipsTicker`(2530)、`SingleAgentEmptyHero`(2561)、`AgentAvatarBadge`(2688)、`TeamModeEmptyHero`(2714)。
- **状态**：✅ 已完成；`resolveAgentDisplay` 同时供 Tabbar 使用，不再反向依赖 ChatView。

**Step 2.2　新建 `chat/ChatTabbar.tsx`**
- 搬：`ChatTabbar`(2798)（与已有 `ChatToolbar.tsx` 配对，前者是会话顶部栏，后者是图标/下拉原语）。
- **状态**：✅ 已完成。

**完成后**：ChatView 减 ~490 行。

---

### Phase 3 — Markdown（含对外导出，需特殊处理）

**Step 3.1　新建 `chat/ChatMarkdownUtils.ts`（纯解析函数）**
- 搬：`parseMarkdown`(7637)、`splitTableRow`(7754)、`highlightMentions`(7768)、`highlightFilePaths`(7826)、`highlightUrls`(7856)、`renderInlineMarkdown`(7869)、`MarkdownBlock` 类型(7320)。
- **修正**：只有 `parseMarkdown`、`splitTableRow` 和 `MarkdownBlock` 是纯数据逻辑，已放入 `.ts`；highlight/renderInline 返回 ReactNode，保留在 `ChatMarkdown.tsx`，避免把 JSX 伪装成工具函数。
- **状态**：✅ 已完成；新增 2 个解析契约测试。

**Step 3.2　新建 `chat/ChatMarkdown.tsx`（组件，含导出）**
- 搬：`MarkdownText`(7505，**保持 export**)、`StreamingCursor`(7632)。
- **ChatView 顶部加 re-export**：`export { MarkdownText } from './chat/ChatMarkdown'`，4 个外部 importer 的路径无需改动。
- **验证关键**：tsc 确认 FilePreviewPanel/ChatPanel/ChatInteractions/SkillStoreView 不报错；dev build 目视 markdown 渲染（代码块/表格/@mention/文件路径/URL）正常。
- **修正**：`MarkdownText` 与 `renderBlocks` 共同依赖文档产物卡片，已先抽到 `ChatDocumentOutput.tsx`，防止 `ChatMarkdown ↔ ChatView` 循环依赖。
- **状态**：✅ 已完成；ChatView 保留同名 re-export，外部 importer 无需改路径。

**完成后**：ChatView 减 ~450 行。

---

## Phase 3 审查检查点（2026-07-10）

按约定在 Phase 3 后暂停继续拆分，先审查 Phase 0–3：

1. **功能连接**：ChatView 对问答缓存、Git dialogs/env/review、Hero、Tabbar、Markdown 的 props/action 接线仍通过类型检查；Git 状态刷新和 IPC action 仍留在 ChatView，未迁移或重写。
2. **Markdown 高风险兼容**：`MarkdownText` 的 13 个直接调用点均由 GitNexus 解析到 `ChatMarkdown.tsx`；ChatView 保留 re-export，4 个既有外部 importer 不改路径。
3. **循环依赖**：本轮新增 chat 模块没有形成新循环；`ChatInteractions.tsx ↔ ChatView.tsx` 是兼容 re-export 保留的既有循环，后续若消除应单独评估并修改 importer，不与展示拆分混做。
4. **并行开发隔离**：会话 Git 检测修复位于 `src/main/ipc/index.ts`、`git-status-utils.ts` 及其测试，本轮未编辑这些文件；对应 3 个测试通过。
5. **验证结果**：desktop typecheck 通过；问答/Git/Markdown/FilePreview 定向测试 10 个通过；desktop 生产 build 通过；`git diff --check` 通过。
6. **Lint 基线**：全 desktop lint 当前存在 914 个既有问题（191 errors / 723 warnings），不作为本轮新增回归；迁移到 `ChatGitReview.tsx` 的两处 `set-state-in-effect` 错误来自原组件实现，本轮遵循“只搬不改”未顺手重写。
7. **GitNexus 范围**：全脏工作区 detect-changes 为 critical，包含 ChatView、Git 检测、canvas 和规则文档等并行改动，不能归因于单一拆分；提交前需在并行工作收敛后再次运行并按文件归属复核。

**当前结论**：未发现必须回滚的拆分缺陷；暂停 Phase 4 及之后的迁移，等待本检查点确认或并行 Git 修复合并后再继续。

---

### Phase 4 — Block 渲染 + Inline 卡片（renderBlocks 巨函数链）

这是引用链闭环的第一环，搬完后才能拆 ChatStream / 消息行。

**Step 4.1　新建 `chat/ChatBlockCards.tsx`（8 个 inline Card 组件）**
- 搬：`ValidationSuggestionCard`(6634)、`InlinePermissionCard`(6742)、`InlineQuestionCard`(6853，**从 `./QuestionAnswerCache` import**)、`ContextLedgerCard`(6959)、`ContextSummarizedCard`(7071)、`ContextCompactionCard`(7100)、`RetryTrailCard`(7166)、`DocumentOutputCard`(7408)。
- 搬配套辅助：document-output 常量(7330–7367) + `getFileNameFromReference`/`getReferenceExtension`/`isDocumentOutputReference`/`getDocumentOutputKey`/`parseDocumentOutputLine`/`renderDocumentOutputParagraph`(7369–7503)。

**Step 4.2　新建 `chat/ChatBlockRender.tsx`（renderBlocks 巨函数 + 团队块视图）**
- 搬：`renderBlocks`(5840)、`renderBlocksGrouped`(6135)、`reorderTurnSummaryBlocks`(6187)、`getToolLogGroupKind`(6200)、`normalizeToolName`(6240)、`ToolLogGroupKind` 类型(6133)。
- 搬团队块视图：`TeamDispatchBlockView`(6248)、`WorkflowProgressBlockView`(6264)、`WorkflowProgressItem`(6290)、`TeamMemberMessageBlockView`(6315)、`TeamPeerMessageBlockView`(6399)、`TeamRoundDividerBlockView`(6456)、`TeamDiscussionStatusBlockView`(6470)、`TeamMemberActivityBlockView`(6489)、`renderTeamMemberActivityBlocks`(6589)、`isTeamMemberLogBlock`(6621)、`isTeamMemberActivityRunning`(6625)。
- **注意**：`renderBlocks` 内部会引用 Phase 4.1 的 Card 组件、Phase 3 的 MarkdownText、以及 Phase 5 的 ToolLog 组件 —— 先把这些引用改成 import，等 Phase 5 搬完后再统一收口。建议 **Phase 4 与 Phase 5 连续执行**，中间不提交，减少半成品状态。

**完成后**：ChatView 减 ~1,490 行。

---

### Phase 5 — Tool-log / Thinking 组件 + Plan 组件

**Step 5.1　新建 `chat/ChatToolLogs.tsx`**
- 搬：`ThinkingSection`(9189)、`ToolLogsMasterToggle`(9284)、`CollapsibleContent`(9300)、`ToolCall`(9351)、`ToolLogGroup`(9439)、`ToolLogEntry`(9517)、`ToolLogEntryHead`(9589)、`ToolLogSection`(9607)、`TerminalBlock`(9681)、`StreamingErrorCard`(9685)、`TodoListInline`(9719)、`StoppedMarker`(9751)。
- 搬辅助：`isCommandLikeTool`(9584)、`formatToolLogInput`(9653)、`getToolLogIcon`(9664)、`quoteSlashCommandArg`(6729)、`executeCheckpointRestore`(6735)、`reapplyTurnFiles`(7286)、`reconstructHunkDiff`(7309)、`formatDuration`(9975)。

**Step 5.2　新建 `chat/ChatPlanPanels.tsx`**
- 搬：`PlanSidePanel`(9764)、`PlanApprovalPanel`(9827)。

**完成后**：Phase 4+5 一起验证（renderBlocks 链已闭合），ChatView 减 ~780 行。

---

### Phase 6 — 消息行组件（UserMsg / AgentMsg / 菜单 / 附件）

**Step 6.1　新建 `chat/ChatMessageMenus.tsx`**
- 搬：`MessageHoverBar`(7976)、`InlineContextMenu`(8024)、`SelectionQuoteContextMenu`(8024)。
- 搬辅助：`formatMsgTime`(7958)、`editTextSelection`(8073)、`insertTextIntoControl`(8138)、`extractTextFromBlocks`(8148)。

**Step 6.2　新建 `chat/ChatMessageRows.tsx`（核心消息行）**
- 搬：`UserMsg`(8156，React.memo)、`FileChipIcon`(8412)、`UserMessageAttachments`(8419)、`UserMessageImageAttachment`(8468)、`useUserAvatarSrc`(8343，文件内唯一 hook)、`AssistantMessageRows`(8620，memo)、`AgentMsg`(8886，memo)、`resolveAssistantIdentity`(8390)、`splitAssistantMessageBlocks`(8775)、`assistantRowsPropsAreEqual`(8600)、`teamMemberContextKey`(8853)、`isHiddenTimelineBlock`(8857)、`getBlockTeamMemberContext`(8865)、`isHostActivityRunning`(8875)、`AssistantRowCompareProps`/`AssistantMessageSegment` 类型。
- 从 `./ChatBlockRender`、`./ChatToolLogs`、`./ChatMessageMenus` import 子依赖。

**完成后**：ChatView 减 ~1,030 行。此时 ChatView 不再直接定义任何消息/块组件。

---

### Phase 7 — ChatStream（第二大组件，最后搬）

**Step 7.1　新建 `chat/ChatSessionHistory.ts`（纯函数 + 类型）**
- 搬：`SESSION_HISTORY_TURN_PAGE/EVENT_PAGE`(5702/5703)、`loadSessionHistoryPage`(5709)、`mergeSessionEvents`(5723)、`yieldToBrowser`(5731)、`compareAgentEvents`(5747)、`getLatestContextUsageEvent`(5754)、`getLatestContextLedgerEvent`(5764)、`toContextLedgerState`(5774)、`getLatestProjectContextEvent`(5786)、`applyAgentStatus`(5794)、`joinPath`(5832)、`GetSessionHistory` 类型(5688)。

**Step 7.2　新建 `chat/ChatStream.tsx`**
- 搬整个 `ChatStream`(4518–5686，~1,170 行)，从 `./ChatSessionHistory`、`./ChatMessageRows`、`./ChatBlockRender` import 依赖。

**完成后**：ChatView 减 ~1,170 行。

---

### Phase 8 — ChatView 收尾

至此 ChatView 预计剩余：
- 主组件 `ChatView`(415–2368) 的状态/回调/effect/JSX 编排
- `resolveTeamHostAgentId`(291)
- 模块级常量（SETTINGS_GENERAL_KEY、SAFE_FILE_SCHEME 等 magic string）
- MarkdownText re-export（Phase 3.2 留下的转发）

**收尾动作**：
1. grep 全文确认无残留未用 import / 死代码。
2. grep `questionAnswerCache`、`MarkdownText`、`renderBlocks`、`ChatStream` 确认引用链完整。
3. **终极验证**：tsc --noEmit（全绿）+ dev build + 人工走查：空 hero、聊天收发、git 面板（commit/branch/review）、composer 发送、侧面板切换、侧聊、检查器、上下文表、markdown 渲染、提问回答缓存。
4. 记录 ChatView 行数变化用于观察，不作为完成标准；只要剩余内容属于页面编排且边界清楚，就可以停止继续拆分。

---

### Phase 9 — 编排状态域 / 副作用收口（按复杂度决定是否执行）

展示层全部拆出并稳定后，再按状态所有权拆 hooks；这一阶段不与 Phase 1–8 混做：

1. `chat/useChatTeamConfig.ts`：团队配置加载、持久化、运行成员派生。
2. `chat/useChatPanels.ts`：Inspector、统一侧栏、终端、侧聊、文件预览的会话级快照与联动。
3. `chat/useChatGitState.ts`：分支、状态刷新、提交/推送、review 面板自动展开。
4. `chat/useChatQuestionFlow.ts`：问答提交、取消、持久缓存和 App 关闭回调。
5. `chat/useChatComposerBridge.ts`：Composer 新建会话、发送、重发、引用回复和 runtime patch 桥接。

每个 hook 只返回一个明确状态域的 state/actions，不创建单个“万能 controller”。只有当抽取后能降低认知负担且不扩大联动风险时才执行；否则保留在 ChatView。

---

## 安全规约（全程适用）

1. **一步一验证**：每步 GitNexus impact/context + tsc --noEmit + 定向测试 + build；失败时精确修复或仅撤回本步骤新增内容，不覆盖用户已有改动。
2. **props 零改动**：抽组件时 props 形状/命名/顺序一律不动，内部状态跟着组件走，JSX 原样搬。
3. **共享可变状态先落地**（Phase 0.1）再动依赖它的卡片。
4. **对外导出保持**：MarkdownText 通过 ChatView re-export 转发，4 个外部 importer 零改动。
5. **引用链闭环成组搬迁**：renderBlocks 链（Phase 4+5）连续执行，中间不提交。
6. **测试随风险补齐**：纯函数拆分优先补轻量单测；跨状态/effect 的组件拆分复用现有 renderer/event-mapper 测试，必要时增加针对回归用例。测试不追求覆盖 JSX 细节，但必须保护问答、消息重建、Git tree/diff 等数据契约。
7. **小步提交**：每个 Phase 内 1–2 个 commit，便于二分回滚。

---

## 不做的事（明确边界）

- 不重构内部逻辑、不改 className、不动交互行为 —— **只搬不改**。
- 不碰已稳定的 13 个 chat/ 文件的 import 路径。
- 不建子目录（沿用扁平 + 前缀）。
- 不做与拆分无关的视觉或业务重构；允许增加保护拆分契约的定向测试。

---

## 建议提交节奏

1. `refactor(chat): extract question-answer cache` (Phase 0)
2. `refactor(chat): extract git UI cluster` (Phase 1，4 步合并或分 2 commit)
3. `refactor(chat): extract hero and tabbar` (Phase 2)
4. `refactor(chat): extract markdown renderer` (Phase 3)
5. `refactor(chat): extract block renderers and tool logs` (Phase 4+5 合并)
6. `refactor(chat): extract message rows and menus` (Phase 6)
7. `refactor(chat): extract ChatStream` (Phase 7)
8. `refactor(chat): slim ChatView presentation shell` (Phase 8)
9. `refactor(chat): extract ChatView state domains` (Phase 9，按 hook 分批提交)

最终以职责边界、功能完整性和验证结果为准，不以行数或新增文件数量为验收条件。全程保证每步可独立验证和撤回。
