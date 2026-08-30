# spark-engine TUI 终端界面设计

> 状态: 已落地 | 最后核对: 2026-08-26
>
> 上游文档：`todo/自研Agent引擎完整架构设计.md`（下称「主设计」）。本文是主设计 §10.2 的实现级定稿。两条已定案前提：CLI 命令名为 **`spark`**；**TUI 随 M1（第一轮）开发**——虽然第一阶段目标是联通进 SparkWork 平台使用，但 TUI 与内核骨架同步交付，FakeModel 后端即可完整交互。本文已由用户审阅通过，现进入 M1 施工。

---

## 0. 定位与三条设计公理

1. **TUI 是事件日志的又一个投影。** 主设计不变量 1（事件日志是唯一事实源）的直接推论：TUI 与 SparkWork 宿主 GUI、模型上下文、resume 重建消费**同一份 append-only 事件流**。TUI 内不存在「只存在于 UI 的状态」——渲染器是无状态纯函数：`(事件序列, 终端能力) → 帧`。
2. **TUI 是进程内 SDK 宿主。** `spark` REPL 通过 `import { Agent }`（`@spark/agent` SDK）同进程驱动内核，零 IPC；M3 的 SparkWork 会话宿主计划通过 `spark serve` JSON-RPC 接入。届时两个宿主消费同一 schema 的事件流与同一套交互语义（排队不打断、ESC 中断、权限审批）——这是主设计 §17.2 招牌 6「多宿主同构」的直接兑现：**换宿主不换体验**。当前 M2 的 Desktop Host Bridge 只复用模型渠道，不承担会话宿主协议。
3. **终端原生哲学。** 不自绘全屏视窗、不劫持 scrollback（M1 依赖终端原生回滚）；尊重 `NO_COLOR`；按终端能力降级（truecolor → 256 → 16 → mono，Unicode → ASCII）；stdout 非 TTY 时自动退化为纯文本流。终端工具的生命力在于与 Unix 管道生态共存。

---

## 1. 技术选型（ADR）

| 决策          | 选择                                                           | 理由与代价                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 渲染框架      | **Ink 7 + React 19**                                           | Claude Code / Gemini CLI 同路线，成熟度已被顶级产品验证；团队 React 心智零成本（这是选 TS 路线的同一决策延伸）；Yoga flexbox 处理布局与 resize。代价：TUI 入口携带 react，见下条隔离措施 |
| 渲染入口隔离  | tsup 多入口 + 模块边界                                         | `ink`/`react` 仅允许被 `src/tui/**` import（ESLint 边界规则，违者构建失败）；`spark serve` 与 SDK 入口不携带任何 react 代码                                                              |
| Markdown 渲染 | M1 纯文本 + 缩进代码块；M2 `marked-terminal` + `cli-highlight` | 流式 markdown 增量重渲是性能深水区（只重渲活动块），放 M2 与真实模型一起打磨                                                                                                             |
| 输入          | Node readline `keypress` + 自研编辑器组件                      | 需要 IME 组合守卫、多行编辑、焦点抢占语义，enquirer/clack 类提示库覆盖不了持久 REPL                                                                                                      |
| 测试          | `ink-testing-library` + FakeModel                              | 渲染快照可确定性回归（§12），UI 测试零 token                                                                                                                                             |

---

## 2. 运行形态与降级

```
spark                      # 交互 REPL（默认形态，本文主体）
spark "任务" / -p "..."     # 一次性执行（非交互）
spark --json               # 一次性执行 + stdout 输出 NDJSON 事件流
spark doctor / spark models / spark install / spark uninstall / spark init
spark serve / resume / config / stats / plugin / eval  # M3+ 路线图，当前会明确拒绝未实现命令
```

- **TTY 探测**：`stdout` 非 TTY、`--plain`、`CI=true`、`TERM=dumb` 任一命中 → 纯文本模式：无 spinner、无重绘、无色彩（`FORCE_COLOR` 可强制开色）。
- **`--json` 模式**：输出与 App Server `notification:event` **同一 schema** 的 NDJSON 事件流——脚本/测试/宿主复用同一消费端，再次落实多宿主同构。
- **退出码**：`0` 成功 / `1` turn 失败 / `2` 配置或用法错误 / `130` 用户中断（ESC / Ctrl+C）。
- **首次运行**：未配置模型时 REPL 顶部显示一次性引导行（`spark models` 查看 / `spark doctor` 自检），不阻塞输入。

---

## 3. 布局与组件树（五区）

