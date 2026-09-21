# Spark Agent Changelog

所有重要变更均记录在此文件中。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

> 发布约定：如需提供面向用户的更新说明，可在升级 `apps/desktop/package.json` 时把变更从 `Unreleased` 移入精确的 `## [x.y.z] - YYYY-MM-DD` 条目。发布流水线允许版本没有对应条目。

## [Unreleased]

## [0.13.0] - 2026-09-22

### 新增

- **内置编辑器「在系统文件夹打开」**：文件树节点与空白区（工作区根）右键可直接在 Finder（macOS）/ 资源管理器（Windows）中打开目录，文件则在所在目录中选中；菜单文案随平台切换。工作区根未知（无法拼绝对路径）时该项自动隐藏，打开失败给出 toast 而非静默失败。
- **Git 变更文件行右键菜单**：变更文件行新增右键菜单——在编辑器中打开、添加到对话、复制路径、在系统文件夹中显示，并以分割线分隔 Git 操作（暂存 / 取消暂存 / 丢弃更改，丢弃仍走二次确认）；写操作进行中禁用相关项，已删除文件与 root 未知时不提供文件管理器入口。
- **会话标题原地改名**：单击会话头部标题即切为输入框并全选，回车或失焦保存、Esc 取消；空标题与未变更不落库，提交后二次失焦不会重复请求，窄头部下输入框自适应占满可用宽度。
- **快速创作独立窗口**：快速创作支持弹出独立窗口运行（入口用窗口图标标识）；窗口与主界面共用后台任务，切换视图后任务继续执行并正常回写状态与产物。
- **工作模式记忆各模式上次视图**：在「对话 / 开发」等模式间切换时回到该模式上次停留的视图，不再统一回落默认页。
- **模型选择与智能路由体验**：模型选择器可见性按引擎过滤，智能路由行接入悬浮配置卡片与专属路由图标；渠道管理页上下文窗口改为对数滑块，推理强度滑块补拖拽态并分离轨道与滑块结构。
- **空会话使用足迹热力图**：空会话统一展示使用足迹热力图，移除快捷卡片轮播（无用量时同样展示）。
- **工程手册站点与开源协作文件**：开发文档迁移为 `docs-site` 静态工程手册（架构 / 运维 / 404 页）并接入 GitHub Pages 自动发布（`deploy-pages` 工作流含静态资源校验），已归档的过期计划文档随之移除；补充 `CONTRIBUTING.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md` 与 Issue、PR 模板，README 增补手册与贡献入口。

### 修复

- 工作流首页头部允许换行，标题块不再被挤成竖排。
- 自动路由分流决策超时由 8s 提升至 30s、上限放宽到 120s，避免冷启动模型被误判为路由失败。
- 会话头部按钮按宽度三档渐进收起，统一面板图标改为 `PanelsTopLeft`。
- 文件树与 Git 面板的绝对路径拼接覆盖 Windows 反斜杠场景，root 未知时降级为不显示「在系统文件夹打开」。

### 改进

- **用户菜单重做**：抽离为独立组件与 `userMenuItems` 模块，统一主题 / 强调色切换、账号同步与更新状态行入口；图标按墨迹光学对齐（人像 / 星芒单独放大并等比收细描边），图标列 17px、首级行统一让出箭头槽位、分割线内缩到文字列，数值列与开关落到同一条右侧基线，数值与次要文字改用可读灰（浅色约 5:1 对比），同步 spinner 自带动画不再依赖别处工具类。
- 自动路由路由卡片选中态改为整卡填充 + 主色标题，去掉左侧竖线。
- 工作流缩放控件接入应用主题令牌，覆盖 React Flow 浅色默认值。

## [0.12.1] - 2026-09-22

### 新增

- **渠道管理显示自动路由卡片**：模型渠道管理页展示自动路由卡片，配置弹窗按内容自适应宽度，保存后自动关闭。

### 修复

- 自动路由配置弹窗 footer 按钮组补留白，避免按钮贴住分割线。

## [0.12.0] - 2026-09-22

### 新增

