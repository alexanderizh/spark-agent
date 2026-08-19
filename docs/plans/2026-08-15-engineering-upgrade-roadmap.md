# Spark Agent 工程化还债与演进升级方案

> 状态: 实施中（Phase 0 已收官；Phase 1 W1/W2 已落地、W3 S1-S6 部分落地；Phase 2 P2.1 已落地，P2.2-P2.5 待启动） | 最后核对: 2026-08-20

## 1. 背景与定位

本方案源于对 DeepSeek Harness（dsh）的架构调研（详见 `docs/integrations/deepseek-harness-third-engine-analysis.md`）。已决策：**不引入 dsh 作为第三引擎**，但以它为镜，系统性清偿其照出的自有工程欠账，把项目推向「高可扩展、高规范化、高演进度」。

方案只解决**结构性问题**（加引擎贵、规范无强制、日志无投影、定义重复、巨石文件），不与具体业务功能绑定。所有数据来自 2026-08-15 的三路并行审计（质量基建 / 代码结构 / 数据协议层）+ 全仓量化统计。

## 2. 现状审计总览

全仓 3,155 个 TS/TSX 源文件、583,949 行（排除 node_modules/dist/worktree 副本）。

### 2.1 健康面（不推倒重来的依据）

| 维度         | 现状                                                                                                                 | 评级 |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ---- |
| 包依赖结构   | protocol ← shared ← storage ← agent-runtime，严格 DAG，无循环、无反向依赖                                            | 🟢   |
| TS 严格度    | tsconfig.base.json 满配 strict（noUncheckedIndexedAccess / exactOptionalPropertyTypes / useUnknownInCatchVariables） | 🟢   |
| 测试体量     | 约 844 个测试文件；核心服务（session.service 等）有专项测试；skip 极少（2 处 todo + 3 处条件跳过）                   | 🟢   |
| 数据库迁移   | 82 个 SQL 迁移，版本表 + 独立事务 + 防撞号，机制成熟                                                                 | 🟢   |
| 事件存储     | agent_events append-only + 生成列投影（seq/event_mode）+ FTS5 全文检索                                               | 🟢   |
| 文档纪律     | 215 篇文档 85.6% 带状态行；失败有诚实台账（docs/reviews 带日期记录既存失败）                                         | 🟢   |
| 提交规范     | Conventional Commits 达 95%（200 条中 190 条符合，纯靠自律）                                                         | 🟡   |
| IPC 类型安全 | typedIpcHandle 封装（类型约束 + zod + IpcResult 信封 + 性能追踪）                                                    | 🟡   |

**结论：底子不差，坏在强制层与结构层。不需要大重构，需要止血 + 还债。**

### 2.2 问题清单（按严重度）

#### 🔴 P0-1 规范无强制力（最大系统性问题）

- CI 仅有 2 条**发布**流水线（publish-desktop-release / publish-website），**PR/push 无任何 typecheck / lint / test 门禁**
- 无 git 钩子：husky / lint-staged / commitlint 全缺，提交前零自动检查
- 3000 行单文件规则写在 CLAUDE.md，实际违规 **17 个文件**（13 生产 + 4 测试），另有 20 个文件在 2000~3000 行区间
- 红基线长期存在且被文档记录但无人修：desktop typecheck 红（`teamRuntimeBackend.ts` 2 处 TS2379 exactOptionalPropertyTypes）、protocol lint 红（3 errors + 42 warnings）
- 根 `test` 脚本空转（`pnpm -r run test`，无子包实现裸 `test`）；`@vitest/coverage-v8` 声明了未安装；缺 `.prettierignore` / `.editorconfig`

#### 🔴 P0-2 巨石文件（全栈性分布）