```
┌ 1 header ──────── 1 行 · dim · 会话/模型/cwd/短 session id
│ 2 transcript ──── 已落定事件（Static 区，只渲染一次）+ 活动尾（Live 区）
│ 3 status ──────── 1 行 · spinner + 当前动作 + token/cost + 队列徽标 + esc 提示
│ 4 input ───────── 1..N 行自增高编辑器（IME 守卫 / 历史 / 斜杠补全）
└ 5 footer ──────── 1 行 · dim · 上下文相关快捷键提示
```

Ink 组件树（Static / Live 二分是性能架构的核心）：

```tsx
<App>
  {/* 已落定事件：append 进 Static，进程生命周期内只渲染一次 */}
  <Static items={settledEvents}>
    {(e) => <Projection event={e} />} {/* §4 投影表，纯函数 */}
  </Static>

  {/* 活动尾：每帧重绘，仅此区域——与账本「已落账 / 进行中」二分天然同构 */}
  <Column>
    <StreamingAssistant deltas={liveDeltas} /> {/* 流式中的 assistant 增量 */}
    <ActiveTools calls={runningCalls} /> {/* 运行中工具卡（并行组） */}
    <PermissionCard request={pending} /> {/* 焦点抢占（§7） */}
    <StatusLine state={turnState} usage={usage} queue={queue} />
    <InputEditor onSubmit={submit} imeGuard /> {/* §8 */}
    <FooterHints context={focusContext} />
  </Column>
</App>
```

**性能规范**（长会话不卡是底线）：

- Static 区渲染成本 O(新增事件)，与历史长度无关；活动尾重绘节流 ≤ 30fps；
- 流式 delta 合帧：每 33ms 或每 40 字符取先到者，一帧只产一次渲染；
- 单条工具输出渲染上限 20 行，超出折叠为 `… +N 行（e 展开 · readHint 取全文）`；
- `SIGWINCH` 全量重排；宽度 < 80 列进入 §5 降级（工具卡单行化、表格收窄）；
- 渲染纯函数化（投影表无内部状态），为 §12 确定性快照测试创造条件。

---

## 4. 事件 → 组件投影表（TUI 的「唯一渲染规范」）

| 事件                           | 组件                 | 渲染规范                                                                                                                       |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `turn.started`（用户输入）     | `UserMessage`        | `❯ ` 前缀（accent 蓝）+ 原文；多行续行缩进对齐前缀宽度                                                                         |
| `step.started` + 实时 delta    | `StreamingAssistant` | 活动尾增量渲染；M1 纯文本，M2 markdown 块级增量                                                                                |
| `assistant.completed`          | `AssistantBlock`     | 落定后从活动尾迁入 Static：正文 + thinking 折叠行                                                                              |
| thinking（completed 内）       | `ThinkingFold`       | `▍思考 4.2s` dim 行；`e` 展开全文，再 `e` 收起                                                                                 |
| `tool.call` / `tool.result`    | `ToolCard`           | 见 §6；完成后 dim 化                                                                                                           |
| `permission.requested`         | `PermissionCard`     | 见 §7，焦点抢占                                                                                                                |
| `permission.decided`           | `AuditRow`           | dim 审计行：`● allowed bash "npm test" scope=session`（谁批的、什么范围，回放可见）                                            |
| `turn.completed`               | `TurnDivider`        | `── 完成 · 3 steps · 15,204 tok · $0.042 ──` dim 居中                                                                          |
| `turn.cancelled`               | `CancelNote`         | `✗ 已中断 · 已完成 2/5 step · 已产出内容保留`（warn 黄）+ TurnDivider                                                          |
| `turn.failed`                  | `ErrorCard`          | err 红边：错误码 + message + recoveryHint + `e` 展开堆栈                                                                       |
| `context.compacted`            | `CompactNote`        | dim：`⇲ 上下文已压缩 · 保留最近 K 轮 · 丢弃范围 #seq`                                                                          |
| `user.answered`                | `AnswerEcho`         | 结构化回答回显（选项文本或摘要）                                                                                               |
| `plugin.activated/deactivated` | dim 单行             | 插件变更可感知但不打扰                                                                                                         |
| **未知事件**                   | `FallbackRow`        | dim：`[event:xxx #seq]`。**没有 unhandled 事件**——旧 schema 版本的事件也必须有兜底渲染，这是「日志是永久资产」在 UI 层的对应物 |

---

## 5. 视觉语言（扁平：层级靠明暗与状态色，不靠盒子堆砌）

色彩 token（truecolor 值，降级链自动映射）：

