# DeepSeek Harness（dsh）作为第三核心引擎的集成可行性分析

> 状态: 待开发 | 最后核对: 2026-08-14

调研对象：`D:\code-project\deepseek-harness`（DeepSeek 官方开源 agent harness，MIT，版本 0.1.0-rc.5，developer preview）。
本文回答三个问题：① dsh 的架构思维是什么；② 它的插件/扩展体系长什么样；③ 能否作为 claude/codex 之外的第三核心引擎集成进 SparkWork，其插件体系如何复用。

---

## 一、dsh 架构思维

### 1.1 微内核 + 一切皆插件（Cordis）

dsh 不自研插件层，而是 vendor 并 patch 了 [Cordis](https://github.com/cordiverse/cordis)（Koishi 系框架），以 `@deepseek-ai/cordis` 名义发布。核心命题：**没有特权内核**——模型适配器、工具注册表、会话日志、agent 循环本身全部是插件，都可以从配置替换。注册即「可逆 effect」，插件卸载自动回滚。

关键机制（`docs/architecture.md`、`docs/cordis-primer.md`）：

- 插件三形态：函数插件（`export const name/inject/apply(ctx, config)`）、对象插件、`Service` 子类（构造时声明 `ctx.<key>` 服务位）
- `inject` 声明服务依赖 → Loader 自动排序加载；类型经 declaration-merge 合并进 `Context`/`Events`
- 事件四派发模式：emit / **waterfall**（`agent/pre-step`、`llm/stream`、`tools/pre-execute`，监听器须调 `next()` 委托）/ parallel / serial

### 1.2 组合即配置（Profile / Bundle）

- **profile** = `$DSH_HOME/profiles/<name>`（`~/.dsh`，可经 `DSH_HOME` 重定位），声明有序 bundle 列表 + 用户 `cordis.patch.yml`
- **bundle** = 声明 `dsh.bundle.patch` 的 npm 包，本质是 Cordis 配置行（`{id, name, config}`）的 YAML patch
- 层序：`dsh-base` → `web-app`/`headless` 模式包 → profile patch → home patch → `--patch` 覆盖；任意行可被上层整体替换
- `dsh --profile web --dump-config` 可打印实际插件树

### 1.3 事实源：追加式会话事件日志

`SessionEvent` 追加日志是唯一事实源（43 种事件类型），模型历史、fork/resume、transcript、遥测、持久化全部由日志投影（`deriveMessages()`）。核心不变量：**"Model-visible means logged"**——模型可见输入必须可从日志重建，运行时有断言守卫。持久化双后端：JSONL+zstd 或 `node:sqlite`。

### 1.4 能力 Seam（三角色能力缝）

每个可替换能力 = Service Definition（接口声明）+ Provider（实现）+ Consumer（通常是模型工具）。fs/subprocess 共享一个执行世界，换一个 provider 指向远程沙箱，Bash/PTY/LSP 全部跟着走。subagent 有六个 provider（spawn/fork/acp/codex/**claude-code**/dsh-sdk）。

### 1.5 模型中立

`ctx.llm` 是 provider 中立的路由注册表。两套适配器：`llm-deepseek`（原生）与 **`llm-pi-ai`**（基于 pi-ai 的通用多 provider 适配器：openai/anthropic 目录路由 + 任意 OpenAI 兼容网关 + thinking 方言，纯配置）。**dsh 完全可以跑非 DeepSeek 模型**，API key 走 `apiKeyEnv` 引用 + `ctx.credentials` 每请求解析。

### 1.6 平台与安全

- 三平台沙箱一等公民：Linux bwrap→Landlock / macOS Seatbelt / **Windows ACL restricted-token**（partial enforcement 如实上报），fail-closed
- Node `^22.19.0 || >=24`；`node:sqlite`、`node:zlib` zstd、`node:async_hooks`；Windows 有专门 CI 门禁
- Web 服务仅 127.0.0.1（`--host 0.0.0.0` 故意拒绝）、无 TLS 无认证（本地信任模型）

---

## 二、dsh 插件与扩展体系

### 2.1 扩展点全景（`docs/cookbook/extension-cookbook.md` 有完整映射表）

| 目标               | 机制                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| 加模型 provider    | `ctx.llm` 注册适配器                                                                              |
| 加模型可见能力     | `ctx.tools` 注册（schema 自动进 prompt 装配）；执行管线 pre/guard/around/post/result 五段         |
| 权限门             | `tools/pre-execute` waterfall 返回 `ask` → `ctx.approval`                                         |
| 换 shell/沙箱/fs   | `ctx.shell`/`ctx.sandbox`/`ctx.fs` provider                                                       |
| 截断请求/工具/turn | `agent/*` 事件（`agent/pre-step` 可改写或拒绝，`agent/turn-stopping` 可停 turn）                  |
| 注入模型上下文     | `agent.inject()`                                                                                  |
| slash 命令         | `ctx.commands`                                                                                    |
| 浏览器 UI          | `packages/client/ui-slots`：`slots.register({name, kind}, Component)`，keyed/chain 两种槽         |
| 插件配置 UI        | schemastery `Config` schema → host 序列化 → 浏览器 `schema-form` 复活渲染（JSON-Schema 驱动表单） |

### 2.2 分发

`dsh plugin --profile <name> add <pkg>` 转发给 profile 目录里的 pnpm；npm 包名/git URL/tarball 皆可，**无 scope 约定、无 marketplace**。动态插件（`cordis_define` 工具）只存活于进程内存。

### 2.3 与 Claude Code 生态的互操作（重点！dsh 主动做了兼容）

1. **技能格式完全兼容 Claude Code**：`SKILL.md` + 同款 frontmatter（`name/description/whenToUse/disable-model-invocation/user-invocable`），扫描 `.dsh/skills`、**`.agents/skills`**、`~/.dsh/skills`、**`~/.agents/skills`**——与 Spark 现有技能目录天然重叠
2. `dsh-hooks-claude-code` 直接吃 Claude Code `hooks.json` 映射到 typed 拦截点
3. 通用 MCP client（stdio + streamable-http，`mcp__<server>__<name>` 注册进 `ctx.tools`）
4. `dsh-subagent-claude-code` / `-codex`：把 Claude Code / Codex 当子代理进程拉起
5. AGENTS.md 作为 prompt section

### 2.4 第三方复用插件体系的边界（关键结论）

- Cordis 是 **vendor + patch 的私有 fork**，非上游社区版
- 仓内 ~150 个 `@deepseek-ai/dsh-*` 包以 `workspace:^` 高度互相依存，**单独抽某个扩展点会拖出整条 spine**；生态包（工具/UI）没有独立于 dsh 运行时的生存能力
- 浏览器 UI 插件依赖 client-modules + slots + `__DSH_BOOT__` 启动图整套机制
- 结论：**"拥有 dsh 插件生态"的唯一方式 = 嵌入 dsh 运行时本身**（bundle/profile 机制正是为此设计的）；把 cordis 单独抽出来给 Spark 用理论可行（`boot()` 是官方嵌入路径）但等于换掉 Spark 自己的骨架，不建议

---

## 三、集成可行性：三条官方集成面

| 集成面                                                  | 形态                                                                         | 事件保真度                                                             | 取消                  | 审批回路                                               | 状态                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ | -------------------------- |
| **SDK**（`packages/sdk/client`，TS/Python 双实现）      | stdio JSON-RPC 子进程，`DeepSeekHarness.run()` / `HarnessClient.subscribe()` | **完整**（全部 `session.event` + `session.status` + subagent lineage） | ❌ 无 mid-turn cancel | ❌ wire 未实现（预留中）                               | 可用，developer preview    |
| **ACP**（`packages/acp`，agentclientprotocol.com 标准） | stdio JSON-RPC                                                               | ❌ 仅 `agent_message_chunk`（无 tool 事件）                            | ✅ `session/cancel`   | ✅ `session/request_permission`（一次性 allow/reject） | 可用，automation-only      |
| **Web/Host apiproxy**（`--profile web`）                | 本地 HTTP `POST /api` + 两条下行 WS                                          | 完整（dsh 自家 Web UI 就靠它）                                         | ✅                    | ✅                                                     | 可用；内表面、无稳定性承诺 |

**官方架构 RFC 明确预留了 Electron 路径**：`host/webserver/src/index.ts:7` 与 `.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md` 写明 "A future Electron application reuses the same web client packages over an IPC fetch carrier"——client 包的 `AbstractApiClient` 换 `doFetch` 即可，契约零改。即：dsh 官方设计目标之一就是被第三方壳复用。

### 3.1 结论：可行性判定

**可行，且是三条集成面中工程量最小的一条路径，但有两个硬缺口（取消、审批）需绕行或等待上游。**

与 claude/codex 的 SDK 形态同构（子进程 + 流式事件 + 归一化到 `AgentEvent`），Spark 的 executor 鸭子契约（`onEvent/offEvent/cancel/executeTurn`）可以直接套。dsh 甚至官方支持把 Claude Code/Codex 当**子代理**（`dsh-subagent-claude-code/-codex`），说明三方共存是被上游测试过的场景。

### 3.2 推荐架构（分阶段）

```
阶段 1（Spike，1~2 周）
  Spark 主进程 ──spawn──> dsh runtime（Node 22.19+，headless bundle + sdk-server 插件）
     · HarnessClient.subscribe() → SessionEvent → dsh-event-mapper → AgentEvent
     · provider 经 llm-pi-ai 路由接 Spark ProviderService（openai-compatible/anthropic）
     · 审批：初期用 dsh approval policy + sandbox（fail-closed，Windows ACL）代替交互审批卡
  验收：一条会话跑通 read/bash/todo + 流式渲染 + 工具卡

阶段 2（MVP 引擎）
  · 枚举 'dsh' 接入 SessionAgentAdapterSchema 等 4 处硬编码（见 §4.2 清单）
  · DshRuntimeIntegrityService（仿 CodexRuntimeIntegrityService，userData/agent-runtimes/dsh，
    pnpm/npm 安装 @deepseek-ai/dsh-* 运行时，锁定版本）
  · MCP 桥：Spark MCP 注册表 → dsh cordis.yml 的 mcp-client 行（stdio 型直接透传）
  · 技能桥：把 Spark 技能根目录喂给 dsh skill-filesystem（格式同源，近乎零成本）
  · 权限：dsh permission profile ↔ SparkPermissionMode 映射器

阶段 3（补缺口，视上游演进）
  · 交互审批卡：等 SDK wire 的 server→client request 落地；或临时切 ACP 传输（有 request_permission
    但丢 tool 事件，不适合主 UI）；或经 settings.yaml 热重载动态切换 approval policy
  · 取消：当前只能 close() 子进程（粗暴）；跟踪上游 cancel 方法
  · 可选深水区：Spark 内嵌 dsh web client 包（IPC fetch carrier，官方 RFC 路径），
    让 dsh 的 ui-slots 插件面板直接出现在 Spark 窗口里
```

### 3.3 dsh 插件体系在 Spark 中的复用矩阵

| 能力                           | 复用方式                                                                                                                                                              | 成本           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Skills                         | 格式同源（`.agents/skills` 双方都扫），目录喂给 dsh 即可                                                                                                              | 近零           |
| MCP                            | Spark MCP 注册表 → dsh mcp-client 配置行（桥接层）                                                                                                                    | 低             |
| dsh 工具/LLM provider/事件插件 | 随嵌入运行时自带（profile 组合），Spark 无需改代码即可获得                                                                                                            | 低（安装通道） |
| dsh UI 插件（ui-slots）        | ❌ 渲染在 dsh web client 里，不出现在 Spark renderer；要复用须走阶段 3 深水区（内嵌 client 包）                                                                       | 高             |
| Cordis 框架本身给 Spark 用     | 不建议：vendored fork + 等于重写 Spark 骨架                                                                                                                           | 极高           |
| 思想借鉴                       | 追加式事件日志 + "model-visible means logged" 不变量（Spark agent_events 已同构）；waterfall 事件；可逆 effect；schema 驱动设置表单（Spark provider manifest 已同构） | 免费           |

---

## 四、Spark 侧接入点与风险

### 4.1 现状（双引擎架构摘要）

- 引擎枚举：`z.enum(['claude','claude-sdk','codex'])`（`packages/protocol/src/schemas/index.ts:80`）等 **4 处硬编码**（protocol schema、ipc 类型、resume-gate、renderer/MCP 字面量）
- 适配层：`packages/agent-runtime/src/sdk/` 下 4 个 executor（claude-sdk / codex-sdk / codex-cli / codex-openai），**鸭子类型契约无显式接口**
- 事件归一化：全部产 `AgentEvent` 联合（41 种，`packages/protocol/src/events/index.ts:950`），`agent_events` 表 append-only 引擎无关——**历史时间线不依赖引擎**
- 编排：`session.service.ts`（约 11,700 行）在 `:3463` 二分叉 claude/codex

### 4.2 第三引擎接入清单（来自调研，接入时逐项核对）

1. 枚举 ×3：`packages/protocol/src/schemas/index.ts:80`、`packages/protocol/src/ipc/index.ts:139`、`session-resume-gate.ts:11`
2. 归一化：`getAgentAdapterFromSession`（session.service.ts:10453，**注意非 anthropic 一律 codex 的推断会吞掉 dsh**）、`adapterKind` 二值归并（:2728）、`normalizePermissionMode` 的 `startsWith('codex-')` 嗅探（:10493）
3. turn 分叉：`session.service.ts:3463` 改三分支 + `tryStartDshTurn`
4. 新 executor：`packages/agent-runtime/src/sdk/dsh-sdk-executor.ts` + `dsh-event-mapper.ts`（SessionEvent → AgentEvent）
5. 运行时托管：仿 `CodexRuntimeIntegrityService` + `scripts/prepare-dsh-runtime-artifacts.mjs`；**独立 Node ≥22.19 运行时**（不可用 Electron 内置 Node 直接跑）
6. IPC/desktop：`readRuntimeAgentAdapter`（ipc/index.ts:1973）、canvas `adapter==='codex'?…:…` 多处二元表达式、agent 白名单（:9042）
7. Renderer：ComposerV2 `ADAPTER_OPTIONS`（:5757）、权限选项、brand 图标；AgentsView 等 8 个组件字面量
8. MCP 平台工具枚举：`platform-management-mcp-server.mjs:734/796/1633`
9. Resume gate allowlist（session-resume-gate.ts:28）：dsh 默认走 fresh 路径，原生 resume 需把 SessionEvent 日志 → AgentEvent 回放（dsh 日志本身支持投影，可作为加分项后做）

### 4.3 风险清单

| 风险                                                       | 等级 | 对策                                                                                    |
| ---------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| dsh 是 developer preview，明示会有破坏性变更               | 高   | 锁定精确版本；集成面收敛在 SDK 协议 + cordis.yml 行，不 import 内部包                   |
| SDK wire 无取消、无审批                                    | 高   | 阶段 1/2 用 approval policy + sandbox 代替交互审批；取消用 close() 粗粒度兜底；跟踪上游 |
| Cordis 是 vendored fork                                    | 中   | 不直接依赖 `@deepseek-ai/cordis`，只经运行时组合                                        |
| `installFailLoud`（unhandledRejection→exit）+ SIGTERM 处理 | 中   | 必须子进程运行，绝不能进 Electron 主进程；`DSH_HOME` 重定位到 userData                  |
| Node ≥22.19/24 + `node:sqlite`/zstd                        | 中   | 随 dsh 运行时托管独立 Node（Spark 已有 SPARK_STANDALONE_NODE 与托管运行时机制）         |
| `adapterKind` 二值归并/字符串嗅探静默路由错引擎            | 中   | 接入前先抽 `EngineExecutor` 显式接口 + 注册表，顺手还掉技术债                           |
| session.service.ts 已 11,700 行（规约 ≤3000）              | 中   | 三分支前先做引擎分叉拆分（engine-dispatch 模块），否则持续恶化                          |
| 生产裸包名解析依赖 Loader 内部模块加载器/原生 addon        | 低   | 用 `dsh plugin add`（pnpm）正规通道安装，不走裸 require                                 |
| 上游迭代方向（如 settings 页白名单）变化                   | 低   | 集成面钉在 SDK + profile 组合，UI 深水区后置                                            |

---

## 五、总结判断

1. **架构上**：dsh 是目前开源 agent harness 里扩展性设计最严谨的一个（微内核 + 可逆 effect + 事件日志事实源 + 能力缝），且官方 RFC 明确把「被第三方 Electron 壳复用」当设计目标——嵌入是被上游预期的用法。
2. **工程上**：作为第三引擎**可行**，形态与 claude/codex SDK 同构（子进程 + 事件流），事件模型（turn/step/assistant-chunk/tool-call/subagent）与 Spark `AgentEvent` 几乎一一对应。
3. **插件体系上**：复用的正确姿势是**嵌入运行时即获得生态**，而非抽取 cordis；Skills/MCP 近零成本互通（dsh 主动兼容了 Claude Code 生态，而 Spark 技能格式与其同源）；UI 插件是唯一不可迁移的部分。
4. **时机上**：developer preview + SDK 缺取消/审批两个交互硬回路——建议按阶段 1 Spike 先行验证（工程量 1~2 周），MVP 等上游协议补齐审批后再排期；期间所有集成面钉死在 SDK 协议 + cordis.yml 组合，不碰内部包。

主要参考：`docs/architecture.md`、`docs/cookbook/extension-cookbook.md`、`packages/sdk/client/README.md`、`packages/acp/acp/README.md`、`.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md`、`packages/llm/llm-pi-ai/README.md`、`packages/skill/skill-filesystem`。