| #     | 行数                  | 文件                                                                             | 层              |
| ----- | --------------------- | -------------------------------------------------------------------------------- | --------------- |
| 1     | 11,685                | packages/agent-runtime/src/services/session.service.ts                           | 主进程服务      |
| 2     | 9,395                 | apps/desktop/src/main/ipc/index.ts                                               | 主进程装配/注册 |
| 3     | 9,076                 | apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx            | 渲染端          |
| 4     | 8,219                 | apps/desktop/src/renderer/design/views/ChatView.tsx                              | 渲染端          |
| 5     | 7,390                 | apps/desktop/src/renderer/design/views/canvas/canvas.api.ts                      | 渲染端          |
| 6     | 6,818                 | packages/protocol/src/ipc/index.ts                                               | 协议契约        |
| 7     | 6,333                 | apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx                       | 渲染端          |
| 8     | 6,277                 | apps/desktop/src/renderer/design/views/SettingsView.tsx                          | 渲染端          |
| 9     | 5,078                 | apps/desktop/src/renderer/design/views/ProvidersView.tsx                         | 渲染端          |
| 10    | 4,893                 | packages/agent-runtime/src/**tests**/services/media/media-adapters.test.ts       | 测试            |
| 11    | 4,727                 | packages/agent-runtime/src/**tests**/services/session-runtime-config.test.ts     | 测试            |
| 12    | 4,557                 | apps/desktop/src/renderer/tests/renderer.test.ts                                 | 测试            |
| 13    | 4,135                 | apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts | 测试            |
| 14    | 3,865                 | packages/protocol/src/media-model-manifest.ts                                    | 协议/数据       |
| 15~17 | 3,311 / 3,306 / 3,056 | CanvasOperationPanel / CanvasFilmAssetCenter / CanvasStage                       | 渲染端          |

补充事实：

- 头部 7 个生产巨石合计约 6.3 万行，占全仓 10.8%；canvas 目录 602 文件 / 161,674 行，占全仓 27.7%
- session.service.ts 含约 45 个 `private async` 方法、`executeMemberTurn` 单方法约 800 行；**已拆出 34 个 `session-*.ts` 辅助文件仍持续膨胀**——证明「拆辅助文件」治标不治本，需要结构边界
- main/ipc/index.ts 混装 310 个 `typedIpcHandle` 注册 + 约 30 个 `getXxxService()` 惰性工厂 + 内联业务逻辑（canvas 文本任务、用户问答回收）
- 陈旧 worktree 副本共 4.6GB（`.worktrees/` 2.6GB + `.claude/worktrees/` 2.0GB），污染一切全局搜索

#### 🟠 P1-1 三笔架构债（dsh 照出）

1. **引擎分派无接口**：`adapterKind` 二值归并（session.service.ts:2728）把三元值压成二值；`'claude-sdk' || 'claude'` 手写判断散布 2729 / 3386 / 3463 等处；turn 分叉（L3463）两分支各约 660 / 470 行对称重复展开（媒体收集、presented_files、终态处理各一套）；`getAgentAdapterFromSession`（:10453）13 处调用点 + providerType 兜底推断——**加第三引擎 = 在 11,685 行文件里改十几处 + 复制 600 行分支**
2. **权限单轴**：`SparkPermissionMode` 8 值枚举在 `sdk/types.ts:640` 与 `protocol/ipc/index.ts:140` **手抄两份**；沙箱代码碎片化为四套互不相识的机制（pathGuard 词法防护 / html-sandbox / computer-use policy / codex sandboxMode）；`bypassPermissions` 即裸奔，无第二轴兜底
3. **事件无投影**：agent_events 已 append-only（好），但派生逻辑散落读取侧 5 处（getHistory 裁剪 / prompt 重建 / FTS 提取 / fork 白名单复制 / 胶囊折叠），无统一投影 API；resume 靠 `ResumeGateManager` 硬编码 allowlist（adapter 限 claude 系 + provider 限 anthropic + hostname 限 api.anthropic.com），其余引擎每轮 fresh

#### 🟠 P1-2 单一事实源破坏

- 权限枚举双份定义（漂移风险已存在）
- event-mapper 双拷贝：agent-runtime `sdk/event-mapper.ts` 2,133 行 + renderer `design/services/event-mapper.ts` 2,335 行，独立演化必然漂移
- protocol/ipc/index.ts 单文件承载 345 请求 channel + 48 流 channel，任何 channel 增删都碰这一处（三端联动的冲突热点）
- IPC schema 覆盖不全：`IpcSchemaRegistry` 仅登记约 200/345 个 channel，未登记的请求不做运行时校验直接透传

#### 🟡 P2 其他

- 154 处 `any` 使用（strict 配置在位，存量待清）
- plugin-sdk / website 测试薄弱（各 1 个测试文件）
- media-manifest 族约 9,000 行数据型内容以 .ts 硬编码在 contract 包
- storage 层类型安全中等：row→domain 映射靠手写 `as T` 断言；个别越层（session.service 直接拼 `db.raw` 查 agent_events）
- 约 7 篇文档「最后核对」停留在 7 月中旬

## 3. 根因诊断

症状都能归到五个根因之一：