| token    | 值           | 用途                                   |
| -------- | ------------ | -------------------------------------- |
| `fg`     | 终端默认     | 正文（assistant 输出不用花色）         |
| `dim`    | gray         | header/footer/审计行/已完成工具卡      |
| `accent` | 蓝 `#5cadff` | 用户消息前缀 `❯`、输入光标、spinner    |
| `ok`     | 绿 `#46c46a` | 工具成功、✓                            |
| `warn`   | 黄 `#d6a235` | 中断、软预算告警、风险注解             |
| `err`    | 红 `#e5534b` | 失败、✗                                |
| `focus`  | accent       | 权限卡边框（唯一的完整边框，焦点语义） |

规则：

- **正文无边框**；工具卡 = 左侧 2 列竖条 `▎`（状态色）+ 内容；只有权限卡用完整边框（它是唯一需要抢夺注意力的模态）；
- 状态语义色全局一致：pending=dim、running=accent+spinner、ok=绿→dim、fail=err、denied=warn、aborted=warn；
- 降级链：truecolor → 256 → 16 → mono（`NO_COLOR` / `TERM=dumb`）；Unicode → ASCII（`▎→│`、`⠋→*`、`❯→>`、`─→-`、`✓→v`）；
- 窄终端（< 80 列）：工具卡收成单行 `tool(args摘要) ✓ 0.3s`，表格类输出纵向堆叠。

### 常态总览（ASCII 规范稿）

```
 spark v0.1.0 · claude-sonnet-4-5 · ~/proj/app · s:a3f9c2                    ← ① dim
────────────────────────────────────────────────────────────────────────────

 ❯ 帮我把 debounce 从 300ms 改成 150ms，测试同步更新                          ← ② 用户消息

   我先定位相关实现。                                                          ← ③ assistant 正文

   ▎grep "debounce" src/                          ✓ 0.4s · 18 处              ← ④ 工具卡(完成,dim)
   ▎read ComposerV2.tsx L410-438                  ✓ 0.2s · 2.1KB
   ▎edit ComposerV2.tsx                            ✓ +2 −2                  ← ⑤ diff 摘要
   ▎edit quick-reply.test.ts                       ⠋                        ← ⑥ 运行中(accent)
   ▎bash npm test -- quick-reply                   ◌ 等待依赖                ← ⑦ pending(dim)

   ⠋ 同步测试断言 · step 4 · 12,480 tok · $0.031                 esc 中断    ← ⑧ status 行

 ❯ _                                                                       ← ⑨ 输入区
 /help 帮助 · ↑ 历史 · esc 中断                                              ← ⑩ footer dim
```

---

## 6. ToolCard（工具调用状态卡）

状态机：`pending → running → ok | fail | denied | aborted`；进入终态后整体 dim 化（视觉重心永远在「正在发生的事」）。

```
▎bash npm test                                  … ✗ exit 1                ← fail(err) + e 展开尾部输出
  └ 尾部 12 行输出（e 收起） · 全文 readHint: read artifact ab12…           ← 展开态
```

- **折叠态一行**：`▎ + 工具名 + 参数摘要（截到终端宽 − 状态列） + 状态列`；参数摘要规则——路径取相对路径尾部、长 JSON 折为 `{k1:v1, k2:…}`；
- **展开态**（`e` 键，焦点在最后一张卡时；M2 任意卡序号选择）：完整参数 + 截断输出尾部 + `readHint` 取回全文指引；
- **并行组**：同 step 的 parallel 调用同时显示多卡各自状态；写类串行时后续卡显示 `◌ 等待依赖`；
- diff 类工具（edit/write）完成态显示 `+N −M` 增删摘要（M1 计数，M2 高亮 diff 块）；
- 产物类（M2+，图像/音频）：`🖼 image.png · artifact sha256:ab12…`。

---

## 7. PermissionCard（权限确认，焦点抢占协议）

权限请求到达时**输入区锁定**，PermissionCard 成为唯一键盘焦点源（焦点唯一原则：任何时刻只有一个组件消费普通按键）。

```
 ┌ 权限确认 · bash ──────────────────────────────────────────────┐
 │ rm -rf node_modules && npm install                            │  ← 真实命令全文，不截断
 │ cwd ~/proj/app · 风险: 删除目录 + 网络安装 · 规则来源: 默认策略  │  ← 风险注解(taint/规则)
 ├──────────────────────────────────────────────────────────────┤
 │ ❯ 1 允许一次    2 本会话总是    3 写入配置    4 拒绝            │
 │   ↑↓/数字选择 · enter 确认 · e 展开完整命令 · esc 视为拒绝      │
 └──────────────────────────────────────────────────────────────┘

 ⏸ 等待权限确认 · 30s 后按拒绝处理                                ← 超时策略可见
 ❯ (输入已锁定)                                                   ← dim
```