- **浏览器登录（账号 / 邮箱码 / 短信 / 微信全支持）**：登录页新增「使用浏览器登录」入口，拉起系统浏览器打开 edu-web 登录页，用户在网页端用任意方式登录后经 `spark-agent://auth-callback` 自动返回桌面端；采用 state + PKCE verifier 单次交换（凭证只走 HTTPS 交换，不进 URL / deep link），并以 2s 轮询兜底，即使 deep link 未拉起也能完成登录。既有表单登录保留，两者并存。
- **团队注册中心**：设置页可配置团队 Nacos（地址/命名空间/账号，密码入系统钥匙串，连接纯配置驱动、应用内零内嵌），未配置时团队功能整体降级不发请求。
- **五类资产团队共享**：技能、MCP、工作流、平台 Agent、子应用均可发布到团队注册中心并安装回本地——发布走原生资源与 AgentSpec 信封（服务端自动版本、防回退、公开范围、下载统计），安装支持六态比对与历史版本安装/回滚。
- **自包含捆绑（空机器可运行）**：工作流/Agent/子应用发布载荷内联全部运行依赖——引用技能的完整文件（二进制 base64 保真）、脱敏 MCP 配置、级联的平台 Agent；接收方零依赖安装即可运行，安装落草稿/停用态由使用者确认启用，不可移植项显式警告不静默。
- **团队商店**：侧边栏新入口聚合五类资产——搜索、分类页签带计数、状态筛选、更新横幅一键全更、详情抽屉（元数据/版本历史/逐版本安装）、上传共享面板（本地资产三页签一键发布，V2 多文件应用与归档应用禁发并说明原因）。
- **Claude/Codex SDK 升级与新能力接入**：Claude Agent SDK 0.3.263 → 0.3.278、Codex 0.153.4 → 0.155.1（MinIO 六平台 runtime 制品同步上架，老版本应用可在「设置 → 完整性」升级）。接入 Claude 结构化启动失败分诊（16 种原因映射稳定错误码 `CLAUDE_STARTUP_FAILED_*`）、worktree 会话 `projectConfigRoot`（hooks/permissions/.claude 配置树不随分支漂移）、权限审批高危标记（`defaultToNo` 审批卡默认聚焦拒绝、`suppressAlwaysAllowRule` 主进程收窄持久化选项）与 MCP 工具来源徽标（`source === 'sdk'` 可信标识，审批卡已展示）、上下文用量四分类（used/free/buffer/deferred 终态细分事件，渲染端快照可查）与 /usage 结构化用量事件（`session_usage_report`）；Codex 侧接入 thread attachments 会话级 KV 与账号速率限额查询两个载具级能力接口（`ThreadAttachmentsCapableExecutor` / `RateLimitsCapableExecutor`）、MCP `toolsError` 工具发现失败透传，并显式映射 `configuration_update` 条目。
- **spark-engine 引擎层对标能力**：新增结构化启动失败原因（`StartupFailureError` + 九值 reason，MCP 连接失败已接线）、会话级 KV 存储（`SessionKvStore`：set 幂等/list/remove，resume 后存活）、MCP 服务 `toolsError` 状态查询（工具发现失败降级不阻断会话）、权限规则列表 API（`listRules` 带来源与可编辑性）、Hooks 清单 API（`listHookEntries` 按 scope 展开）与上下文用量四分类事件（`context.usage_snapshot`）。

### 修复

- 团队注册中心 IPC 报错透传真实原因（原被掩码为「操作未完成」），技能目录被安全软件清空等场景给出可行动提示。
- `pnpm test:unit` 在 Windows 上可用（跨平台测试编排器，POSIX 行为不变）。
- **Spark CLI `/help`**：命令与快捷键改为按行列表输出（标签列统一对齐、命令/快捷键分区、自定义命令独立成段），不再挤成一段自动换行文本。

## [0.11.81] - 2026-09-22

### 新增

- **内容区 SVG 直接渲染**：`svg` 代码块升级为独立图形板块（与 mermaid / HTML 板块同构），默认直接画出图形，header 可切回源码。完整 SVG 文档交给 data URL + `<img>` 渲染（secure animated mode：脚本不执行、`<style>` 不污染宿主 DOM）；裸 `<svg>` 片段经 DOMPurify 净化后内联，并按 `getBBox()` 自动推导 viewBox，坐标原点不在 (0,0) 的图形也不会被裁掉。
- **SVG / XML 源码着色**：`svg / svgz / xsl / xslt / xsd / xhtml / rss / atom / plist / wsdl` 统一归一为 xml 高亮（着色判定与「是否图形语言」判定共用同一份归一表）；此前这些语言的代码块因 shiki 无对应语言而整段回落成无色纯文本。
- **画布模型选择弹层支持收藏置顶**：模型选项右侧图钉按钮（悬停浮现、置顶后常显主题色）可把常用模型置顶；置顶模型排所在渠道分组最前，含置顶模型的渠道在渠道列表中也排最前；点击置顶不改变当前选中、不关闭弹层，状态持久化到本机。
- **快速创作反推任务一键生图**：反推任务操作组新增「生图」，反推结果直接填充生图表单；任务产物图片支持右键「去图编辑」，图片进素材并切换到图像编辑模式。
- **工作流 Agent 基础设施桥接（E2-1）**：对称复刻画布 Agent 管道，为工作流编辑器内嵌 Agent 铺路——新增 `workflow:host-attach/detach/tool-result/tool-ack` 四通道与 `stream:workflow:tool-call` 推流事件、agent-runtime 的 `spark_workflow` 进程内 MCP server（含 JSON Schema → Zod 转换）、desktop 侧 WorkflowHostBridge（ACK 5s 宽限 + 执行 60s 超时）。面板 UI 在 E2-2。

### 修复

