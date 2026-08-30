# Runtime Foundation Audit: Skills, MCP, Prompts, Rules, and Environment

> 审查日期：2026-08-26  
> 审查状态：已完成（只读审查，未修改业务代码）  
> 审查性质：只读代码审查 + 隔离环境最小复现，不包含缺陷修复

## 审查目标

验证以下运行时基础能力在代码层面的完整性、优先级、边界处理和测试覆盖：

- Skills：平台级（内置/市场）、宿主级（~/.claude 等）、项目级（工作区技能目录）和用户指定来源的发现、安装、卸载、启停、去重、加载与调用。
- MCP：配置读取、作用域合并、服务器注册、进程生命周期、工具暴露、受管服务器保护与错误降级。
- 提示词与规则：系统、平台、Agent、项目、规则文件、记忆和会话上下文的组装顺序与隔离。
- 环境变量：系统、应用、Provider、MCP、会话/项目层的合并、覆盖、过滤、脱敏与继承。

## 审查方法

- 从公开入口（IPC / PlatformBridge / SDK 执行器）追踪到存储层、合并器、运行时适配层和最终进程/模型调用边界。
- 对每个候选问题复核触发条件、实际调用方、现有保护逻辑和测试，避免仅凭局部代码推断。
- 运行与风险匹配的聚焦测试；对符号链接逃逸在系统临时目录做最小复现（复现脚本：`.spark-agent/repro/symlink-escape.repro.test.ts`，位于平台忽略目录）。
- GitNexus MCP 当前未暴露，按项目降级规则使用源码阅读、`rg`、测试和 Git 历史完成影响核验。
- 工作树存在其他会话并行改动，本审查全程只读，未修改任何被跟踪文件。

## 审查发现

### 1.［高·已复现］项目级技能/规则发现可经符号链接读取工作区外文件

- 位置：`packages/agent-runtime/src/services/project-context.service.ts:640`（`isInsideRoot` 纯词法检查，基于 `path.relative`，不解析符号链接）；`safeStat` 用 `statSync`（跟随软链）；`toProjectDoc` → `safeRead` 直接读取文件内容。
- 影响链路：
  - 自动链路：`discover()` 扫描 `SKILL_DIR_PATHS`/`RULE_DIR_PATHS`/`AGENT_DIR_PATHS`，技能摘要与规则内容进入系统提示词（`session.service.ts` 项目上下文注入）。
  - 显式链路：`buildSkillSystemPrompt(root, 'project:...')`（`project-context.service.ts:192`）按词法边界校验后读取全文。
- 复现结论：恶意仓库在 `.claude/skills/<name>/SKILL.md` 放置指向工作区外文件的软链接，文件内容（测试中以模拟敏感文件验证）成功进入技能系统提示词，`discover()` 自动链路同样中招。规则目录与 Agent 目录共用同一套词法边界，同样受影响。
- 威胁模型：用户打开任意克隆仓库即可触发；宿主机 `~/.ssh/`、`.env`、`~/.claude/` 凭证等文件内容会被注入模型上下文并外发给模型供应商。
- 建议修复方向：发现与加载时对文件与目录做 `realpath` 解析后再做包含检查；或拒绝符号链接条目（`lstatSync` 判定）。
- 测试覆盖：`project-context.service.test.ts` 无任何符号链接用例。

### 2.［中高］平台管理接口 mcpDelete 绕过受管服务器保护并泄漏在跑连接

