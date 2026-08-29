# SparkWork 账号手动同步功能实施计划

> 状态: 已落地 | 最后核对: 2026-08-30

## 1. 结论

新增一套按 SparkWork 登录账号隔离、默认关闭、仅由用户手动触发的双向同步能力。桌面端负责从本地 SQLite/记忆文件中提取明确白名单字段，后端 `edu-server` 负责账号隔离、二次校验、合并、加密存储和同步记录。Provider、模型、MCP 凭据、Hooks、环境变量、令牌、密码、API Key、本机绝对路径等不进入同步载荷。

该功能不挂接登录、启动、退出、定时器或后台轮询事件。用户只有在设置页显式开启总开关、选择至少一个类别并点击“立即同步”时，才会产生网络请求和本地数据变更。

整体风险评级为 **HIGH**：改动跨 Spark-Agent renderer/main/protocol/storage/agent-runtime 与 edu-server controller/service/entity/migration，且涉及账号数据、跨设备覆盖与记忆文件。实现必须使用隔离 worktree，按后端契约、桌面同步核心、UI 三阶段推进。

## 2. 目标与验收边界

### 2.1 目标

1. 同步总开关默认关闭，并且每个登录账号在每台设备上独立保存选择；换账号后不得继承上一账号的开启状态。
2. 各同步类别独立选择，初始全部未选，避免一次开启后默认上传全部内容。
3. 同步只能由设置页的“立即同步”按钮触发，不因登录、启动、数据变化、定时任务或应用恢复而自动触发。
4. 同步数据按 JWT 中的 `userId` 隔离；客户端提交的 userId 不作为授权依据。
5. 支持自定义命令、各级提示词、记忆、助手与团队（含头像）、工作流、外观设置、无限画布提示词库（含封面快照）。
6. 助手同步不携带模型、Provider/渠道、运行引擎、推理强度、MCP 绑定、Hooks 或凭据。
7. 客户端使用字段白名单组装载荷，服务端重复执行 schema、禁用字段和高风险秘密模式校验。
8. 展示每次手动同步的时间、设备匿名标识、类别、状态、上传/下载/冲突/跳过数量和错误摘要；记录中不保存原始内容。
9. 同步过程中任何类别失败时，不阻断未受影响类别；最终状态明确显示“部分完成”，并可再次手动同步收敛。

### 2.2 非目标

- 不同步会话、聊天记录、项目目录、画布、附件或多媒体产物。
- 不同步 Skills/MCP/Providers/Models/Connectors/环境变量/权限凭据本体。
- 不提供实时同步、后台同步、定时同步、启动同步或退出同步。
- 不把本机主机名、用户名、磁盘路径或硬件序列号作为设备名称上传。
- 不承诺自由文本中所有语义层面的隐私内容都能被自动识别；产品文案必须明确：所选提示词、命令和记忆正文会同步，密钥/令牌等高风险内容会被扫描并跳过。

## 3. 已确认现状

### 3.1 Spark-Agent

- 登录链路已有 `AuthService`、`EduServerClient`、Keychain token 存储和 401 refresh，可直接复用认证 HTTP 客户端。
- 设置持久化已有 `app_settings(category, key, value, updated_at)`，适合保存按账号区分的同步偏好、设备匿名 ID 和每类同步基线，无需新建本地表。
- 自定义命令位于 `app_settings/custom-commands/items`，条目自带稳定 id 和 `updatedAt`。
- 提示词存在两套来源：`rules` 的 system/team/user/project/session 层，以及 `runtime.prompts` 的 system/agent/project/session 层。
- 助手、长期团队、工作流分别已有 Repository 和 IPC CRUD；助手配置中同时包含模型/Provider/MCP/Hook 等必须排除的字段。
- 记忆正文存放在 markdown 文件，SQLite 只存索引；同步适配器必须通过 `MemoryStoreService` 读写正文，不得上传 `file_path`。
- 外观最终汇总在 `app_settings/appearance/data`，renderer 同时维护 localStorage；远端应用后必须走统一外观应用入口，不能只改 SQLite。
- `SettingsView.tsx` 当前 5945 行，超过项目 3000 行门禁。同步页必须新增独立模块，只允许在主文件增加 import、导航项和 Section 映射。