- **智能路由分流失败原因透出**：callDispatcher 失败时提取人话详情（HTTP 状态 + 业务 message，如「套餐未开放模型权限」），透出到降级 reason、WARN 日志与决策事件，提示条直接可见；reason 超长截断展示、tooltip 补完整原因。
- **智能路由确定性错误不再重试**：401 / 403 / 404 / 400 / 422 立即收口（不再每轮白付一次调用），429 视为可能瞬时限流保留一次重试。
- **分流器连通性可自测**：管理弹层新增「测试分流器」，对当前草稿（未保存亦可）发最小请求，配置期即暴露「无权限模型」，不再只在会话里表现为静默规则降级。
- **智能路由提示可见性**：上一轮或本轮任一轮处于降级即显示提示条，降级 → 恢复的轮次不再被防刷屏条件吞掉；轮次标识改为 `⚙●平衡 · 模型名` 形式，降级轮 title 注明兜底。
- **模型选择弹层智能路由行对齐**：去掉行首齿轮图标后与普通渠道行同几何对齐（图标贴左 24px 盒、文字 x=70 对齐、强度圆点贴右）。
- **`safe-file://` 补齐图片与文档 MIME**：补上 `.svg` 后 SVG 可被 `<img>` 直接渲染（Chromium 不会对 `application/octet-stream` 嗅探 SVG），同时补齐 `.bmp / .ico / .avif / .apng`、`.html / .htm`、`.xml`、`.txt / .log`、`.md / .markdown`、`.csv`。
- **`@spark/agent-runtime` 补齐 `AutoRouterService` 包入口导出**：此前遗漏会导致主进程 esbuild 构建失败、dev 无法启动。
- agent-runtime 去掉 AutoRouter 导出路径上一处多余的空值赋值（CI `no-useless-assignment` 报错根因，行为不变）。

## [0.11.63] - 2026-09-13

### 新增

- **Hooks V2 管理界面**：设置页 Hooks 区块升级为 Hooks V2 工作台，支持 Hook 定义增删改查、四作用域（应用/项目/Agent/会话）绑定与授权、运行记录查询、入参映射预览与测试运行；旧的通知开关配置保留只读入口。
- **Agent 专属 Hook 覆盖**：Agent 编辑页 Hook 区块改为绑定列表视图，展示来源与授权状态，替代旧的 hookConfig 开关表单；已配置过的旧配置启动时自动迁移为 V2 绑定。
- **会话级 Hook 查看**：会话配置面板新增 Hooks 区块，展示当前会话最终生效的 Hook 列表，并支持会话级临时停用继承的 Hook。
- **崩溃窗口事件补偿**：Hook 生命周期事件新增补偿扫描器，按轮次请求与最终回复消息等稳定事实源补发崩溃瞬间丢失的事件，事件 ID 确定性去重，未启用 Hook 时不产生任何写入。

### 修复

- **Hook 僵尸运行阻塞队列**：应用在租约窗口内重启后，遗留的运行租约由周期恢复回收，不再永久阻塞串行队列的后续领取；周期回收前先为本进程活跃运行续租，避免误回收正在执行的动作。
- **Hook 通知双发**：旧通知配置迁移到 Hooks V2 后，遗留触发路径对已接管节点（任务完成/失败/取消、用户提问）自动短路，权限审批仍走原路径不受影响。

### 改进

- **旧配置自动迁移**：启动时把旧的声音/系统通知配置幂等转换为 Hooks V2 内置定义与绑定，迁移在数据库事务中完成，失败自动回滚并保持旧配置生效。

## [0.11.62] - 2026-09-13

### 新增

- **远程图片双向传输**：Telegram、飞书与 QQ 支持将入站图片保存为会话附件供 Agent 识别，并把 `present_files` 提交的本地图片真实发送回当前远程渠道；QQ 群聊、单聊使用官方富媒体上传协议，频道使用原生图片消息。
- **远程会话隔离**：不同远程连接默认使用独立会话，避免 Telegram、飞书、QQ 共享历史时误判当前回复渠道；确需复用时可显式开启跨连接共享。

### 修复

- **QQ 图片假发送**：文件传输权限关闭时不再静默丢弃图片后仍显示“已发送”，Agent 与发送层都会明确提示尚未发送；权限开启后通过 `file_info` 富媒体消息完成真实投递。
- **Telegram 输出稳定性**：流式预览改为持久消息增量编辑，避免空白气泡、内容闪退或终态消失；图片引用与文件卡片统一去重，避免同图重复发送。
- **远程内置提示词泄漏**：会话列表、标题与消息气泡统一使用安全的用户展示文本，不再展示远程渠道注入的内部运行提示。
- **远程终态与定时任务投递**：补齐终态事件晚到或仅落历史记录时的远程回复恢复，定时任务等无人值守轮次也能发送到绑定渠道。

### 改进

- **Telegram Markdown 适配**：常用标题、强调、代码、链接与列表转换为 Telegram HTML，并在格式不兼容时自动回退为纯文本。
- **远程连接配置体验**：配置弹窗支持窄窗口，配对命令可一键复制；渠道、工作区、会话、模型、Agent、推理强度和权限模式切换后统一回显当前上下文。
- **QQ 长回复可读性**：按 UTF-8 字节限制并优先在段落、句子和短语边界分片，减少中文词语被硬切断。