- 位置：`packages/agent-runtime/src/services/platform-bridge.service.ts:1102`（`mcpDelete` 直连 `mcpRepo.deleteById()`）。
- 对照：`mcp-server.service.ts:144-162` 的 `deleteServer` 有三层保护——拦截 `MANAGED_MCP_SCOPE` 删除、先 `stopServer` 断开在跑连接、发内部变更事件；且该保护有专门测试（`mcp-server.service.test.ts:116`）。同文件 `mcpCreate`/`mcpUpdate`（`platform-bridge.service.ts:1063、1089`）特意走 Service 层并注释了原因，唯独 delete 直连 repo。
- 后果：任意挂载平台管理 MCP 的会话（含 agent）可通过 `mcp__spark_platform__mcp_delete` 删除受管的 `playwright` 服务器登记行；且删除后已连接客户端仍滞留在 `clients` 映射（stdio 场景为僵尸子进程），直到应用重启。
- 建议修复方向：`mcpDelete` 改为调用 `d.mcpService.deleteServer(id)`，让 managed 拦截与连接清理统一生效。
- 测试覆盖：`platform-bridge.service.test.ts`（10 例）未覆盖 mcpDelete 对 managed 作用域的行为。

### 3.［中高］team/user/session 作用域规则在真实会话运行时静默失效

- 位置：运行时组装 `packages/agent-runtime/src/services/session.service.ts:2469-2486`——只合成 `system` 作用域 + `project` 作用域（按工作区过滤）+ 显式绑定规则（`agent.ruleIds`、workflow 节点 `config.ruleIds`，见 `session-pure-utils.ts:930`）。
- 对照：
  - 设置页 UI（`apps/desktop/src/renderer/design/views/SettingsView.tsx:2199-2215`）允许创建全部 5 个作用域，标签明确承诺语义（如 `user` = "用户全局偏好"、`team` = "团队管理员发布"）。
  - `RuleCompositionEngine`（`rule-composition.engine.ts:6`）声明 `system < team < user < project < session` 五级优先级，但其唯一调用方是 `rules:compose` 预览 IPC（`apps/desktop/src/main/ipc/index.ts:6547`），从未接入任何会话运行时。
- 后果：用户在设置页创建 user/team/session 作用域规则后，除显式绑定到 Agent/Workflow 外，在任何会话中都不生效，且无任何提示。预览接口与真实运行时的层级语义不一致，属于架构级断点。
- 建议修复方向（二选一，需产品决策）：运行时接入 `RuleCompositionEngine` 按五级优先级合成；或收窄 UI 只暴露运行时真实支持的作用域（system/project），并把其余作用域标注为"仅显式绑定生效"。

### 4.［中］宿主软链技能的禁用状态在应用重启后被强制复位

- 证据链：
  - `packages/agent-runtime/src/services/local-skill-importer.ts:121`：`importLocalSkillDirectory` 的 payload 固定 `enabled: true`。
  - `packages/agent-runtime/src/services/skill.service.ts:100-110`：对已存在行，`payload.enabled !== undefined` 时会把 `enabled` 写回（即恒为 true）。
  - `apps/desktop/src/main/ipc/index.ts:1697-1702`（`initializeAppSkills` 第 2 步）：每次启动对**全部**宿主软链无条件调用 `importLocalDirectory(link.linkPath, 'linked')`，没有按 rootPath 跳过已登记行。
- 对照：运行期增量刷新 `refreshHostSkillsIncrementally` 的注释明确承认该坑（"importLocalDirectory 会以 enabled:true 覆盖用户手动禁用状态"）并做了 rootPath 防护，但启动路径没有同样的防护。
- 后果：用户在技能管理中禁用任一 `local:linked:*`（宿主 Claude/Codex 技能）→ 应用重启后自动恢复为启用。
- 建议修复方向：启动循环按 rootPath 跳过已登记行（与增量刷新同口径）；或让重导入保留现有行的 `enabled` 值。

### 5.［低］环境变量认证键优先级在 Claude 与 Codex 两条路径上不一致

