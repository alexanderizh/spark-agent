# 会话级计划任务设计

> 状态: 已落地 | 最后核对: 2026-08-14

## 1. 目标

在现有全局定时任务能力上增加 `session` 作用域。用户可以从会话右键菜单或会话内容区右上角打开计划任务浮层，为同一个会话创建多个计划任务。任务到期后不新建会话，而是把任务 Prompt 作为持久化 turn 排入绑定会话，并沿用该会话执行时的 Agent、模型、权限模式和工作区配置。

## 2. 已确认的产品规则

- 同一会话允许绑定多个计划任务。
- 支持单次、固定间隔和 Cron；Cron 放在高级入口中。
- 会话正在运行时，计划触发采用排队等待，不中断当前 turn。
- 应用关闭期间错过的触发全部跳过；下次启动从新的未来时间继续。
- 每次执行读取会话当前运行配置，不保存 Agent、模型或权限快照。
- 删除会话时，绑定任务及其执行记录级联删除。
- 归档会话时，自动暂停归档前启用的任务；取消归档时只恢复这些任务。归档前手动暂停的任务保持暂停。
- 用户没有停留在目标会话时，完成状态沿用现有侧栏未读标记，并按现有 Hook 通知设置发送系统通知；仅当主窗口聚焦、当前页面为聊天且正在查看目标会话时抑制通知和未读标记。独立画布窗口不参与主窗口活动会话上报。

## 3. 方案

扩展现有 `scheduled_tasks`，不创建第二套调度服务：

```text
scheduled_tasks(scope=session, session_id=...)
        |
        v
ScheduledTaskService（统一计算、轮询、执行记录）
        |
        v
SessionService.submitTurn（持久化排队）
        |
        v
绑定会话当前运行时配置
```

全局任务保持当前“每次执行创建新会话”的行为。会话任务进入分支执行器，只提交到 `session_id` 指定的现有会话。

## 4. 数据模型

给 `scheduled_tasks` 增加：

- `scope TEXT NOT NULL DEFAULT 'global'`：`global | session`。
- `session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE`：仅 `scope=session` 时非空。
- `paused_by_archive INTEGER NOT NULL DEFAULT 0`：标记任务是否因为会话归档而被系统暂停。
- `skip_if_session_running INTEGER NOT NULL DEFAULT 1`：会话存在活动或排队 turn 时跳过本次触发。
- `continue_on_error INTEGER NOT NULL DEFAULT 1`：会话上一轮报错后是否继续保留后续触发；关闭时暂停该计划任务。

约束由服务层与 IPC Schema 双重验证：

- `scope=global` 时 `session_id` 必须为空。
- `scope=session` 时 `session_id` 必须指向存在的会话。
- 会话任务不可通过更新接口改绑到另一会话。
- 会话任务不参与全局任务导入导出；全局任务管理页默认只查询 `scope=global`。

索引：

- `idx_scheduled_tasks_session_id(session_id)` 用于面板查询和生命周期操作。
- `idx_scheduled_tasks_scope_due(scope, enabled, next_run_at)` 用于启动校正及调度查询。

## 5. 调度与离线语义

调度器启动时先执行一次会话任务校正：

- 回收上次进程退出时遗留的 `running` execution，将其记为中断失败，清空任务的 `current_execution_id` 并恢复可调度状态。
- `next_run_at <= now` 的固定间隔/Cron 任务直接从当前时间重新计算未来时间，不执行漏掉的批次。
- 已错过的单次任务没有下一个周期，自动禁用并清空 `next_run_at`。
- 全局任务保持现有行为，不受这次校正影响。

Cron 使用 `cron-parser` 解析完整五字段表达式并按任务时区计算，非法范围（如分钟 `61`）在保存前拒绝。正常到期的单次任务在提交本次 turn 后自动禁用，不再计入启用任务。

正常运行期间，到期任务仍由统一 tick 找出并创建 `task_executions`。同一个任务已有执行时继续遵循任务并发策略；会话内 turn 始终由 `SessionService.submitTurn` 串行排队。会话任务在创建 execution 前读取绑定会话的活动状态和持久化队列：`skip_if_session_running=1` 时，活动或排队 turn 会跳过本次触发并计算下一次时间；一次性任务保留原定时点，延后 60 秒重试；状态读取失败时不创建 execution 并延后重试。`continue_on_error=0` 时，主进程收到会话 `agent_status=error` 事件会立即暂停任务，调度 tick 仍以持久化会话 `error` 状态兜底。关闭运行中跳过后，任务仍可按已有并发策略排入会话队列。

