# 画布 Prompt 与任务 Board 隔离设计

> 状态: 已落地 | 最后核对: 2026-07-23

## 背景

普通画布操作节点会从全局 `localStorage` 读取操作预设，并把预设 Prompt 固化为节点的隐藏 `systemPrompt`。当用户从另一个项目创建同类节点时，旧项目 Prompt 会在当前 User Prompt 之前发送给媒体 Provider。长请求诊断只显示前缀，因此当前输入还会被截断隐藏。

任务侧同时存在 board 归属缺口：媒体和文本任务创建入口丢弃当前 `boardId`，退回项目第一个 board；工作区任务快照只按项目过滤。

## 目标

- 普通操作节点不得从全局操作预设继承 Prompt/System Prompt。
- 专用流水线节点继续保留显式功能 System Prompt。
- 全局 last-used 仅复用 Provider、Manifest、Model、Agent、Skills、负面提示词和模型参数。
- 已经固化在普通节点中的全局预设 Prompt 在再次运行前自动剔除，但显式节点 System Prompt、项目 Prompt 和专用流水线 Prompt 不受影响。
- 媒体与文本任务必须归属调用时的当前 board。
- 工作区任务队列默认仅展示当前 board 的任务；项目级资产仍共享。

## 设计

### Prompt 来源分层

新增纯函数判定普通节点的历史 `systemPrompt` 是否等于当前仍保留的全局操作预设 Prompt 组合。普通节点创建时只组合内置能力 Prompt、项目 Prompt 与显式 System Prompt，不再注入用户编写的通用操作预设 Prompt；专用流水线目标仍使用对应功能预设。

运行旧节点时，在 `normalizeCanvasFunctionalSystemPrompt` 之前清理可确认来自通用操作预设的污染值。无法确认来源的 System Prompt 保留，避免误删用户显式配置。

### Board 传递

`createMediaTask` 与 `createTextTask` 恢复必传 `boardId`。store 从当前快照传入活动 board；绑定已有操作节点时以节点自身 `boardId` 为准。快照的 `tasks` 使用 `projectId + boardId` 过滤。

### 兼容与数据处理

不改写历史任务的 `requestCall`，保证审计事实不被篡改。现有普通操作节点的污染 System Prompt 在下一次运行或重试时被清理；新节点从源头不再产生污染。无法与当前仍保留的旧全局预设精确匹配的历史值不做猜测性删除。

## 安全与可观测性

修复点位于 Provider 调用前，避免旧项目文本继续流向外部服务。任务详情仍分别展示画布提交快照与最终模型请求。回归测试必须断言最终提交请求不包含跨项目预设文本。

## 测试

- 普通 `text_to_image` 节点创建时忽略全局预设 Prompt。
- 专用流水线节点仍保留功能 System Prompt。
- 已污染普通节点运行时剔除匹配的全局预设 Prompt。
- 用户显式 System Prompt 不被剔除。
- media/text 任务写入当前 board，工作区快照不出现其他 board 任务。
- 相关单测、类型检查和桌面构建通过。