### 3.2 edu-server

- 已有 JWT middleware 和 `@AuthRequired()`，业务可从 `ctx.state.user.sub` 获取可信 userId。
- TypeORM `synchronize` 已关闭，新增表必须提供显式 MySQL migration，并注册 entity。
- 已有标准 `{ code, message, data }` 返回格式和分页模式。
- `DB_ENCRYPT_KEY` 及 AES-256-GCM 实现基础已存在；同步正文应在校验后加密落库，history 只存统计元数据。

### 3.3 当前工作树约束

- Spark-Agent 主工作树存在并行改动，且 `SettingsView.tsx` 正被其他任务修改。
- edu-server 主工作树的上传/存储文件也存在并行改动。
- 实施时不得 stash、覆盖或混合暂存现有改动；两个仓库分别创建隔离 worktree/分支，并在切换时更新会话 worktree 状态。

GitNexus MCP 当前未挂载。影响分析已按项目降级规则使用源码、Repository/IPC 调用点和 Git diff 完成；实现后使用定向测试与 `git diff` 核对变更。若 CLI 索引可用，交付前分别执行 `npx gitnexus analyze` 更新两仓库记录。

## 4. 同步类别与字段白名单

| 类别       | 同步内容                                                                                                                                                                           | 明确排除                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 自定义命令 | id、name、description、prompt、script、scriptLanguage、enabled、updatedAt                                                                                                          | 命中秘密/本机路径扫描的整条命令                                                                                                |
| 各级提示词 | 用户可编辑 rules；runtime system/project/session prompt；内置 system rule 的启用覆盖                                                                                               | 内置 system rule 正文；runtime env；助手 prompt 的重复副本                                                                     |
| 记忆       | id、scope、opaque scopeRef、type、name、description、body、confidence、有效/归档关系和时间                                                                                         | filePath、sourceSessionId、hitCount、lastHitAt、向量、FTS、实体索引                                                            |
| 助手与团队 | 名称、描述、启用/默认、prompt、permissionMode、安全的 skill/rule/workflow 引用、metadata.avatar 头像；团队拓扑、prompt 和讨论参数                                                  | providerProfileId、modelId、agentAdapter、reasoningEffort、mcpServerIds、hookConfig、任意凭据；metadata 中 avatar 以外的任何键 |
| 工作流     | id、scope、name、version、description、status、tags、enabled、typed graph                                                                                                          | Provider/模型/密钥/header/env/本机路径字段；命中时跳过整条工作流，不做破坏性裁剪                                               |
| 外观       | theme、emptyHeroTheme、primary、density、font、fontSize、uiZoom、codeLigature、windowCorners、backdropBlur、autoCollapseTools、inlineTokenCount、syntaxHighlight、timestampFormat  | 导航状态、当前页面、侧栏展开状态、本机字体文件和其他会话态 UI 字段                                                             |
| 提示词库   | 全局设置与所有画布项目（含软删除项目）最新 snapshot 中的提示词；同步 id、title、text、category、tags、coverUrl（图片快照或远程 http(s) 原样）、coverMimeType、createdAt、updatedAt | usageCount（本地保留不参与合并）、本地文件路径；封面读取/压缩失败时 coverUrl 置空、文字仍同步                                  |

补充规则：