1. **约定没有编译器/CI 兜底**——所有规则（3000 行、文档保鲜、发布门禁 checklist）都靠人读文档遵守。单人自律尚可维持（提交规范 95% 就是证明），**多 agent 并行开发时无强制 = 必然劣化**（17 个巨石就是证据）
2. **扩展点是运行时 if/else 分叉，不是类型/接口**——加能力 = 在巨石里加分支 + 复制对称代码
3. **装配与协议「一切经一处」**——ipc/index.ts（装配）与 protocol/ipc/index.ts（契约）都是单点巨石，是多 agent 并行的天然冲突热点
4. **日志只写不投影**——append-only 存了完整事实，但视图派生散落读取侧，resume 只能靠引擎 allowlist hack
5. **重复定义无收敛机制**——枚举手抄、mapper 拷贝，没有「单一事实源 + re-export」的纪律和检查手段

## 4. 目标与量化验收

| 目标     | 含义                 | 量化验收（建议值，待确认）                                        |
| -------- | -------------------- | ----------------------------------------------------------------- |
| 高可扩展 | 加引擎/加能力便宜    | 新引擎接入 = 实现 1 个接口 + 1 处注册，session.service 核心零修改 |
| 高规范化 | 规则被机器强制       | PR CI 门禁全绿才可合并；红基线归零；超限文件数只降不升            |
| 高演进度 | 可回放/可迁移/可重构 | 全引擎 resume；统一事件投影 API；文档保鲜自动巡检                 |

## 5. 分阶段实施方案

### Phase 0 — 止血与门禁（约 1 周，最高优先）

> **落地记录（2026-08-15）**：0.1~0.5 已完成（红基线实测 27 错全部清零：desktop typecheck 绿、protocol lint 0 errors；ratchet 基线 38 文件入册三分支逻辑实测通过；钩子装好并验证 commitlint 拦截/中文 conventional 通过；根 test 脚本修复）。0.6 已删除零风险 worktree 2 个（canvas-unified-image + stage3d-panorama-fix，回收约 5.7GB，分支保留），其余 3 个含未提交文件经用户确认暂留。@vitest/coverage-v8 审计修正：实测无包声明亦无引用，无需安装。CI 首跑验证待代码推送 GitHub 后进行（当日网络不通）。
>
> **CI 策略调整（2026-08-15，单人开发定位）**：代码经 SSH-443 推送后 CI 首跑完成，lint/typecheck 红基线再清 10 errors（desktop 7 + agent-runtime 3）后 7/8 job 绿；agent-runtime 单测在 ubuntu 暴露 19 个平台敏感失败（测试按 Windows/macOS 行为编写，如硬编码 `/bin/zsh` 探测结果），不构成真实回归信号。经用户确认按单人开发节奏调整：**CI 单测全量转咨询性（continue-on-error），阻塞项收敛为 typecheck + lint + file-size ratchet**；文档类改动 paths-ignore 不触发。本地钩子（commitlint/lint-staged/ratchet）保留——它们防的是用户自己的并行 agent。

原则：**先立栅栏再动手术**。没有门禁，在多 agent 并行下重构巨石等于高空作业无保护。

| WP                   | 内容                                                                                                                           | 验收                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 0.1 PR CI            | 新增 `.github/workflows/ci.yml`：按包并行 typecheck + lint + test:unit（workspace filter 矩阵）                                | master 的 PR 必须全绿才可合并           |
| 0.2 红基线清零       | 修 desktop typecheck 既存错误（teamRuntimeBackend TS2379 等 2 处 + chat 测试类型错）、protocol lint 3 errors                   | `pnpm typecheck` / `pnpm lint` 全绿     |
| 0.3 文件尺寸 ratchet | `scripts/check-file-size.mjs` + 基线 JSON：全仓 >2000 行文件入册；禁止新文件入册、禁止在册文件增长；随拆解逐步降阈值收紧       | 集成 CI，巨石数只降不升                 |
| 0.4 本地钩子         | lint-staged + simple-git-hooks（或 lefthook）+ commitlint（提交规范已达 95%，固化成本极低）                                    | 提交即检查 staged 文件与 commit message |
| 0.5 测试脚本修缮     | 根 `test` 脚本指向 test:unit；安装 @vitest/coverage-v8；补 `.prettierignore` / `.editorconfig`；website 补 typecheck/lint 脚本 | `pnpm test` 一键全跑且真实执行          |
| 0.6 环境清理         | 清理 4.6GB 陈旧 worktree 副本；配置搜索/索引排除（.gitignore、GitNexus 索引范围）                                              | 全局 grep 不再命中副本                  |