`task_executions.completed` 表示本次调度请求已成功提交到会话持久化队列。真正的 Agent turn 完成/失败继续由会话 `agent_status` 事件、侧栏未读状态和 Hook 通知呈现，避免引入第二套 turn 生命周期。

## 6. 会话生命周期

### 删除

数据库外键负责 `sessions -> scheduled_tasks -> task_executions` 级联。`SessionRepository.deleteWithRelatedData` 不手写重复删除逻辑，只通过迁移和仓储测试保证级联生效。

### 归档

`session:update archived=true` 成功后调用调度服务：

- 对该会话所有 `enabled=1` 的任务设置 `enabled=0`、`status=disabled`、`next_run_at=NULL`、`paused_by_archive=1`。
- 已手动暂停的任务保持 `paused_by_archive=0`。

`archived=false` 时只恢复 `paused_by_archive=1` 的任务，为每个任务重新计算未来 `next_run_at`，然后清除标记。

## 7. IPC 与运行时

扩展现有类型与请求：

- `ScheduledTaskItem` 增加 `scope`、`sessionId`、`pausedByArchive`、`skipIfSessionRunning`、`continueOnError`。
- list 支持 `scope`、`sessionId` 过滤。
- create 支持 `scope`、`sessionId` 以及两个会话执行保护开关，缺省均为开启。
- update 支持修改两个执行保护开关，但不允许修改既有任务的 `scope` 与 `sessionId`。

执行器参数增加可选 `sessionId`：

- 有 `sessionId`：验证会话存在且未归档，调用 `submitTurn({ sessionId, message })`，不传运行时覆盖字段。
- 无 `sessionId`：沿用现有全局任务创建会话流程。

## 8. 界面设计

界面采用项目现有的紧凑、克制桌面工具风格，而不是复制独立的全局任务管理页。

### 入口

- 侧栏会话右键/更多菜单：在“重命名”和“删除”之间加入时钟图标的“计划任务”。点击后切换到该会话并打开浮层。
- `ChatTabbar` 右上角：加入时钟按钮。存在启用任务时显示小状态点；按钮控制浮层开关。

### 浮层

浮层作为新的独立组件挂在 `ChatView`，位于标题栏下方、内容区右上角，宽度约 380–420px，窄窗口下改为占满内容区宽度。它不挤压消息流，点击遮罩或关闭按钮收起。

默认态展示：

- 会话名称和“仅在此会话运行”说明。
- 任务列表：名称、调度摘要、下次运行时间、启用开关、编辑/立即运行/删除操作。
- “新增任务”主按钮。

新增/编辑态展示：

- 任务名称、Prompt。
- 单次/固定间隔/Cron 调度。
- 创建后启用开关。
- “会话运行中跳过”和“报错后继续执行”开关，默认开启；表单说明活动/排队 turn 与错误状态的处理方式。
- 明确提示“执行时使用会话当前配置”“会话归档会自动暂停”。

### 主题与视觉层级

浮层只使用应用在 `styles.css` 中定义的主题变量，不依赖 Ant Design 或其他组件库的私有 token：

- 容器使用 `--panel`、`--panel-elev`、`--border-strong` 和 `--shadow-lg`。
- 正文层级使用 `--text`、`--text-strong`、`--text-muted` 与 `--text-faint`。
- 强调与交互使用 `--primary`、`--primary-soft` 和 `--primary-fg`。
- 遮罩使用当前主题背景与透明黑混合，深色主题不出现浅色面板 fallback。

视觉采用克制的桌面工具面板：标题区、会话摘要、任务统计和操作区保持明确分层；空状态改为紧凑的柔和容器，不使用占据主体的大面积虚线框；新增按钮在深浅主题下均保持清晰的边框、悬停和键盘焦点状态。

### 侧栏标记与筛选

侧栏启动时通过一次 `scheduled-task:list({ scope: 'session' })` 获取全部会话任务，并聚合为 `sessionId -> { total, enabled }`，不对每条会话分别发起 IPC 请求。任务创建、编辑、启停或删除后由面板回调刷新聚合状态；任务执行事件和会话归档状态变化也触发刷新。