- 助手 prompt 以 assistants 类别为权威；不再从 `runtime.prompts/agent:*` 重复打包。
- 项目/会话级提示词与记忆只同步 opaque scopeRef，不同步项目名、目录和会话正文。目标设备没有对应 scope 时数据保持可管理但不自动激活。
- Skills 只同步标识引用，不同步 Skill 文件；目标设备未安装时保持引用但不生效，并在同步结果中计为“缺少本地依赖”。
- 团队在助手应用完成后处理；关键成员不存在时不创建无效团队，记录为跳过并给出原因码。
- 字体在目标设备不可用时保留用户选择，由现有外观回退逻辑显示可用字体，不下载字体文件。
- 助手/团队头像只同步 `metadata.avatar` 键，builtin/dicebear/url/upload 四种形态均允许；upload 形态必须是 `data:image/` 前缀且 ≤240KB，超限条目整条跳过。应用时与本机既有 metadata 键合并（整体替换会丢本机键）。
- 提示词库封面同步策略：本地文件经 sharp 压缩为 dataUrl 快照（最长边 512px、质量 80→60→40 递减、≤240KB base64）；远程 http(s) URL 原样保留；读取/压缩失败时封面置空、文字仍同步。`data:image/` 前缀的图片正文豁免文本秘密扫描（base64 常含疑似密钥/路径子串），非图片 data URL 不豁免。
- 提示词库全量口径：全局设置条目优先，再汇总所有画布项目（含软删除项目）通过 `canvasApi.openSnapshot` 读取的最新 snapshot（包括未落 SQLite 的画布热状态）中 `kind=prompt_library` 的资产；删除项目不等于删除其中的提示词资产。项目条目使用 `legacy:<projectId>:<assetId>` 稳定 ID，并兼容旧版 `legacy:<assetId>` 去重。渲染端快照不可用时，主进程按项目目录 `snapshots/latest.json` 优先、SQLite 快照回退；缺少时间字段的旧资产使用固定 epoch，避免每次同步产生伪冲突。
- 渲染端只向同步 IPC 投影提示词白名单字段，不传完整画布 snapshot；项目提示词单次最多 2000 条、投影字段合计最多 6000 万字符，渲染端预检与主进程协议校验使用同一上限。

## 5. 敏感信息防线

同步采用“白名单序列化 + 双端校验 + 加密落库”，而不是从本地表全量导出后删除字段。

### 5.1 客户端

1. 每个类别有独立 serializer，输出固定 contract；禁止通用 `getAll()` 直接上传。
2. 递归拒绝高风险字段名：`apiKey`、`token`、`password`、`secret`、`credential`、`authorization`、`cookie`、`headers`、`env`、`keystoreRef` 及同义写法。
3. 自由文本检测 PEM 私钥、Bearer/JWT、常见云厂商/API token、带凭据 URL 和明显本机绝对路径模式。
4. 自由文本命中时跳过整个条目，不做部分替换；UI 只显示条目名称和 reason code，不回显命中片段。
5. 生产环境同步 API 只允许 HTTPS；开发环境仅放行 loopback HTTP。
6. 请求日志只记录 operationId、类别、数量、字节数和结果码。

### 5.2 服务端

1. 逐类别 DTO/schema 校验、字符串长度/条目数/总载荷上限和禁止字段递归扫描。
2. 重复执行高风险秘密模式扫描；任一非法条目拒绝或按 contract 标记跳过，不写入 snapshot。
3. payload 通过校验后用 `DB_ENCRYPT_KEY` 派生的 AES-256-GCM 密钥加密；数据库不保存明文 JSON。
4. 同步记录只保存计数、类别、稳定错误码和匿名设备标识，不保存 payload、摘要文本或被跳过内容。
5. 所有查询和更新都附带 JWT userId 条件，禁止通过 operationId/category 越权读取其他账号数据。

### 5.3 设置页固定文案

页面首屏必须直接展示：

- “同步默认关闭，只有点击‘立即同步’时才会运行；不会后台或自动同步。”
- “API Key、密码、令牌、渠道、模型、MCP 凭据、环境变量和本机路径不会上传。”
- “你勾选的提示词、命令、记忆正文和工作流内容会保存到账号云端；疑似包含密钥的条目会被跳过。”

## 6. 同步协议与合并逻辑

### 6.1 本地账号状态

使用 `app_settings` 保存：

- `account-sync.preferences / user:<userId>`：`enabled=false`、七类选择均为 false、最近一次结果。
- `account-sync.state / <userId>:<category>`：服务端 revision、上次同步 item hash、schemaVersion。
- `account-sync.device / installation`：一次生成的随机 UUID；展示标签由 platform + UUID 后四位组成，不读取主机名或用户名。

登出只停止访问，不删除另一个账号的本地偏好；登录新账号读取该账号自己的默认关闭状态。登录 hook 不调用同步服务。

### 6.2 服务端存储

新增两张表：

1. `desktop_sync_snapshots`
   - `user_id + category` 唯一；
   - `revision`、`schema_version`、`payload_ciphertext`、`payload_hash`、`item_count`、`updated_at`；
   - payload 由 record 与 tombstone 组成。
