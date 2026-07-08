# Checkpoint 重设计：自包含内容快照（替代失效的 SDK rewindFiles）

> 状态: [实施中] | 最后核对: 2026-06-30

分支 `feat/unified-orchestration-kernel`。承接编排改造 M5。

## 为什么推翻 SDK rewindFiles 方案

- 运行时验证（用户实测）：`/checkpoint restore <uuid>` → CLI 报 **`No file checkpoint found for this message`**。
- 根因：SDK `enableFileCheckpointing` 的文件备份只存在于**创建它的那个活跃 query/会话**内；Spark 每轮新建 query，resume 出的新会话拿不到原 turn 的备份。`rewindFiles` 控制请求也仅在流式活跃会话内可用。
- `WorkspaceSnapshotService` 现有快照只存 `{mtimeMs, size}` 元数据（给 diff 用），**无文件内容**，不能还原。

结论：必须自建内容备份机制。

## 已确认设计决策（用户）

1. **默认关闭**；checkpoint 为会话级开关，需用户在会话中手动开启。
2. 开关 UI 放在「代码还原点」侧拉面板（`CheckpointTimelinePanel`）**头部**；入口按钮按「已开启/未开启」做样式区分。
3. **不是每轮都快照**：仅当产生了实际文件变更时才快照（精细化控制代价）。
4. 内容快照 + 拷回式 restore（自包含、不依赖 SDK、不挑工作区类型）。

## 机制

### 开关与状态
- 新增会话级 `checkpointEnabled: boolean`（默认 false），持久化（session metadata 或新列）。
- IPC：`session:get-checkpoint-config` / `session:set-checkpoint-config`（或并入现有 session 配置通道）。
- 仅 `checkpointEnabled === true` 的会话才采集快照。

### 智能快照（turn 开始前）
宿主 turn 开始前（已有 `snapshotBeforePromise` 元数据快照点，`session.service.ts` ~2050）：
1. 取当前工作区**元数据**快照（便宜，复用 `WorkspaceSnapshotService.snapshot`）。
2. 与「上一个 checkpoint 的元数据」`diff`：无 added/modified/deleted → **跳过**（不建 checkpoint）。
3. 有变更 → 做一次**内容快照**：把当前（本轮修改前）工作区文本文件内容写入 checkpoint 存储；记录该 checkpoint（id、turnId、时间、相对 path 列表、存储目录、元数据快照用于下次比较）。emit `checkpoint` 事件（带 path 指向存储目录）。

> 语义：checkpoint 捕获的是「本轮开始前」的工作区状态 = 一个可回退点。首个变更轮会先捕获初始/上轮结果态。

### 代价控制
- 只快照文本文件；受 `MAX_FILES`、单文件 size 上限、`DEFAULT_IGNORE_PATTERNS`（复用快照服务的忽略规则，含 node_modules/.git 等）约束。
- 存储在 **app-data**（如 `<userData>/checkpoints/<sessionId>/<checkpointId>/`），不污染工作区、不进 git。
- 每会话只保留最近 **N**（如 20）个 checkpoint，超出删最旧的目录。

### restore
`restoreCheckpointViaSnapshot(sessionId, checkpointRef)`：
1. 找到 checkpoint → 取其存储目录与 path 列表。
2. 把存储目录内容拷回工作区对应相对路径（覆盖现有）。
3. 删除「当前存在但快照中没有」的文件（可选、谨慎：仅删快照采集范围内、非 ignore 的文件，避免误删 node_modules 等——通过对比快照时记录的 path 集合）。
4. 返回 `{ checkpointId, restoredFiles, missingFiles }`。
- 弃用当前的 `restoreCheckpointViaRewind`（SDK 路）。

## 实施切片（inline，subagent 池 7:30pm 前不可用）

- **C1 存储/服务**：新增 `CheckpointContentService`（内容快照写/读/拷回/prune），存 app-data。新文件，可单测。
- **C2 会话开关**：session `checkpointEnabled` 持久化 + IPC get/set。
- **C3 采集接线**：turn 开始前按「开启 + 有变更」触发 C1 快照 + emit checkpoint 事件（带 path）；记录上一个 checkpoint 的元数据用于比较。
- **C4 restore 切换**：`restoreCheckpoint` 改走 C1 拷回；移除/降级 rewindFiles 路（保留 `ClaudeSDKExecutor.rewindFiles` 方法备查，但 restore 不再用）。
- **C5 前端**：`CheckpointTimelinePanel` 头部加开关（调 C2 IPC）；入口按钮开/关样式区分；列表展示快照 checkpoint，restore 按钮接 C4。
- **C6 清理**：移除 M5-A/C 里「从 SDK user-message uuid 发 checkpoint 锚点」的逻辑（那是给 rewindFiles 用的，现不需要）——改为 C3 的快照事件作为 checkpoint 来源；或保留锚点字段但不依赖。`sdkSessionId` 字段可弃用。

## 历史（M5 SDK 方案，已废弃，仅留记录）

- `192e4fec` 锚点改用 SDK user-message uuid（C6 将替换其作用）
- `18a2f688` snapshot 带 sdkSessionId（C6 后 sdkSessionId 不再是还原依据）
- `78d8a70a` restore 用 rewindFiles（C4 将替换）

> 这三处不必回滚，C3–C6 用内容快照覆盖其语义即可；rewindFiles 方法保留备查。