- 决策后卡片收起为 **AuditRow**：`● allowed bash "npm test" scope=session`（dim，永久保留在 transcript——决策本身是事件）；
- `e` 展开完整命令 / 编辑类工具的完整 diff；`esc` = 拒绝并回喂理由「用户驳回」；
- 数字键选择同样过 IME 守卫（组合中的数字不触发选择）；
- 审批超时按 fail-closed 处理（主设计 §7.4），倒计时 dim 显示。

---

## 8. InputEditor（输入编辑器）

- **多行**：`Enter` 发送；换行 = `Option/Alt+Enter`、`Shift+Enter`（终端支持时）、行尾 `\` 续行；
- **IME 组合守卫（硬性规范）**：`keypress` 事件满足 `name==='return' && (code==='229' || isComposing)` 时**一律吞掉**——macOS 中文输入法确认候选的 Enter 会以 229/isComposing 形态出现，裸判 `name==='return'` 会把「确认候选」误当发送（SparkWork 前端已踩过的确定性坑，TUI 侧同样成立，进测试用例）；组合中的数字/方向键不得被补全浮层与权限卡消费；
- **历史**：空输入时 `↑/↓` 翻历史，按项目持久化；
- **粘贴**：≥ 8 行折叠为 `[粘贴 N 行 · e 展开]`；
- **斜杠补全**：`/` 开头弹出浮层（`↑/↓` 导航、`Tab/Enter` 补全、`esc` 关闭）；命令集见 §10；
- M2：`@` 文件路径补全、`!` shell 直通、图片粘贴为 artifact 引用。

---

## 9. 中断、排队与转向（与 SparkWork 宿主同一交互契约）

| 动作                 | 语义                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ESC`（运行中）      | 取消当前 turn：AbortSignal 树停流杀子进程；进行中工具补 `tool.result(aborted)`；落 `turn.cancelled`，已产出内容保留 |
| `ESC`（权限卡）      | 视为拒绝                                                                                                            |
| `ESC`（浮层/展开态） | 逐层收起，最后才轮到中断语义                                                                                        |
| 运行中 `Enter` 提交  | **排队（FIFO），不打断**：status 行显示 `+1 已排队`，当前 turn 终态后自动作为下一 turn 提交；`/clear` 可清空队列    |
| `Ctrl+C`（运行中）   | 同 ESC 中断                                                                                                         |
| `Ctrl+C`（空闲）     | 首按提示「再按一次退出」，1s 内双按强制退出                                                                         |
| `/steer`（M3）       | step 边界注入当前 turn（主设计 §3.2 steering，不打断工具）                                                          |

排队契约与 SparkWork 宿主已定案行为一致（会话运行中的命令进队列 FIFO、不打断当前对话）——**同一内核语义，两个宿主不发散**。

---

## 10. 斜杠命令集

| 命令                 | 里程碑 | 行为                                                       |
| -------------------- | ------ | ---------------------------------------------------------- |
| `/help`              | M1     | 命令与快捷键一览                                           |
| `/model [id]`        | M1     | 无参列出可用模型与当前选择；带参切换（当前会话生效）       |
| `/status`            | M1     | 会话 id、模型、token/成本累计、队列、权限模式              |
| `/perm [mode]`       | M1     | 查看/切换权限模式（default / acceptEdits / plan / bypass） |
| `/clear`             | M1     | 开新会话（旧会话保留于磁盘，可 resume）                    |
| `/exit` `/quit`      | M1     | 退出                                                       |
| `/tools`             | M2     | 已注册工具清单与来源（内置/插件/MCP）                      |
| `/theme`             | M2     | dark / light / auto                                        |
| `/history`           | M2     | 历史搜索（Ctrl+R 同入口）                                  |
| `/resume [id]`       | M3     | 会话列表选择恢复（M3 随 SQLite 投影）                      |
| `/compact`           | M3     | 手动压缩当前上下文                                         |
| `/export [md\|json]` | M3     | 导出当前会话                                               |
| `/plugin`            | M4     | 插件启停/安装/列表                                         |
| `/rewind`            | M5     | 检查点回滚（快照 + 日志截断）                              |

---

## 11. Header 与 StatusLine