2. `desktop_sync_records`
   - `id`、`operation_id`、`user_id`、匿名 `device_id`/`device_label`；
   - 状态、类别、上传/下载/冲突/跳过统计、稳定错误码、耗时、created/finished time；
   - `operation_id + user_id` 唯一，支持同一次手动操作幂等。

### 6.3 API

- `POST /api/v1/desktop-sync/execute`：一次手动双向同步。请求携带 operationId、设备匿名信息、已选类别、本地 records、baseRevision 和 baseHashes。服务端校验、三方合并、事务提交 cloud snapshot，返回每类 canonical records/revision/stats。请求体可选携带 `conflictChoices`（`category/itemId` → `local|cloud`），冲突条目按用户选择决胜，未指定的仍按更新时间。
- `POST /api/v1/desktop-sync/execute`（`mode: 'preview'`）：只执行三方合并计算并返回冲突明细，不落库、不产生历史记录；预览请求携带 conflictChoices 会被拒绝（`SYNC_INVALID_CONFLICT_CHOICES`）。
- `POST /api/v1/desktop-sync/operations/:operationId/ack`：客户端应用 canonical 后上报成功/部分失败统计，不包含原始内容。
- `GET /api/v1/desktop-sync/history?page=&pageSize=`：分页获取当前账号同步记录，默认 20、最大 100。

`mode` 缺省为 `apply`，旧客户端请求行为完全不变；老服务端忽略 `mode` 会把 preview 当 apply 执行（无数据破坏），客户端对 404/异常响应提示升级服务端。

`execute` 的 operationId 幂等；相同 operationId 的请求体 hash 不一致时拒绝。并发修改使用 per-category revision 和数据库事务检测；revision 冲突返回稳定错误，客户端不在后台自动重试，用户再次点击“立即同步”收敛。

### 6.4 三方合并

每个类别统一使用 stable item id、canonical hash、`updatedAt` 和本地保存的 baseHashes：

1. 仅本地变化：本地版本写入云端。
2. 仅云端变化：云端版本返回并应用本地。
3. 一侧删除、另一侧未改：删除生效并产生无正文 tombstone。
4. 一侧删除、另一侧已改：比较更新时间，较新操作胜出并记录冲突。
5. 两侧同时修改同一 item：较新 `updatedAt` 胜出；时间完全相同时，本次手动发起设备版本胜出。冲突只记录 winner 和计数，不保存 loser 正文。
6. tombstone 保存在云端，阻止长期离线设备重新上传已删除旧数据；v1 不自动清理 tombstone。
7. 合并结果按 category 独立提交；单类验证失败不影响其他类别，整次记录标记 `partial`。

内置数据不物理删除或覆盖：system rule 只同步稳定 fingerprint 对应的 enabled override，内置 agent/team 只应用白名单可编辑字段。

### 6.5 本地应用顺序

为保持引用关系，canonical 数据按以下顺序应用：

1. workflows；
2. prompts/rules；
3. assistants（同类内先应用 agent，再应用 team）；
4. custom commands；
5. memory；
6. appearance。

每类独立捕获采集与应用异常；记忆正文使用既有原子文件写入。cloud 已提交但本地应用失败时，不推进该类本地 revision，并保存 pending apply 标记；history 结合云端状态与本机 ack 状态展示“部分成功 / 失败 / 本机待确认”。下一次手动同步重新拉取 canonical 收敛，不启动后台重试。

## 7. 桌面端结构

### 7.1 新模块

- `packages/protocol/src/account-sync.ts`：IPC/HTTP contract、category、snapshot、history 类型与 Zod schema。
- `apps/desktop/src/main/services/AccountSync/`：
  - `AccountSyncService`：账号检查、execute/ack/history 编排和 single-flight；
  - `sync-policy.ts`：字段白名单、基础类型与秘密扫描；
  - `sync-adapters.ts`：七类 collect/apply；
  - per-account baseRevision/baseHashes/tombstones 由 `AccountSyncService` 通过 `app_settings` 管理；
  - `registerAccountSyncIpc.ts`。
- `apps/desktop/src/renderer/design/views/account-sync/`：独立 `AccountSyncSettingsSection`、记录列表、状态模型和样式。