### Phase 1 — 引擎分派接口化 + session.service 拆分（2~3 周）

> 细化实施计划（行号级现状基线 + 接口设计 + 周计划 + 风险登记册）：`docs/plans/2026-08-15-phase1-engine-dispatch-refactoring.md`
>
> **落地记录（2026-08-16）**：W1 全部落地并验收收官。W0 贯穿基线测试先行（a4199cd8：fake-engine-executor + 3 断言 × 双引擎，真实 SQLite 落库）；D3 `EngineExecutor` 显式接口 + 能力接口 + conformance 5/5（4541fd91）；D4 `engine-kinds` 单点归一，12 处手写归并替换、`startsWith('codex-')` 嗅探改 8 字面量查表（df0c031b）；D5 引擎注册表上线，两 descriptor + 三创建点改经 registry，codex 载具三选一收编为引擎内部细节（4e2b3565）。**第三引擎接入目标达成：新增引擎 = 1 个 descriptor + 1 次 register，不碰 session.service**。每步均通过贯穿基线 6/6 行为锁验证；CI 8/8 全绿（含 desktop）。并行开发遗留的 `pendingTitleRefinements` 测试 fixture 缺字段 ×5 已修（5e027c45）。验收复验（2026-08-16）：全包 typecheck/lint 绿、行为锁 100/100、session-runtime-config 既存失败 10 不变、Electron ABI 三模块可加载。W2（TurnRegistry 所有权收编 + 管道统一）为最高风险区，待启动。

还架构债 #1（引擎无接口），是「高可扩展」的核心。须在 worktree 物理隔离 + 独占窗口下进行（协调见 §7）。

1. **EngineExecutor 显式接口**：从现有鸭子契约（`onEvent/offEvent/cancel/executeTurn`）提炼接口；四个现有执行器（ClaudeSDK / CodexCli / CodexSdk / CodexOpenAI）声明实现
2. **EngineRegistry 注册表**：engineId → executor 工厂；executor 声明能力位（如 `nativeResume`），能力查询取代硬编码 allowlist（Phase 3 兑现）
3. **resolveEngine(session) 单点归一**：吸收 `getAgentAdapterFromSession` 的 13 处调用点与 providerType 兜底推断；用穷尽 switch 收窄类型，删除散布的 `'claude-sdk' || 'claude'` 手写判断
4. **统一 turn 管道**：L3463 分叉两分支的公共骨架（准备上下文 → resolveEngine → executeTurn → 终态/媒体收集/presented_files 收口）提炼为单份，引擎差异下沉到 executor 配置组装
5. **session.service 按 seam 拆模块**：目标目录 `services/session/`（turn-lifecycle / engine-dispatch / team-dispatch / resume / checkpoint / memory-extraction / mcp-resolution / history），SessionService 保留为 façade——构造签名不变（db + 8 回调 + setter 注入的既有装配不破坏），仅委托
   - 每模块 ≤1,500 行；session.service.ts 最终 ≤2,000 行；既有 34 个 session-\*.ts 辅助文件就近归位
6. **回归保护**：每拆一步跑全量 agent-runtime + desktop main 测试；每次符号移动前跑 `gitnexus_impact`（CLAUDE.md 既有规则）

**验收**：session.service.ts ≤2,000 行；写一个 stub 第三引擎（echo-executor）验证「实现接口 + 注册一行」即可跑通 turn，session.service 零修改；全量测试绿。

### Phase 2 — 单一事实源 + 协议/装配层治理（约 2 周，部分可与 Phase 1 并行）

> 可并行性说明：本阶段 2.2/2.3 触及的文件与 session.service 不重叠，可在 Phase 1 独占窗口期间由另一 agent 在 worktree 中推进。

1. **枚举收敛**：权限枚举以 protocol 为唯一定义（含 zod schema），agent-runtime 改为 re-export；顺手全局排查其他双定义
2. **protocol/ipc 模块化**：6,818 行按域拆为 channel-map 文件（`IpcChannelMap` 本就是 20+ 子接口合并，拆文件零语义变更）；`IpcSchemaRegistry` 补齐至 345/345 channel 全覆盖，消灭无校验透传
3. **main/ipc/index.ts 减重**：30 个 `getXxxService()` 工厂迁至 services registry 模块；内联业务（canvas 文本任务、问答回收等）下沉 service 层；注册层只做注册。目标 ≤2,000 行
4. **event-mapper 单源化**：双拷贝合并为单一模块（约束：不依赖 main 进程专属模块，落位 protocol 或 agent-runtime 叶子模块），renderer 删除 2,335 行拷贝改为 import
5. **巨石测试拆分**：4 个 >3000 行测试文件按域拆分（media-adapters / session-runtime-config / renderer / canvasOperationInheritance）
6. **（可选，后置）** media-manifest 族约 9,000 行数据外置为数据文件（JSON + 类型守卫），contract 包瘦身