## [0.11.61] - 2026-09-13

### 修复

- **Telegram 远程图片真实投递**：远程任务现在明确获得 Telegram 会话上下文；Agent 生成并呈现的截图、图片会从 `presented_files` 事件转发到 Telegram，不再只在桌面端显示文件卡片后误报“已发送”。

### 改进

- **Telegram 图片发送兜底**：照片模式被 Telegram 拒绝时自动改用文件模式；本地直传失败时继续使用 Spark 临时存储 URL 中转。

## [0.11.60] - 2026-09-13

### 改进

- **远程命令上下文回显**：切换会话、项目、渠道、模型、Agent、推理强度或权限模式后，统一回显当前工作区、会话、渠道与模型，便于从手机端立即确认后续消息的执行上下文。
- **远程模型列表准确性**：模型选择列表仅展示当前渠道已启用的有效模型，自动清理空值与重复项，并明确标记渠道默认模型。

## [0.11.59] - 2026-09-12

### 新增

- **会话临时挂载工作流（首期）**：无需修改 Agent 配置，会话可直接选择、切换、停用工作流——输入区新增工作流选择器，支持 `inherit`（继承 Agent）、`override`（会话覆盖）、`disabled`（停用）三种模式。绑定关系与绑定代次独立存储（新增 098 迁移），不改变工作流节点执行语义：已开始的 Run 始终按自身冻结图执行，失败续跑沿用创建时的绑定代次；会话创建前做挂载预检，绑定配置变更通过流事件实时同步到会话。

## [0.11.58] - 2026-09-12

### Bug 修复

- **定时唤醒轮文件摘要跨轮残留**：渲染端消息构建器的轮次文件变更 tracker 只在新建 assistant 消息时重置，`user_message` 与 `assistant_message` 内联新建两条路径不重置——唤醒轮开始后，上一轮的「本次编辑 N 个文件」会被挂到唤醒轮消息上。现 tracker 记录归属轮次，三条消息创建路径按 turnId 判定重置（乱序补投的同轮事件不误清），终态追加汇总前校验消息与 tracker 轮次一致，晚到终态不再把变更挂错轮次。
- **唤醒轮终态丢失后永挂「执行中」**：消息级 streaming 标签此前仅由 agent_status 终态事件收尾，无人值守时段终态事件丢失时永不收敛。现渲染端订阅主进程队列广播，本会话队列空闲时兜底收敛 streaming 消息与会话级运行态：水合窗口门控避免切会话瞬间误伤旧会话消息；队列因轮次失败暂停时按错误而非完成收敛；兜底生成的文件汇总与正常终态路径同样过滤嵌套 agent worktree 路径。

### 改进

- **唤醒轮时间线标识**：会话定时任务插入的轮次以「定时任务唤醒 · HH:mm」分割线与手动对话区隔，含展示正文的唤醒轮气泡上方渲染，历史回放同样生效。

## [0.11.57] - 2026-09-12

### Bug 修复

- **团队派发排队状态与超时对齐**：串行派发（`parallel !== true`）入队时持久化为 `pending`，真正出队执行才迁移为 `working`，超时计时器与状态起点严格对齐；此前排队中的任务在库里被读成长时间 `working`，看起来像超时而实际仍在排队。
- **嵌套派发串行死锁**：团队成员在自己轮次内再调用 `agent_dispatch` 时共用同 turn 串行队列，而发起者自身正占着队列槽位，形成「等自己结束」的死锁并空转到外层超时；嵌套派发（`currentDepth > 0`）现强制绕过串行队列，Host 侧单发串行语义不变。
- **同步咨询剩余时间不足时的收尾**：peer call 剩余截止时间不足的提前返回分支，就地收尾派发行（置 `failed`）、清理 controller 注册与 abort 监听，不再遗留永久停留在创建态的僵尸记录。
- **团队配置 round-trip 丢字段**：`team:list-members` 回显配置时按已知字段重建，`dispatchTimeoutMs`、`threadContextTokenBudget` 不在清单内；且 IPC 请求方向的 zod `TeamModeConfigSchema` 未注册 `dispatchTimeoutMs`（strip 模式会剥掉未知字段），而会话提交回写 `metadata.team` 是整体替换语义——会话级超时配置会被静默冲掉。现 schema 补齐字段、回显透传，round-trip 闭环。
- **主进程 EIO 日志风暴**：macOS 终端关闭后 stdout/stderr 管道断开表现为 `EIO`，输出流守卫此前只吞 `EPIPE`；EIO 升级为 uncaughtException 后，兜底日志再写 console 触发递归 `write EIO`，可短时间内刷穿全部轮转日志。守卫现同时吞掉 `EIO`，其他流错误仍重新抛出保留诊断。

## [0.11.53] - 2026-09-10

### 改进