### 7.2 IPC

- `account-sync:get-preferences`
- `account-sync:update-preferences`
- `account-sync:execute`
- `account-sync:list-history`

IPC schema 必须拒绝 renderer 传入 userId；main 从 `AuthService.getCurrentUserId()` 获取账号。execute 增加 single-flight，防止双击产生两个并发操作。

### 7.3 UI

设置导航新增“账号与同步 / 同步”。页面采用现有扁平风格，用分割线、文字层级与小状态点表达结构，不新增大块渐变 hero 或多层卡片。

- 未登录：展示登录要求和跳转账号中心入口，所有开关与按钮禁用。
- 已登录但总开关关闭：显示固定隐私文案；类别开关和“立即同步”均禁用。
- 已开启：七类独立 Switch；未选择类别时按钮禁用并给出原因。
- 执行中：按钮 loading，导航离开不取消主进程操作；重复点击被 single-flight 合并。
- 完成：显示上传/下载/冲突/跳过摘要；疑似秘密条目只显示名称与 reason code。
- 记录：分页 20 条，显示状态、时间、匿名设备、类别和计数；不展示 payload。

远端 appearance 应用后通过统一 renderer 事件更新 localStorage、CSS variables 和 React context，避免“数据库已变但界面不变”。

## 8. edu-server 结构

- 新增 `desktop-sync-snapshot.entity.ts`、`desktop-sync-record.entity.ts` 并注册到 TypeORM entities。
- 新增 `desktop-sync.service.ts`：账号隔离、DTO 校验、三方合并、revision、幂等、加解密和 history。
- 新增 `desktop-sync.controller.ts`，整个 controller 使用 `@AuthRequired()`。
- 新增 migration `20260830_add_desktop_account_sync.sql`，包含表、唯一键和分页索引。
- 服务端上限初稿：单次压缩前 JSON 5 MiB、每类 2,000 items、单字段 256 KiB、history 默认 20/最大 100；实现时按真实记忆/工作流样本复核。

## 9. 异常与兼容策略

- 未登录：main 直接返回“请先登录”，不发网络请求。
- edu-server 未升级或接口 404：显示“当前服务端暂不支持同步”，不影响其他功能。
- 401：沿用 `EduServerClient` refresh；refresh 失败回到登录态，不修改本地。
- 网络失败：保留本地数据和 base metadata，不伪造成功记录。
- schemaVersion 不支持：按类别跳过并提示客户端升级，不解析未知结构。
- 本地缺少 Skill/Workflow/Agent 引用：保留可安全保存的配置，失效引用不激活并计入 skippedDependencies。
- appearance 中目标设备缺字体：使用现有 fallback，不把字体资产加入同步。
- 记忆文件写入失败：该类别本地应用失败，其他类别继续；不在线删除或替换整个 memory 目录。
- 所有同步失败都只能影响同步页，不得阻断会话、画布、设置页其他模块或应用启动。

## 10. 验证计划

### 10.1 edu-server

- entity/migration 健康检查；
- 用户 A 无法读取/确认用户 B 的 snapshot 或 operation；
- execute 幂等与相同 operationId 不同 request hash 拒绝；
- 七类 schema/限额/秘密字段与秘密文本拒绝；
- 三方 merge：新增、更新、双改、双删、离线删除、tombstone、防复活；
- 多类别事务、revision 冲突和 partial record；
- AES-GCM round trip、错误 key/损坏 ciphertext fail closed；
- history 分页与无原文断言；
- controller AuthRequired 与统一响应 contract。

### 10.2 Spark-Agent

- 同步偏好按账号隔离、默认关闭、七类默认未选；
- 启动、登录、登出、设置变化不会调用 execute；
- serializer 只输出白名单，模型/Provider/MCP/Hook/env/path/secret 永不出现；
- 助手 apply 保留本机 providerProfileId/modelId/agentAdapter/reasoningEffort/mcpServerIds/hookConfig；
- 团队/工作流依赖顺序和缺失引用回退；
- memory collect/apply 不上传 filePath/sourceSessionId，使用原子文件写入；
- appearance apply 同步 SQLite、localStorage 和实时界面；
- 401 refresh、404 老服务端、网络失败、schema mismatch、部分完成；
- UI 未登录/关闭/空选择/loading/success/partial/error/history 状态；
- `SettingsView.tsx` 只做最小接线，新模块文件均控制在 3000 行以内。