### Phase 3 — 演进能力：事件投影 + 权限双轴（2~3 周）

还架构债 #2 #3，兑现「高演进度」。

1. **AgentEventProjection 投影 API**：`deriveMessages` / `deriveModelContext` / `deriveTurnTimeline`；把现有 5 处读取侧派生收编为投影层之下的实现细节，视图与上下文重建只消费投影
2. **全引擎 resume**：投影重建上下文升级为默认路径（现 fresh 路径的 `buildConversationHistoryPromptFromEvents` 已有雏形）；原生 resume 降级为 executor 能力声明的可选优化；删除 `ResumeGateManager` 硬编码 allowlist（hostname/provider 白名单逻辑改为引擎能力注册），保留熔断回落机制
3. **PermissionProfile 双轴**：protocol 定义 `{ approvalPolicy, fsScope, processScope }` 组合档案；各 executor 翻译为引擎原生机制（claude permissionMode / codex sandboxMode + approvalPolicy）；定义 `ExecutionSandbox` 接口（默认 no-op 实现）；pathGuard / html-sandbox / computer-use policy 标注为 scope provider 收编入册；Windows ACL 实现为后续独立项目（接口已预留）
4. **model-visible-means-logged 断言**：dev 模式下校验进入模型上下文的每条内容均有对应已落库事件，杜绝静默上下文 divergence
5. **文档保鲜自动化**：CI 周期任务巡检 `docs/` 状态行缺失与「最后核对」超期（建议阈值 90 天），输出报告而非阻塞

### Phase 4 — 前端巨石拆解（持续轨道，随功能迭代）

对象：CanvasWorkspaceView 9,076 / ChatView 8,219 / canvas.api 7,390 / ComposerV2 6,333 / SettingsView 6,277。

- 策略：**触碰即拆**（ratchet 强制不增行）+ 每季度定向拆 1~2 个 top 巨石
- 手法：容器/逻辑分离（hooks + 子组件）；canvas.api 按域拆模块；复用既有 Context 而非新造状态层
- 保护：renderer 601 个测试 + noUncheckedIndexedAccess 在位；拆前先为关键路径补测试快照

## 6. 量化验收总表

| 指标                  | 现状（2026-08-15）          | Phase 0 后                     | 全部完成后（建议目标）         |
| --------------------- | --------------------------- | ------------------------------ | ------------------------------ |
| PR 质量门禁           | 无                          | typecheck+lint+test 全绿可合并 | + 文件尺寸 ratchet、文档巡检   |
| 超 3000 行文件        | 17                          | 冻结（只降不升）               | 0（测试文件随 Phase 2.5 清零） |
| session.service.ts    | 11,685 行                   | 冻结                           | ≤2,000（façade）               |
| main/ipc/index.ts     | 9,395 行                    | 冻结                           | ≤2,000                         |
| protocol/ipc/index.ts | 6,818 行                    | 冻结                           | 按域模块化，单文件 ≤800        |
| 新增引擎改动面        | ~13 调用点 + 600 行分支复制 | —                              | 1 接口 + 1 注册                |
| 权限枚举定义处        | 2                           | 2                              | 1                              |
| event-mapper 拷贝数   | 2                           | 2                              | 1                              |
| IPC schema 覆盖       | ~200/345                    | —                              | 345/345                        |
| `any` 使用            | 154 处                      | 冻结（ratchet）                | <80（随拆解自然下降）          |
| typecheck 基线        | desktop 红                  | 全绿                           | 全绿                           |
| resume                | 单引擎 allowlist            | —                              | 全引擎投影重建                 |
| 陈旧 worktree         | 4.6GB                       | 清理 + 防再积                  | —                              |

## 7. 多 Agent 并行开发协调