- **模型流式容错**：重试判定改为按副作用分级——只有收到 `usage`、`continuation`、`done` 等不可见事件时允许安全重放；已输出正文、思考内容或工具调用后不再整段重放，避免重复回答与重复执行工具。失败尝试的记账事件按次暂存，请求中断即丢弃，不再污染下一次尝试。
- **错误分类与重连可见**：区分瞬时与永久错误，仅限流、过载、服务端故障与桥接断流参与重试；参数、认证、权限、计费、内容过滤与上下文超限立即失败。新增结构化重连事件，TUI 与终端显示重连次数、等待时间与失败原因，普通终端写入 stderr 不污染正文，`--stream-json` 原样输出。
- **错误可观测性**：错误详情统一收敛为白名单字段、长度限制、控制字符清理与凭据脱敏，同时保留 `ECONNRESET` 等底层错误码、嵌套 cause 与上游 request-id；失败行直接展示真实根因，并按错误类型给出针对性恢复建议。
- **可配置退避策略**：`[agent]` 新增 `retry_initial_delay_ms`、`retry_max_delay_ms`、`retry_jitter_ratio`，抖动后不突破硬上限；上游 `Retry-After` 超过本地上限时明确报错，不再截短后快速连打。
- **CLI 桥接断流处理**：上游断流不再直接销毁下游连接，改为按 Anthropic/OpenAI 协议返回结构化错误；只转发完整 SSE 帧，半截事件丢弃后单独补发 error 帧，避免两个事件被拼接成坏帧；连接建立前失败返回 `502` 与 `bridge_transport_error`，保留嵌套系统错误与请求 ID。

### Bug 修复

- **命令清理竞态**：命令输出超限后的异步进程组清理，不再因短命 detached 进程已被回收或 pid 复用导致的 `EPERM` 逃逸为未处理异常；其他错误码仍照旧上报，不掩盖真实失败。

---

## [0.11.52] - 2026-09-10

### 新功能

- **任务内受管命令**：工作区 `bash` 支持 `yield_ms` 启动 turn-owned 受管命令并返回进程 ID；新增 `process_wait` / `process_cancel` 分页读取输出、继续等待与按进程组取消；轮次终态断言受管命令已观察完毕，未读结果不允许正常收尾。保留原有不带 `yield_ms` 的前台 bash 行为，Windows 仅开放前台路径。
- **可选能力中心手动入口**：设置页可选功能卡片新增「选择并安装可选功能」入口，可随时手动打开完整安装中心，不再局限于启动提示弹窗。

### 改进

- **会话侧面板视觉规范**：配置面板与会话检查器统一 `SessionPanelDesign` 样式；环境变量保留键名/值/说明的常显标签并支持折叠保留草稿，删除固定在变量右上方，复制、导入与保存集中收口。
- **会话产物与内容展示**：多图产物改为画廊式网格并标注文件名；文档输出卡片改为自适应网格布局；HTML 全屏面板填满可用视口、全屏入口加大；HTML 渲染高度上限提升至 800px。
- **TUI 执行反馈**：受管命令运行状态展示、中断清理与运行期排队提示、异步异常可视化、历史输入回取修复。

### 安全

- **定时任务标题提取**：标题来源仅使用定时任务持久化的安全展示正文，不再把内部 prompt 或调度上下文发送给标题模型。

---

## [0.11.47] - 2026-09-08

### 新功能

- **子应用 V2 多文件应用包**：新增受管项目脚手架、文件编辑、内容寻址制品、完整性复验、多文件资源加载、整体发布与回滚；原有 V1 单 HTML 应用保持兼容。
- **受管接口请求**：子应用可绑定 API Connection 或 Provider，由宿主注入凭据并统一处理 CORS、origin 权限、SSRF、私网双重授权、重定向、超时和响应容量。
- **受管后台服务**：V2 应用可携带预构建 Node.js service，支持 on-demand/application 生命周期、RPC、事件、健康预检、崩溃退避、有界日志和手动重启。
- **持久后台任务**：新增 jobId、状态、进度、checkpoint、取消、结果和 release pinning，页面关闭后任务可继续执行，宿主重启后使用明确的中断/恢复语义。
- **Agent 子应用开发闭环**：新增按需开发手册、V2 脚手架、受管项目导入导出、V1 迁移报告、静态校验、联合诊断、服务与任务运维工具。

### 改进

- **子应用可观测性**：应用运行时会上报 ready、JavaScript、Promise、资源加载错误与 Bridge 审计；管理页新增扁平的项目、连接、后台、任务和诊断分段。
- **发布与信任边界**：候选 service 健康后才切换 release；V2 每次发布后保持禁用，需向用户展示 trusted-local 与 OS effects 后显式重新启用。
- **开发契约同步**：精简创建/更新工具的重复描述，将 SDK 状态、限制、错误与示例统一收口到可查询契约。

### 安全

- **V2 能力隔离**：V2 禁止 legacy raw IPC 和尚未实现的保留能力；凭据不返回 iframe、service 环境、日志或诊断结果。
- **包与网络边界加固**：拦截路径逃逸、符号链接、超大文件/包/任务数据、非授权重定向和未声明私网访问，并在运行前复验制品 SHA-256。