- 有启用任务的会话在标题右侧显示品牌色小时钟标记。
- 只有暂停任务的会话显示中性灰小时钟标记。
- 标记 Tooltip 展示任务总数和运行中数量；图标使用 `@lobehub/ui` 的 `Icon` 组件承载 Lucide `Clock3`，不使用 Emoji 或手写 SVG。
- 标记位于标题之后、终端和运行状态之前，不与未读、置顶及 worktree 前缀图标争夺位置。
- 筛选器新增“计划任务”维度，选项为“全部 / 已挂载 / 未挂载”；“已挂载”包含全部暂停的任务。
- 筛选值写入现有侧栏筛选持久化数据，旧数据缺少字段时自动回退到“全部”，清空筛选时一并恢复默认值。

## 9. 错误处理

- 创建会话任务时目标会话不存在：拒绝创建并提示刷新会话。
- 执行前会话已删除：外键已删除任务；并发竞态中执行器再次验证并将 execution 标为失败。
- 执行前会话已归档：拒绝提交，保持任务为禁用状态。
- 表单非法：Prompt/名称为空、间隔小于 10 秒、单次时间不在未来、Cron 不能计算下一次时间时前后端均拒绝。
- 会话运行中跳过只推进任务的下一次时间，不创建新的 execution；一次性任务延后 60 秒重试；关闭报错后继续时，任务在错误事件到达时转为禁用，用户重新启用后恢复；会话状态读取失败时保持任务不投递并记录可重试错误。
- 归档恢复时某任务配置已失效：该任务保持禁用并记录错误，不阻塞其他任务恢复。

## 10. 测试与验收

- migration/仓储：默认全局作用域、两个保护开关默认开启、按会话过滤、会话删除级联、归档暂停标记。
- 调度服务：会话创建/列表、运行中/排队 turn 跳过、一次性任务延后、状态读取失败保护、错误事件即时暂停、错误后继续、启动跳过漏跑、单次漏跑禁用、归档与恢复、全局任务行为不变。
- 主进程执行器：会话任务调用 `submitTurn` 且不创建会话、不传运行时覆盖；全局任务仍创建会话。
- 协议：新增字段和过滤请求可通过 typed IPC 编译。
- UI：侧栏入口、顶栏入口、任务列表/表单交互、窄窗口布局。
- 回归：storage、agent-runtime、desktop 单测、类型检查、lint 与构建。

## 11. 非目标

- 不做云端常驻调度；应用关闭时不会执行任务。
- 不补跑离线期间的历史批次。
- 不支持跨会话改绑任务。
- 不给会话任务提供独立 Agent/模型/工作区选择。
- 不把会话任务加入全局任务 JSON 导入导出。

## 12. Agent 自主管理工具

会话级计划任务作为内置 `spark_platform` MCP 能力提供给当前会话的 Agent，工具集为：

- `session_schedule_list`：列出当前会话绑定的任务。
- `session_schedule_get`：读取当前会话内指定任务。
- `session_schedule_create`：创建绑定到当前会话的任务。
- `session_schedule_update`：修改任务的调度、Prompt 或启用状态。
- `session_schedule_delete`：删除当前会话内指定任务。

工具不接收也不信任模型提供的 `sessionId`。MCP 子进程从运行时环境取得当前会话 ID，Platform Bridge 与领域服务再次校验任务的 `scope=session` 且 `sessionId` 与当前会话一致；Agent 无法借助任务 ID 读取、修改或删除其他会话和全局任务。创建与更新参数在领域边界按严格 Schema 校验，并只映射允许 Agent 修改的字段。

Agent 创建的任务继续沿用既有会话任务语义：允许多个、触发时进入当前会话持久化队列、使用届时的会话配置、离线漏跑不补发、归档自动暂停、删除会话级联删除。CRUD 变更通过配置事件通知渲染进程刷新侧栏徽标与筛选状态。

系统提示词提供以下闭环教程：

1. 只有确实需要在未来恢复工作时才创建任务；创建前先 list，避免重复轮询器。
2. Prompt 必须自包含，写清检查目标、未完成时如何处理、完成判据和收尾动作。
3. 创建成功后可以结束当前 turn，让调度器按时把新 turn 排回本会话。
4. 每次唤醒消息都会包含任务 ID。结果未就绪时保留任务并结束；结果就绪、工作取消或任务失去价值时，调用 delete 清理任务，然后完成后续工作。
5. 周期任务不会因为某次成功自动消失；禁用也不等于删除。Agent 对自己为当前目标创建的任务做完成清理时无需再次询问用户。

调度器注入的 `[Scheduled Task Context]` 增加当前任务 ID，并明确提醒 Agent 在目标完成后删除该任务，保证 Agent 能在被唤醒的 turn 内精确收尾。