- Claude 路径（`claude-sdk-executor.ts:240-267`）：`customEnv` 先注入，随后强写 `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` 等认证键——认证键权威，用户变量无法破坏认证（注释明示该设计）。
- Codex 路径（`codex-cli-executor.ts:295-300`、`codex-sdk-executor.ts:615-620`）：合并顺序为 `process.env → provider env → customEnv → MCP env`，customEnv 同名键（如 `OPENAI_API_KEY`）会覆盖 Provider 认证键。
- 后果：用户在项目/会话层配置了与认证键同名的变量时，Codex 认证被静默破坏而 Claude 不受影响。属设计不一致而非崩溃缺陷。

### 6.［低］技能"管理列表删除"与"市场卸载"行为不一致，可产生孤儿目录

- `skill:delete`（`SkillService.deleteSkill`，`skill.service.ts:45-51`）只删 DB 行不动磁盘；市场页卸载（`SkillRegistryService.uninstall`，`skill-registry/index.ts:388-400`）删 DB + 磁盘目录且有明确告知。
- 后果：市场安装的技能若从管理列表删除，落盘目录残留在 `userSkillsDir`（重装时会被 `rmSync` 覆盖，不会被启动扫描复活——启动链不重扫该目录）。仅磁盘空间泄漏。

## 健康项（审查通过，无需改动）

- **环境变量链路**：project + session 两层合并、session 覆盖 project（`runtime-composition.service.ts:202-225`）✓；`buildEnvSystemPrompt` 只暴露键名 + 脱敏值（`maskSecret`，:393-397）✓；customEnv 经 `buildIsolatedRuntimeEnv` 继承到 SDK 子进程且 `ANTHROPIC_*` 阻断列表生效 ✓；MCP stdio 子进程 `config.env` 覆盖 `process.env`（`stdio-transport.ts:56`）✓。
- **内置技能**：`ensureBuiltInSkills` 更新已存在行时不写 `enabled`，禁用状态跨重启保留 ✓。
- **市场技能卸载**：DB + 磁盘一致性清理，且卸载前有明确确认弹窗 ✓。
- **宿主技能增量导入**：rootPath 防护 + 节流 + 去重（`refreshHostSkillsIncrementally`）✓（缺口仅在启动路径，见发现 4）。
- **受管 MCP 保护的 Service 层实现与测试** ✓（缺口仅在 bridge 绕过，见发现 2）。
- **托管插件目录**：`buildManagedPluginDir` 全量重建，禁用/卸载技能不残留 ✓。

## 验证记录

- 符号链接逃逸最小复现：通过（测试断言工作区外文件内容进入 `buildSkillSystemPrompt` 结果与 `discover()` sources）。复现脚本留存于 `.spark-agent/repro/symlink-escape.repro.test.ts`（平台忽略目录，未入工作树）；临时测试文件已从包内删除。
- `packages/storage` 单测（含第一轮 4 项 better-sqlite3 ABI 失败项）：按项目脚本 `scripts/sqlite-abi.sh node` 切换后 **33 文件 / 340 用例全部通过**；其中 1 例（`session-collaboration.repository.test.ts > searches past the old fixed event window`）在全量负载下首次超时抖动，单独与二次全量均通过。验证后已执行 `scripts/sqlite-abi.sh electron` 恢复 Electron ABI，绑定文件确认存在。
- 第一轮 97/101 通过的其余聚焦测试维持结论；4 项失败确认为环境 ABI 问题，非业务逻辑缺陷。
- 本审查未修改任何被跟踪文件；未运行全项目 typecheck/构建（工作树存在大量并行改动，遵循隔离审查约定）。

## 结论

四条链路（Skills / MCP / 提示词与规则 / 环境变量）整体架构清晰、分层合理，环境变量链路基本无缺陷。确认 6 项问题：1 项高严重度安全缺陷（符号链接逃逸，已复现）、2 项中高功能缺陷（MCP 受管保护绕过、规则作用域静默失效）、1 项中严重度状态一致性缺陷（宿主技能禁用状态重启复位）、2 项低严重度不一致/泄漏。修复建议均为局部改动，不涉及破坏性重构；按项目约定，待方案确认后再实施修复。