---

## [0.11.46] - 2026-09-07

### 新功能

- **子应用分享包导入导出**：支持将子应用及其文件空间导出为 `.sparkapp` 包，预览能力、冲突信息和覆盖/新建导入模式均可在设置中操作。
- **工作流包隔离导入导出**：支持在隔离空间中导出、导入工作流包，自动校验工作流依赖、文件完整性和技能内容，并对敏感配置进行脱敏。

### 改进

- **联网查询可靠性**：内置 `spark_search` 的 `web_search`、`fetch_url` 支持有界重试、总时间预算、响应体超时取消和搜索后端降级；错误分类会隐藏查询参数、响应正文和 API Key。
- **发布说明同步**：发布流程会把当前版本的更新说明同步到 GitHub Release、官网版本中心和应用内更新页。

### Bug 修复

- **子应用导入安全性**：修复导入失败残留、文件数量限制、过期导入令牌和覆盖导入数据丢失风险。
- **工作流包完整性**：修复无效包结构、循环依赖、技能目录校验、MCP 配置脱敏及导入失败回滚问题。
- **Linux 安装包匹配**：修复发布流程无法识别 `.AppImage` 安装包的问题。

---

## [0.7.5] - 2026-07-23

### Bug 修复

- **Windows Claude/Codex 对话启动失败**：统一媒体 MCP 不再把完整 Provider 路由和模型 Manifest 写入子进程环境变量，避免超过 Windows `CreateProcess` 限制后导致 Claude SDK 与 Codex SDK 同时报 `spawn ENAMETOOLONG`。
- **媒体凭据不落盘**：大体积路由/Manifest 改为通过用户私有临时文件传递，API Key 仍仅通过短环境变量注入 MCP 子进程；保留旧单 Provider 环境变量协议兼容。

## [Unreleased] - Skill 商店开发中

### 联网查询可靠性（2026-09-07）

- **有界恢复与降级**：内置 `spark_search` 的 `web_search`、`fetch_url` 现在会对网络中断、请求超时、429 和 5xx 进行有界重试（默认一次，最多三次）；429 会在 2 秒上限内尊重 `Retry-After`，401/403/404 等确定性 4xx 不重试。
- **全链路时间预算**：搜索后端降级和网页抓取均采用总时限（默认 20 秒）与单次请求上限（默认 15 秒），避免 Bing、DuckDuckGo、百度分别完整等待导致长尾堆叠。
- **可诊断且不泄密的错误**：错误输出标记 timeout、network、rate_limited、server_error、http_4xx、invalid_response 或 budget_exhausted，同时隐藏 URL 查询参数、响应正文和 API Key。

### 行为调整 — MCP 全局可用（2026-07-16）

- **无需逐 Agent 绑定**：应用中所有已启用 MCP 默认挂载到单 Agent、团队 Host、团队 Member 和工作流节点；旧版 `mcpServerIds` 字段仅保留数据/API 兼容。
- **界面与提示同步**：移除 Agent/工作流的 MCP 选择器和“请先绑定 MCP”运行时提示，统一展示全局启用状态；停用与 OAuth 授权校验仍然生效。
- **前端配置收口**：Agent 创建、编辑、复制和导入不再写入 `mcpServerIds`；旧导出文件中的该字段会被忽略。
- **团队模型可见性**：团队模式顶部状态条和成员 Inspector 展示实际生效的模型/适配器；Agent 自有配置优先，未配置模型时沿用切换前会话模型。

### 新功能 — 团队模式 A2A 深度协作升级（2026-07-04）

- **codex 团队协作可用**：团队工具改为支持 codex 侧可见的桥接注入路径，codex Host / Member 可参与团队调度，不再被 in-process MCP server 卡死。
- **共享讨论线程**：团队讨论新增持久化 thread / round 状态，成员被再次派发时会看到 `[Discussion So Far]`，并按 discussion scope 复用安全可续的 SDK session。
- **peer messaging**：新增 `agent_message`，支持广播异步留言与定向 `@` 单次触发；事件流新增成员间消息、轮次推进、讨论收尾三类时间线块。
- **显式轮次控制**：新增 `team_round_advance` / `team_conclude`，前端支持轮次分割线与讨论状态卡片，团队讨论不再依赖 prompt 里的“自己收敛”暗规则。
- **团队配置扩展**：长期团队定义、IPC 协议、Inspector/TeamsPanel 已支持 `maxDiscussionRounds` 与实验性 `enablePeerMessaging`。
- **安全兜底收口**：成员 prompt 只描述真实可用的 peer messaging 能力；后端新增 self-`@` / 同轮 A↔B 即时互 `@` 拦截，并把 discussion 消息上限改为基于持久化线程计数的硬限制。
- **成员自由交流 v2**：成员 prompt 新增四模式协作手册；`agent_message` 支持 `mode: 'call' | 'note'`，定向 note 只写共享线程并在目标成员 prompt 标注 `[NOTE FOR YOU]`；同步咨询新增 deadline 传递、3 层深度上限和独立 peer call 预算；成员间气泡显示发送方、接收方与留言标识。

