---
name: Spark Debug
description: "交互式调试模式：面对难复现的 bug，agent 用「假设驱动 + 人在回路」的闭环排查——读代码形成假设 → 插入会上报到本地日志服务的 debug 日志（浏览器侧也能收，CORS 已处理）→ 让用户去复现 → 读本轮日志验证/推翻假设 → 修复并再插一轮验证 → 用户确认解决后清除全部插桩交付。绝不假装自己能复现，复现永远交给用户。"
version: 1.0.0
author: Spark AI
category: debugging
tags: [debug, 调试, bug, troubleshooting, logging, 日志, 复现, reproduce, hypothesis, 排查]
---

# Spark Debug —— 交互式调试模式

你在「调试模式」下工作。一个本地日志服务已在后台运行，你插入的 debug 日志会上报到它那里（**包括浏览器/webview/前端代码**，跨域已处理）。你的任务是用 **假设驱动 + 人在回路** 的闭环定位并修复 bug。

> 核心原则：**你不能复现 bug，复现永远是用户的步骤。** 你负责假设、插桩、读日志、分析、修复、清理；用户负责操作复现。每插一轮桩就**结束 turn**，把控制权交回用户。

可用工具（MCP 命名空间 `mcp__spark_debug__`）：

| 工具 | 何时用 |
|------|--------|
| `begin` | 进入调试**第一步**。拿到 `sid` / 端口 / 当前轮次 + 可直接粘贴的插桩上报器 |
| `read` | 用户说"复现完了"之后，拉取**本轮**日志 |
| `status` | 看 `thisRound`（本轮收到几条）判断用户是否真复现；看 `hypotheses` 台账避免重复假设 |
| `next_round` | 验证完一轮、要插新一批桩时调用，传入本轮假设，推进轮次并拿到新一轮上报器 |
| `finish` | 用户确认 bug 解决后调用：清空日志 + 返回需要从代码删除的插桩标记 |

---

## 状态机（严格按此执行）

### Stage 1 · 理解 + 启动
1. 读 `bugDescription`，必要时用 `Read` / `Grep` 看相关代码，建立初步理解。
2. 调 `begin` → 记下 `sid`、`port`、`round`，拿到 `snippets`（已填好真实 sid/round/port 的上报器）。

### Stage 2 · 假设 + 插桩
3. 形成**一个明确假设**（"我怀疑 X 导致 Y，因为 Z"）。
4. **改代码前先评估影响面**（本项目要求对将修改的 symbol 跑 impact 分析；HIGH/CRITICAL 风险先告知用户）。
5. 在关键路径插入 debug 日志：粘贴 `snippets` 里的上报器，并在可疑点调用 `__sparkDebug('标签', { 变量 })`。
   - **必须**用 `// __SPARK_DEBUG_START__ ... // __SPARK_DEBUG_END__` 标记包裹（snippet 已含），便于最后精确清除。
   - 日志要能**区分假设成立与否**——打印能验证假设的关键变量/分支，而不是无脑打一堆。
6. 给用户**清晰的复现指引**（点哪、输入什么、预期看到什么），然后 **结束 turn 等待用户复现**。

### Stage 3 · 读日志 + 判断
7. 用户回"复现完了" → 先 `status` 看 `thisRound`：
   - `thisRound === 0` → 用户大概率**没走到插桩路径**。不要硬分析空日志；告诉用户可能的原因、调整插桩点或复现步骤，回 Stage 2。
   - `thisRound > 0` → `read` 取本轮日志，逐条对照假设。
8. 判断：
   - **假设成立** → 进入 Stage 4 修复。
   - **假设不成立/信息不足** → 形成新假设（不得与 `status.hypotheses` 里已排除的重复），`next_round({hypothesis})` 拿新上报器，回 Stage 2 调整插桩。

### Stage 4 · 修复 + 验证
9. 实施修复（先评估影响面）。
10. 在修复点附近插入**验证日志**（证明修复路径被走到、状态符合预期），`next_round({hypothesis: '验证修复 X'})`。
11. 给用户复现指引，**结束 turn** 让用户测试。

### Stage 5 · 验收 + 交付
12. 用户反馈：
    - **"解决了"** → 调 `finish` 拿 `markers` → 用 `Grep` 全仓搜 `__SPARK_DEBUG` → `Edit` 删除**每一个** `__SPARK_DEBUG_START__ ... __SPARK_DEBUG_END__` 块及你加的 `__sparkDebug(...)` / `__spark_debug(...)` 调用 → **再 grep 一次确认零残留** → 交付总结（根因 / 修复点 / 日志证据）。
    - **"没解决"** → `read` 当前轮日志，回 Stage 3 继续。

---

## 护栏

- **轮次上限**：若进行到约 **6 轮** 仍未定位，主动收口：总结已排除的假设、当前最可能的方向，请用户补充信息（更精确的复现条件、环境、相关日志），不要无限打转。
- **零残留是交付的硬条件**：`finish` 后若 `Grep __SPARK_DEBUG` 仍有命中，不算交付完成。
- **不破坏宿主应用**：上报器自带 `try/catch` + 静默失败 + `keepalive`，不要改这部分让它抛错。
- **一次一个假设**：不要一轮里塞多个不相关假设，否则日志难归因。

各语言上报器模板与字段说明见 `references/instrument-snippets.md`；完整状态机与边界话术见 `references/state-machine.md`。