1. **Phase 0 先行是并行开发的前置保护**：门禁上线后，任何 agent 的违规提交被 CI 自动挡住，规范不再依赖自觉
2. **共享文件手术独占窗口**：Phase 1 的 session.service 拆分、Phase 2 的 ipc/index 减重是全仓冲突热点——单 agent 独占 + worktree 物理隔离（既有惯例），其余 agent 在非重叠域推进（如 Phase 2 的 protocol/ipc 拆分与 Phase 1 文件不重叠，可并行）
3. **拆分即分权**：Phase 1/2 完成后，`services/session/` 与 ipc 注册变为按域模块目录，天然成为多 agent 的 ownership 边界，冲突面结构性缩小
4. **ratchet 防回潮**：巨石拆掉后阈值收紧，防止并行开发期再次膨胀（这是过去 34 个辅助文件没能阻止 session.service 长到 11,685 行的教训）
5. 每次符号移动前 `gitnexus_impact`、提交前 `gitnexus_detect_changes`（CLAUDE.md 既有规则，本方案执行期间照常适用）

## 8. 明确不做

- **不引入 DI 框架 / ORM / 更换测试框架**——手写惰性工厂迁到 registry 即可；包 DAG 已健康，monorepo 结构不动
- **不推倒重来**——strangler 式拆解，每步全量测试绿、可独立合并、可回退
- **不在本方案内引入 dsh 或任何第三引擎**——重评触发条件见集成分析文档；本方案的 EngineExecutor 接口保证届时接入成本最低化
- **不追求一次全量 zod 校验的性能敏感读路径**——schema 覆盖以完备为先，读路径校验按需登记

## 9. 执行原则

- 先方案后改（项目惯例）：每个 Phase 动工前出细化实施计划并确认
- 小步提交：拆分按可独立合并、可回退的小步进行，禁止长生命周期大分支
- 测试保护先行：动 session.service 前确认全量测试绿（依赖 Phase 0.2 先清红基线）
- 诚实交付：未验证项明确标注；失败记入 docs/reviews 台账（延续既有文化）

## 附录 A：审计数据明细（2026-08-15）

**包结构**（严格 DAG）：

| 包                   | 规模                                                                | workspace 依赖                    |
| -------------------- | ------------------------------------------------------------------- | --------------------------------- |
| @spark/agent-runtime | 367 文件 / 132,607 行（测试占 31%）                                 | protocol、shared、storage         |
| @spark/protocol      | 101 文件 / 35,347 行                                                | 无（基座）                        |
| @spark/storage       | 89 文件 / 22,774 行                                                 | protocol、shared                  |
| @spark/shared        | 20 文件 / 2,986 行                                                  | protocol                          |
| @spark/plugin-sdk    | 3 文件 / 370 行                                                     | protocol                          |
| apps/desktop         | main 336 文件 / 78,050 行；renderer 含 canvas 602 文件 / 161,674 行 | 四包（devDependencies + hoisted） |

**测试分布**：desktop 601（main 153 / renderer 446 / e2e 2）、agent-runtime 164、protocol 32、storage 31、shared 8、plugin-sdk 1、website 1、scripts 5。

**IPC 面**：345 请求 channel + 48 流 channel；约 470 个注册点分布在 29 个文件（ipc/index.ts 310 + 24 个 register\*.ts + 4 个服务层注册）；schema 登记 ~200/345。

**引擎执行器**（agent-runtime/src/sdk/）：claude-sdk-executor 1,887 / codex-cli-executor 1,451 / codex-sdk-executor 1,086 / codex-openai-executor 254 / event-mapper 2,133（renderer 另有 2,335 拷贝）。

**事件系统**：41 种事件类型手写 interface（无整事件级 zod schema）；唯一常规写入口 session-event-sequencer；瞬态 delta 只推流不落库；读取侧派生 5 处。

**权限链路**：executor canUseTool → PermissionService 规则层（3 内置 profile + 自定义规则 + 决策记忆）→ IPC onApproval → `stream:permission:approval-request` 推卡 → renderer resolve。

## 附录 B：dsh 借鉴项与本方案落点映射

| dsh 思想                                | 本方案落点                                             |
| --------------------------------------- | ------------------------------------------------------ |
| policy 与 sandbox 正交双轴              | Phase 3.3 PermissionProfile                            |
| 追加日志为唯一事实源 + 投影派生         | Phase 3.1 / 3.2 AgentEventProjection                   |
| 能力缝与注册式扩展（seam）              | Phase 1 EngineRegistry / 能力声明                      |
| "Model-visible means logged" 运行时断言 | Phase 3.4                                              |
| CI 门禁化                               | Phase 0                                                |
| Windows ACL 沙箱                        | 后续独立项目（ExecutionSandbox 接口在 Phase 3.3 预留） |