### UI 统一 — 全量下拉弹窗迁移到 Arco Design（2026-06-05）

- **`SparkSelect` 重写**：去掉 `bordered={false}` + 重画外观的做法，改为直接复用 Arco `Select` 自带的下拉弹窗，CSS 只做轻量主题贴合（颜色/圆角/边框/箭头），视觉与 Arco 默认一致。
- **修复无效选择器**：`styles.css` 中 `.arco-select-view-icon` 实际在 Arco v2.66 已重命名为 `.arco-select-arrow-icon`，旧规则 0 命中；改用真实类名覆盖箭头 / 后缀图标。
- **清理原生 `<select>`**：`TeamInspectorSection.tsx` 「最大深度」原本是裸 `<select>`，已替换为 `SparkSelect`；同步更新 `views.css` 里的 `.team-roster-advanced-row select` 规则以适配新结构。
- **规则写入**：`AGENTS.md` 新增「Arco Design 优先」强制规则，明确禁止原生 `<select>`、自写 popup、自写表单拼接；所有下拉必须走 `SparkSelect`。

### 新功能 — 团队模式（Team Agent Mode / A2A，2026-06-05）

- **团队模式**: 底部 Agent 选择器新增「团队模式」，主持 Agent(Host) 可在对话中通过 `agent_team_dispatch` 工具动态调用被授权的成员 Agent(Member)，以类 IM 群聊形式展示多 Agent 协作。仅在显式启用时进入新分支，旧 Session 行为零回归。
- **A2A 运行时**: 新增 `TeamDispatchService` 与同进程 `spark_team` MCP server；成员以自身 provider/model/skills/MCP 运行 one-shot turn，流式输出 rebrand 为 `team_member_message`；支持成员级 MCP 工具、嵌套调用（`allowNesting` + `maxDepth`，最大 3）、单 turn dispatch 预算（5）、超时（默认 120s）与取消传播。
- **群聊式 UI**: ChatView 时间线新增 `TeamDispatchCard`（调用卡片）与 `TeamMemberBubble`（缩进 + 成员配色气泡）；Inspector 新增「团队成员」区块（成员勾选/邀请/嵌套设置/成员详情展开）；点击成员头像滑出 `TeamMemberDrawer` 详情抽屉。
- **协议与存储**: 新增 4 个团队事件、`TeamModeConfig`/`TeamMemberCard`/`TeamA2ATask`/`TeamA2AReply` 类型、`team:update`/`team:list-members`/`team:list-dispatches` 三个 IPC 通道；migration 016 新增 `team_dispatches` 表；会话级配置写入 `sessions.metadata.team`。
- **测试**: `TeamDispatchService` 边界（6）、`buildTeamRosterPrompt`（2）、event-mapper 团队事件归约（4）单元测试。

### Bug 修复

- **画布产物偶发消失与任务状态回退**：修复 Provider 晚完成产物挂回失败节点后，清空失败任务会删除唯一运行索引，导致图片/视频等文件仍在但操作节点预览消失的问题。已有产物的失败任务会恢复为完成；历史缺失任务记录可从 `generated` 连线和资产恢复预览；完成任务不再被晚到失败事件覆盖。
- **应用退出时关闭内置浏览器窗口**: 修复 `PopOutBrowserService` 的 hide-on-close 处理器在退出时阻止窗口销毁导致 Electron 进程无法退出的问题。同步加固 `BrowserAutomationViewService` 的同名处理器，在 `app` 处于退出流程时允许窗口正常关闭（双重保险）。

### 已完成 — 第一阶段核心骨架（2026-05-27）

- **Skill 商店页面（SkillStoreView）**: 商店/已安装双 Tab，市场源选择器，300ms 防抖搜索，分类导航
- **Skill 详情面板**: 右侧滑出详情面板，展示名称/版本/描述/评分/来源/标签，安装/卸载按钮
- **Adapter 架构**: SkillRegistryAdapter 统一接口 + MockSkillRegistryAdapter（12 个 Mock Skill）
- **SkillRegistryService**: 跨市场聚合搜索，安装/卸载，市场源 CRUD，预置 4 个市场源
- **数据库**: migration 008 — skill_registries 表 + skills 表 9 个扩展字段
- **Protocol**: RemoteSkillItem、SkillRegistry 等 11 个新类型 + 11 个新 IPC 通道
- **Bug 修复**: Icons.tsx 新增 Package/ArrowLeft/ExternalLink 图标，安装状态刷新机制

### 进行中 — 第二阶段市场接入（2026-05-27）

- **SkillsMP Adapter（T-04）**: 295 行完整代码已编写（`skillsmp-adapter.ts`），对接 skillsmp.com 公开 API
  - 搜索/推荐/分类/Manifest 获取/健康检查全部实现
  - 支持 API Key 认证（匿名 50 次/天，认证 500 次/天）
  - GitHub URL 智能分类推断 + 关键词标签推断
  - 15s 请求超时 + 429 速率限制处理
  - **待完成**: 接入 `createAdapter` 路由分发，替换 Mock Adapter