### 10.3 交付门禁

- 两仓库定向 lint/typecheck/unit tests；
- Spark-Agent `check:file-size` 与 migration verifier；
- edu-server `npm run build`、相关 Jest 和 migration health test；
- `git diff --check`、调用点复核、错误回退和向后兼容审查；
- 前端代码审核必须重新确认每个问题确为缺陷后再修复；
- UI 自动化只能验证交互与渲染，不代替用户在真实账号/双设备环境的手动验收。

## 11. 分阶段实施

### Phase 1：后端 contract 与安全存储

1. 固化 category/schema/限额/错误码。
2. 新增 migration/entities/encryption/validator/merge service/controller。
3. 完成账号隔离、幂等、merge、history 测试。

### Phase 2：桌面同步核心

1. 新增 protocol 与 AccountSync main service/IPC。
2. 实现七类白名单 adapter、per-account state、秘密扫描和 apply 顺序。
3. 完成纯逻辑和 main-process 测试。

### Phase 3：设置页与记录

1. 独立实现同步设置模块并最小挂接 `SettingsView`。
2. 接入登录态、开关、类别选择、立即同步、结果与 history。
3. 完成 renderer 测试与真实界面检查。

### Phase 4：双仓库复核与交付

1. 执行定向验证、代码审核、安全与兼容性复核。
2. 把本文状态改为“已落地”并刷新日期。
3. GitNexus 可用时分别更新 Spark-Agent 与 spark-edugen 索引；不可用时记录源码降级核对结果。

## 12. 已确认的实施基线

本计划默认采用以下产品决定：

1. 总开关和七类选择都按“每账号、每设备”保存，首次全部关闭/未选。
2. 一个“立即同步”按钮执行双向同步，不拆成独立上传/下载按钮。
3. 同一 item 双端同时修改时以更新时间决定，完全同时时当前手动发起设备胜出，并记录冲突。
4. 内置 system rule 不上传正文，只同步启用覆盖；项目/会话 scopeRef 仅作为 opaque ID 同步。
5. 云端 payload 使用服务端 AES-256-GCM 加密存储；同步记录不保存正文。

用户已确认以上基线，Phase 1—4 已按该范围完成。

## 13. 落地结果与验证

- edu-server 已落地 execute / ack / history、JWT userId 隔离、operationId 幂等、按类三方合并、AES-256-GCM 加密快照、无正文记录表和显式 migration。
- Spark-Agent 已落地严格 IPC、按账号偏好、匿名设备 UUID、HTTPS/loopback 限制、七类 adapter、逐类别采集/应用回退、账号切换保护和独立扁平设置页。
- 审查阶段补齐：错误类型字段双端拒绝；本地采集失败类别不再作为空快照上传；history 结合本机 ack 展示最终状态。
- 增量能力（2026-08-30）：冲突「预览 → 选择 → 执行」两步流——设置页新增独立冲突面板，服务端 preview 只算合并不落库，`conflictChoices` 按用户选择决胜，未知/非冲突条目引用 fail-closed；侧栏用户菜单新增「账号同步」快捷入口（未开启或未登录跳转设置页，执行结果以 Toast 摘要展示，并即时应用同步下来的外观）；全部同步错误码改为面向用户的友好提示（只改展示层，落库码不变），历史页与 Toast 共用映射。
- 验证通过：桌面端协议/同步/UI/外观聚焦测试 31 tests，后端 5 suites 23 tests，桌面主进程 typecheck，后端 build，87 个桌面 migration 干跑，桌面生产构建，新增文件定向 lint/format 与 `git diff --check`；冲突面板/设置页/错误码映射/外观 hook 回归 21 tests，主进程 23 tests，后端 4 suites 38 tests，双端 typecheck 与构建通过。
- 全 renderer typecheck 仍受既有 video workbench 测试缺失符号阻塞，与账号同步改动无关；真实账号、双设备链路、冲突选择收敛和 Electron 视觉效果需用户手动验收。