- **Header**（1 行 dim）：`spark v0.1.0 · <model> · <cwd 尾部路径> · s:<sessionId 前 6 位>`；窄屏优先截 cwd；
- **StatusLine 运行态**：`⠋ <当前动作·由内核事件驱动> · step N · <累计 tok> · <累计 $> · [+K 已排队 ·] esc 中断`；
- **StatusLine 空闲态**：`● 就绪 · <model> · 上下文 23% · /help 帮助`（上下文百分比逼近阈值变色提示可 `/compact`）。

---

## 12. 测试策略（确定性渲染回归——UI 测试零 token）

主设计招牌 1「确定性内核证书」在 UI 层的延伸：

1. **组件测试**：`ink-testing-library` 渲染单个组件（ToolCard 各状态、PermissionCard、投影表每行），断言输出文本；
2. **整轮渲染快照**：`createDeterministicEnv(FakeModel 脚本)` 驱动完整 turn，`stripAnsi(render.lastFrame())` 后与黄金文件逐字节对比（`test/golden-ui/<case>.txt`，更新流程与事件黄金日志一致，review 必须能解释每一行变化）；
3. **交互脚本测试**：模拟 keypress 序列——IME 守卫（229/isComposing 不发送）、ESC 中断落 `turn.cancelled`、运行中提交进队列、权限卡数字选择与 ESC 拒绝、双击 Ctrl+C 退出；
4. **降级矩阵测试**：mono / 256 色 / 非 TTY / `--json` 四条路径的输出形态断言。

渲染可确定性成立的前提已由投影表保证：**渲染器是纯函数，无内部时钟与随机**（时间显示由事件 `ts` 驱动）。

---

## 13. M1 交付范围与 DoD

**M1 内**：REPL 骨架（五区布局）、投影表全类型（含 FallbackRow）、InputEditor（IME 守卫/历史/粘贴折叠/斜杠补全最小集）、ToolCard（含并行组与折叠/展开）、PermissionCard（焦点抢占/AuditRow）、ESC 中断与 FIFO 排队、StatusLine/Header、色彩与字符降级链、`--plain`/非 TTY/`NO_COLOR` 降级、渲染快照与交互脚本测试。

**M1 外**（里程碑见主设计 §18）：markdown 流式渲染与 diff 高亮（M2）、`@file`/`!shell`/图片粘贴（M2）、`/resume` 多会话切换与 `/compact`（M3）、内部滚动视窗与鼠标（按需评估，非承诺项）。

**DoD**：

1. `spark` 无参进入 REPL，FakeModel 后端可完整交互：输入 → 流式渲染 → 工具卡 → 权限卡 → 终态分隔线；
2. 任何事件类型（含未知/旧版本）都有确定渲染路径，无 unhandled；
3. ESC 中断 → `turn.cancelled` 渲染正确，进行中工具显示 aborted；
4. 运行中提交 → 队列徽标可见，终态后自动续跑下一 turn；
5. 权限卡全键盘操作可用（数字/↑↓/enter/esc/e），决策留 AuditRow；
6. IME 守卫用例绿：229/isComposing 的 Enter 不发送、组合中数字不误选；
7. `--plain`、非 TTY、`NO_COLOR`、窄终端四条降级路径可运行；
8. `ink-testing-library` + FakeModel 整轮渲染快照进黄金文件，逐字节对比通过。

---

## 14. 已授权的实现决策

1. 权限选项保留「写入配置」能力；M1 的 FakeModel TUI 展示完整选项，真实配置持久化随配置系统落地，不能伪装为已写入。
2. `TurnDivider` 默认显示成本；后续 `/theme` 可关闭。
3. thinking 默认折叠为一行摘要，可显式展开。
4. 状态行动词从事件推导，不维护独立 UI 状态源。

## 15. M1 落地核对（2026-08-26）

- Ink 7 + React 19 实现五区 TUI；保持本文批准的 Static/Live、扁平视觉、原生 scrollback 与 30fps 上限，版本升级不改变交互契约。
- 全量事件投影含未知事件 FallbackRow，ToolCard、PermissionCard、Header、StatusLine、InputEditor、FIFO 排队与 ESC/Ctrl+C 取消已实现。
- 权限卡支持数字、上下、Enter、Escape；“写入配置”在配置系统落地前明确提示未持久化，不伪造成功状态。
- IME 229/isComposing 组合守卫以纯函数和回归测试固化；普通 Enter 路径由整轮 TUI 交互测试覆盖。
- mono/ASCII 能力、NO_COLOR/非 TTY/plain/JSON 降级已实现；整轮 mono 最终帧进入 `test/golden-ui/basic-turn.txt` 逐字节回归。
- 构建后已在真实 PTY 启动 TUI，并以 `/exit` 正常退出；`ink-testing-library` 快照与交互测试全绿。