### 计划中 — 第二/三阶段（续）

- **市场接入**: SkillsMP、MCP Market、扣子 Coze、Claude Skills 真实 API Adapter
- **Skill 包导入/导出**: 支持 ZIP 格式的 Skill 包导入和导出
- **Skill 管理智能体**: 通过自然语言对话完成 Skill 搜索、安装、删除等操作

**PRD 文档**: `docs/prd/PRD-Skill-Store.md`

---

## [0.1.0] - 2026-05-26

### 初始发布版本 — 本地优先 AI Agent 桌面工作台

#### 核心能力

- **AI 对话**：支持 Anthropic (Claude) 和 OpenAI (GPT-4/o1/o3) 真实流式调用，双模型内核
- **文件操作**：Agent 可读取/写入/列出/搜索工作区文件（带路径穿越保护）
- **权限审批**：完整的工具调用审批流程 — AgentLoop → IPC → PermissionModal → 用户决策 → 执行/拒绝
- **会话管理**：创建/搜索/历史回放/归档/重命名/置顶/删除，支持多轮对话上下文累积
- **工作区管理**：打开项目/文件树浏览/项目类型自动检测（11 种语言）
- **Provider 管理**：CRUD + 健康检查 + API 密钥安全存储（macOS Keychain / Windows Credential Manager）
- **设置管理**：Provider/Model/Rules/Permissions/MCP/Skills 7 个 Tab 完整可用

#### UI 优化第一批 (2026-05-26)

##### Fixed

- **用户消息不显示 Bug**（P0）：修复 `AgentLoop.executeTurn` 未发出 `user_message` 事件的问题。用户发送的消息现在在聊天界面正确显示（头像 "U" + 标签 "你" + 消息内容），包括实时发送和历史消息加载场景。（浩轩-特级开发）

##### Changed

- **会话卡片紧凑化**（P1）：ChatListItem 从三行布局改为 Codex 风格单行紧凑样式。移除消息条数显示，running 状态仅保留小圆点动画指示器，idle 状态无额外徽标。（旭阳-高级开发）
- **输入区域悬浮化**（P1）：Composer 从固定底部分隔线布局改为 Claude Desktop 风格的悬浮卡片。移除 border-top 分隔线，添加 box-shadow 悬浮效果和渐变遮罩。（旭阳-高级开发 + 普通开发-小林）

##### Known Issues

- compact 模式下 `.item-menu-wrap` 未默认隐藏，浪费约 22px 水平空间（P3 低）
- 空状态页面因 `padding-bottom: 180px` 导致垂直偏移（P3 低）
- `padding-bottom: 180px` 硬编码，textarea 自动增高时内容可能被遮挡（P2 中）

#### 技术架构

- **桌面框架**：Electron + TypeScript + React + Vite
- **前端样式**：CSS 变量 Design Tokens 系统（130+ 变量）+ 9 个 ui-kit 组件
- **后端运行时**：AgentLoop + ToolRegistry + AdapterFactory + SessionService
- **数据存储**：SQLite WAL + 10 个数据库表 + 自动迁移
- **IPC 通信**：Typed IPC（zod 校验）+ 15+ IPC 通道 + 流式事件推送
- **测试**：agent-runtime 93 单元测试 + desktop 11 单元测试 + storage 21 单元测试 + E2E smoke test

#### 团队贡献

| 成员          | 贡献                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| 子涵-架构师   | 项目基础架构、Monorepo 初始化、Protocol 设计                                                         |
| 浩轩-特级开发 | Sidebar 折叠、HomeView 空状态、WorkflowView DAG 精修、ChatView 精修、user_message Bug 修复、代码审查 |
| 旭阳-高级开发 | SQLite Storage、Typed IPC、ChatListItem 紧凑化、Composer 悬浮化                                      |
| 普通开发-小林 | Design Tokens、ESLint/Vitest/Playwright 配置、HomeView、Settings 页面、Composer 悬浮化优化           |
| codex/claude  | Provider/Session/Workspace 全栈、AgentLoop 核心、Adapter 工厂、MCP/Skills/Permission 全栈            |
| Agent产品经理 | 需求分析、PRD 编写、迭代管理、测试协调                                                               |
| Agent测试     | 静态代码分析测试、数据链路验证、验收标准检查                                                         |

#### 已知差距（下一版本规划）

- Agent 无法执行 shell 命令（无 bash/grep/git 工具）
- MCP 服务器配置可管理但无法实际启动和通信
- 规则直接拼入 prompt，无层级合成和冲突检测
- 无 token/成本用量统计
- CommandPalette 为空壳，无命令注册/解析/执行
- Settings 6 个 Tab（General/Shortcuts/Telemetry/Updates/ProfileEditModal）仅为装饰
- Claude Agent SDK 和 Codex SDK 未集成
