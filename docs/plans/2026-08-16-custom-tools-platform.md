# 低代码自定义工具平台（Custom Tools）实施方案

> 状态: 已废弃 | 最后核对: 2026-08-31

本方案记录了 0.11.27 的第一阶段声明式 HTTP / Provider Vision 实现，但“每个自定义工具通过受管 `spark_custom_tools` MCP 暴露”的核心架构已经废弃。现行方案见 [原生自定义工具运行时](./2026-08-31-custom-tools-native-runtime.md)：自定义工具是 SparkWork 一等对象，MCP 只允许作为既有外部生态的导入适配器或模型引擎末端传输，不能再承担产品运行内核。

母讨论：2026-08-16 关于「自定义 Agent 工具 / UI 插件 / Agent 插件」的平台能力评估（结论：低代码自定义工具为 P0，UI 插件缓行，独立 Agent 插件概念不做）。
本方案基于 2026-08-16 三路代码级调研（工具注册管道 / plugin-sdk 与权限模型 / 持久化与执行先例）+ 两项关键结论人工复核（PlaywrightMcpRegistration 模式、mcp 配置 env 透传）。所有文件路径为当日实测；`session.service.ts` 行号在 Phase 1 W2 拆分期间会漂移，仅作定位参考。

---

## 0. 定位与目标

**一句话目标**：在不改变现有内置工具体系的前提下，让用户在安装后的 SparkWork 扩展中心创建、测试、启停和热更新自定义工具。自定义工具不是固定的“最小四类型”产品边界：底层保留可扩展的判别协议、执行器和宿主能力路由；首个落地切片开放 **HTTP 工具**与 **Provider 图像理解工具**，后续按真实场景增加新的内置模板或执行器。HTTP 工具以**受管 MCP 服务**形态同时供给 Claude 与 Codex；Provider Vision 由宿主在文本模型缺少视觉能力时确定性调用，不向模型开放任意本地路径读取。

截至 2026-08-31，协议、迁移、HTTP / Provider Vision 执行器、stdio MCP 热插拔桥、扩展中心 UI 和文本模型视觉回退已完成实现、五轴代码审查、聚焦测试及生产构建验证。`sql / command / prompt / composite` 仍是候选扩展，不构成首版必须同时交付的固定清单。

**用户故事**（覆盖四个能力方向，见 §3.1 的 A/B/C/D 分组）：

- 「帮我加个工具：调公司内部 Jira REST API 查 issue」→ HTTP 模板工具，token 存密钥库
- 「当前聊天模型不支持图片，但我已经配置了自部署图像理解渠道」→ 宿主调用首选 Provider Vision 工具，把不可信观察结果注入当前用户消息后继续回答
- 「加个工具：对我们项目的 spark.db 跑只读统计」→ SQL 工具（SQLite）
- 「加个工具：跑 workspace 里的 build_report.py 出报表」→ 命令模板工具
- 「让 Agent 能往我们飞书群推消息」→ 模板库「Webhook 推送」preset（M3）
- 「把我的代码评审清单固化成可复用工具」→ 提示词工具（M3）
- 「把这套工具导出发给同事」→ JSON 导入导出（密钥不随文件走）

**非目标（明确不做）**：

- ❌ 自由代码沙箱工具（内嵌 JS/Python 解释器，即 Dify/Coze「代码插件」形态）——等价于开放式代码插件，沙箱逃逸/依赖管理/评审成本超出低代码边界；开发者路径已由 plugin-sdk 覆盖，声明式模板覆盖不了的逻辑用「命令工具跑脚本 + workflow 编排」组合承接
- ❌ Agent/Team 当工具调用——claude 引擎已有 subagent、平台已有 Teams，伪需求倾向，出现真实场景再议
- ❌ 表达式/正则「转换工具」——模型在上下文内本来就能做转换，该能力下沉为所有执行器共享的输出提取特性（§3.1 原则 2），不作为工具类型
- ❌ 触发器/定时反转集成——方向反了（是「工具调 Agent」不是「Agent 调工具」），会话定时任务已覆盖
- ❌ 工具市场/社区分发（M1-M2 只做点对点导入导出；上架市场前需重新安全评审）
- ❌ OpenAPI/Swagger 自动导入（M1-M2 不做；M3+ 仅作为 http 工具的**批量导入器**评估，非独立类型）
- ❌ UI 插件体系（另案，已决议缓行）
- ❌ 自造工具协议——工具以 MCP 形态暴露，双引擎天然兼容
- ❌ 替换或删减现有内置工具——自定义工具是独立扩展域，内置工具继续按原管线演进

---

## 1. 现状事实基线（计划证据）

### 1.1 工具如何到达双引擎（关键通道）

每个 turn 的工具面 = 一个 `Record<string, SDKMcpServerConfig>` 映射（`packages/agent-runtime/src/sdk/types.ts:385`），claude 路径原样传给 `sdk.query({ options.mcpServers })`，codex 路径经 `buildCodexMcpConfig`（`codex-sdk-executor.ts:776`）转成 codex 配置。**三种暴露形态**：

| 形态                                                      | 双引擎兼容性   | 例子                                                                                                                                       |
| --------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| stdio 子进程 MCP（`.mjs` + localhost RPC 回主进程）       | ✅ 双引擎      | `spark_platform`/`spark_search`/`spark_memory`/`spark_canvas`（`packages/agent-runtime/src/tools/*.mjs`，经 `PlatformBridgeService` 回调） |
| loopback Streamable-HTTP MCP（url + 每 turn 随机 bearer） | ✅ 双引擎      | `spark_plugins`（`PluginRuntimeMcpBridge`）、`spark_computer`、`spark_team`                                                                |
| 进程内 SDK MCP（`type:'sdk'`）                            | ⚠️ claude 独占 | `spark_verify`（`filterCliCompatibleMcpServers` 在 codex CLI 路径丢弃）                                                                    |

**决定性事实**：`SessionService.buildMcpServersForSDK()` 每 turn 重读 `mcp_servers` 表全部启用行。HTTP 自定义工具只需维护一行 `scope='managed'` 的受管 MCP 注册即可进入双引擎，不改既有内置工具注册。Provider Vision 属于不同链路：它消费本轮受控图片附件，必须在 `SessionService` 进入聊天执行器前由宿主路由，原生 `multimodal` 模型完全绕过该逻辑。

**热更新**：MCP 清单变化 → `McpService.onChange` → session `mcpVersion` 计数器递增 → 下一 turn `continueSession=false` 重启 MCP 子进程 → 工具 CRUD 后下一 turn 生效，无需重启应用。

### 1.2 可直接复用的既有资产

| 资产                                                                                                           | 位置                                                                                                     | 对本方案的用途                                                                        |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 风险词表 `RuntimeRisk/Effect/Idempotency`                                                                      | `packages/protocol/src/plugin-runtime.ts`                                                                | 自定义工具的风险元数据直接对齐（read/low-write/high-write/destructive）               |
| 一次性 `confirmationToken` 审批 + `plugin_runtime_audit`                                                       | `runtime-policy.ts` / `audit-service.ts`（`packages/agent-runtime/src/services/plugin-runtime/`）        | high-write/destructive 工具的调用审批与审计模式                                       |
| `RuntimeHttpClient`（bearer 注入、30s 超时、响应大小上限）                                                     | 同上                                                                                                     | HTTP 执行器的参考实现                                                                 |
| 密钥引用模式（SQLite 只存 `KeystoreRef`）                                                                      | `packages/shared/src/keystore/`、`provider_profiles.keystore_ref`                                        | 工具鉴权头/数据库密码的存储方式                                                       |
| 权限引擎（profiles + `TOOL_ACTION_MAP`：MCP 工具→`mcp_tool` action + 聊天内审批卡片 + 30min 过期）             | `permission.service.ts`、`claude-sdk-executor.ts:758 canUseTool`、`ComposerV2.tsx InlineApprovalRequest` | **自定义工具调用天然流经此管道**，审批 UX 免费获得                                    |
| 声明式清单编辑器（无自由 JS、密钥仅引用、validate→configure 流程）                                             | `ProviderManifestContractEditor.tsx` + `docs/design/agent-custom-media-provider-tools.md`                | 工具编辑器的交互模板                                                                  |
| schema→表单控件管线                                                                                            | `canvasParameterPresentation.ts` → `CanvasParameterControl.tsx`                                          | 参数表单渲染与「测试运行」输入表单                                                    |
| FfmpegRunner（argv 数组、`shell:false`、超时、SIGTERM→3s→SIGKILL、并发信号量、路径白名单 `assertPathAllowed`） | `apps/desktop/src/main/services/FfmpegRunner.ts`、`videoProcessHandler.ts`                               | 命令执行器的安全基线                                                                  |
| 输出截断 `clipTextHeadTail`                                                                                    | `packages/shared/src/token-estimator.ts`                                                                 | 所有执行器输出统一截断                                                                |
| StandaloneNodeRuntime / Spark 自建 runtime 制品                                                                | `StandaloneNodeRuntime.ts`、artifacts 源                                                                 | 命令工具的 node/python 解释器解析（Python 走 `runtime.python-3.11.9.win32-x64` 制品） |
| 迁移与仓库模式                                                                                                 | `packages/storage/migrations/`（下一号 083）、`repositories/base.repository.ts`                          | `custom_tools` 表落点                                                                 |
| IPC 域注册模式                                                                                                 | `registerPluginIpc.ts`（新域独立文件）+ protocol 内 `XxxIpcSchemaRegistry`                               | `registerCustomToolsIpc.ts` 落点                                                      |
| 视图模式                                                                                                       | `apps/desktop/src/renderer/design/views/`（McpView/AgentsView/PluginMarketplaceView）                    | 扩展中心 `CustomToolsSection.tsx` 落点                                                |

**确认无先例**：全仓不存在用户自定义工具编辑器/HTTP 工具模板功能（`ExternalToolService.ts` 是 IDE/终端启动器，无关）。绿地开发，但以上资产覆盖了 80% 的管道工作。

---

## 2. 总体架构

```
┌─ Renderer ──────────────────────────────────────────────┐
│  CustomToolsSection（列表/编辑器/测试运行）                │
│     │ window.spark.invoke('custom-tools:*')              │
└─────┼───────────────────────────────────────────────────┘
      │ IPC（zod 校验，IpcResult 包装）
┌─────▼───────────────────────────────────────────────────┐
│  Main: registerCustomToolsIpc.ts                         │
│  ├─ CustomToolService（CRUD/校验/变更事件/审计）           │
│  ├─ CustomToolExecutor[]（当前：http | provider-vision）   │
│  ├─ CustomToolPolicy（risk floor / confirmationToken）    │
│  └─ CustomToolsBridgeService（localhost JSON-RPC，随机端口+token）
│         ▲ RPC（SPARK_CUSTOM_TOOLS_BRIDGE_PORT/_TOKEN）    │
│  CustomToolsRegistration ──ensureRegistered──► mcp_servers 表
│        （scope=managed, name=spark_custom_tools, stdio）  │
└─────┬───────────────────────────────────────────────────┘
      │ 每 turn buildMcpServersForSDK() 读表（既有逻辑，零改动）
┌─────▼──────────┐
│ custom-tools-mcp-server.mjs（stdio MCP，随引擎子进程拉起）│
│  list_tools ← bridge；call_tool → bridge → executor       │
└─────┬──────────┘
      │ mcpServers['spark_custom_tools']
┌─────▼─────────────┐   ┌──────────────────────┐
│ ClaudeSDKExecutor │   │ Codex(SDK/CLI/OpenAI)│
└───────────────────┘   └──────────────────────┘

文本模型视觉回退（不经过模型可调用的 MCP 工具面）：

图片附件 → Host Capability Router → 首选 provider-vision 工具
        → Provider Keychain + OpenAI Chat Completions Vision
        → 不可信观察数据注入当前用户消息 → 文本聊天模型继续回答
```

### 核心决策

| #   | 决策                                                                                                    | 理由                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **独立 stdio 桥**（`custom-tools-mcp-server.mjs` + `CustomToolsBridgeService`），不塞进 `RuntimeBroker` | `PluginRuntimeMcpBridge` 的目录聚合按「已连接账号」过滤，无账号概念的自定义工具源不适合；stdio 桥模式有 `spark_memory`/`spark_canvas` 双实现先例，天然双引擎兼容 |
| D2  | **HTTP 工具使用受管 `mcp_servers` 行**（沿用 Playwright 注册模式）                                      | HTTP 热插拔不侵入既有 session MCP 构建逻辑；由独立 Runtime 串行维护连接生命周期                                                                                  |
| D3  | 权限 = `max(profile 对 mcp_tool 的判定, risk floor)`                                                    | profile 只能收紧不能放宽到工具风险之下；审批卡片复用 `InlineApprovalRequest`                                                                                     |
| D4  | **声明式 DSL，无自由脚本**；命令工具 = argv 模板 + `execFile`（`shell:false`）                          | 注入在结构上不可能，而非靠转义；对齐自定义多媒体适配器「无任意 JS」先例                                                                                          |
| D5  | 密钥只存 `KeystoreRef`（`custom-tool:<toolId>:<name>`），spec 内永不出现明文                            | 对齐 provider/connector 全仓惯例                                                                                                                                 |
| D6  | 协议、存储、IPC、UI 全部按既有域模式新增独立文件                                                        | 多 agent 并行零冲突（仅 4 处 ≤5 行的注册点，见 §10）                                                                                                             |
| D7  | **Provider Vision 只允许宿主路由，协议强制 `exposeToAgent=false`**                                      | MCP 任意调用无法证明路径属于本轮附件；宿主可用已归一化附件列表建立可信边界                                                                                       |
| D8  | **现有内置工具保持原样，自定义工具使用独立 `spark_custom_tools` 受管 MCP**                              | 后续新增内置工具与用户热插拔工具互不占用注册和生命周期边界                                                                                                       |

---

## 3. 工具类型规格（DSL）

### 3.1 通用信封

```ts
// packages/protocol/src/custom-tools.ts（新）
interface CustomToolSpec {
  id: string // slug: ^[a-z][a-z0-9_]{2,63}$，同时是 MCP tool name
  title: string // 展示名
  description: string // 给 LLM 看的工具说明（必填，≥10 字符，编辑器引导写清何时用）
  type: 'http' | 'provider-vision' | 'sql' | 'command' | 'prompt' // 开放集合按版本演进
  inputSchema: JsonSchemaObject // 参数 JSON Schema（编辑器从表单生成，非手写）
  risk: RuntimeRisk // 'read'|'low-write'|'high-write'|'destructive'
  effect: RuntimeEffect
  idempotency: RuntimeIdempotency
  secretRefs?: Record<string, KeystoreRef> // 名称 → 密钥库引用
  timeoutMs: number // 默认 30_000，上限 300_000
  spec: HttpToolSpec | SqlToolSpec | CommandToolSpec | PromptToolSpec
}
```

编辑器按 `inputSchema` 生成参数表单（复用 canvas 的 schema→`SchemaField`→控件管线），并强制校验 risk/effect/idempotency 一致性（复用 `plugin-sdk` 的 `defineTool` 校验规则：read ⇒ effect=read、destructive ⇒ idempotency=unsafe 等）。

### 3.2 HTTP 工具（M1）

```ts
interface HttpToolSpec {
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    urlTemplate: string // 'https://jira.internal/v3/issue/{{issueKey}}'
    headers?: Array<{ name: string; valueTemplate?: string; secretRef?: string }>
    body?: { mode: 'json'; jsonTemplate: string } // '{{param}}' 占位
  }
  response: {
    format: 'markdown-table' | 'json' | 'text'
    extract?: Array<{ label: string; jsonPath: string }> // '$.issues[*].fields.summary'
    maxSizeBytes: number // 默认 262_144（256KB）
  }
  allowPrivateNetwork: boolean // 默认 true（内网 API 是核心场景）；详情页常显徽标
}
```

**安全细则**：

- 占位符替换前参数先过 `inputSchema` 校验；URL 段内占位符逐段 `encodeURIComponent`，杜绝路径穿越与查询注入
- JSON body：占位符以 JSON 编码值替换 → `JSON.parse` 验证 → 重新序列化，**结构性注入在解析层死亡**
- header 的 `secretRef` 在执行时从密钥库解析，替换后的完整请求**永不落日志/审计**（只记 url 模板与参数哈希）
- 超时、响应大小上限、`clipTextHeadTail` 截断（对齐 `RuntimeHttpClient` 行为）
- jsonPath 为**自研最小子集**（`$.a.b`、`[*]`、下标），不新增依赖
- 风险建议值：GET→read；POST/PUT/PATCH→low-write；DELETE→destructive（用户可上调不可下调）
- `allowPrivateNetwork=false` 时在 Node socket 连接层使用 BlockList 拒绝私网、loopback、链路本地及保留地址；同一策略覆盖 DNS 结果和重定向目标，避免预解析检查产生 DNS rebinding 窗口

### 3.2.1 Provider 图像理解工具（首个宿主能力路由用例）

```ts
interface ProviderVisionToolSpec {
  providerProfileId: string // 只引用已有 Provider，不复制凭据
  model?: string
  instructions: string
  maxImages: number // 1..8
  maxTokens: number
  temperature?: number
  autoRoute: { enabled: boolean; priority: number }
  exposeToAgent: false // 协议常量，导入配置也不能开启
}
```

- 仅当当前聊天 Provider 明确声明 `modelType='text'` 且本轮包含图片附件时触发；原生 `multimodal` 完全绕过
- 多个工具按 `priority` 降序、工具 ID 升序稳定选择，不把选择权交给文本模型
- Provider API Key 继续由 `provider_profiles.keystore_ref` 指向系统 Keychain；工具自身禁止声明或复制密钥
- 图片只来自本轮经 `prepareTurnAttachments` 校验的绝对路径；该类型不进入 MCP `tools/list`
- 首版支持 OpenAI Chat Completions 兼容视觉格式；单图 20MB、单次总计 50MB、Provider 响应 1MB
- 成功结果以“不可信观察数据”注入当前用户消息；失败时移除文本模型无法消费的图片，并明确注入“未可靠检查、禁止猜测图片内容”

### 3.3 SQL 工具（M2，SQLite 先行）

```ts
interface SqlToolSpec {
  connection: { kind: 'sqlite'; databasePath: string } // 须过 SafeFileProtocol 路径白名单
  mode: 'readonly' | 'readwrite'
  sqlTemplate: string // 命名参数 :status / :limit，绝不字符串拼接
  limits: { maxRows: number /*默认 500*/ }
}
```

**安全细则**：

- SQLite 只读三重防线：`new Database(path, { readonly: true })` 只读打开 + 语句首词法检查（readonly 模式仅允许 `SELECT`/`WITH`/`EXPLAIN`）+ 迭代上限（取满 `maxRows+1` 即止并标记 truncated）
- 参数走 better-sqlite3 原生命名参数绑定（`'; DROP TABLE'` 类输入按值传递，天然免疫）
- 超时：`db.timeout`（busy）+ `setProgressHandler` 墙钟中断
- `readwrite` 模式强制 risk ≥ high-write + 保存时二次确认；M2 先只放开 readonly，readwrite 随审批流验证后放
- MySQL/PostgreSQL（`mysql2`/`pg` 新依赖）：**默认不做**，见开放问题 Q1

### 3.4 命令/脚本工具（M2）

```ts
interface CommandToolSpec {
  exec: {
    // 运行时名或白名单绝对路径；node/python 经 StandaloneNodeRuntime / Spark 制品解析
    command: string // 'python' | 'node' | '<workspace 内脚本的绝对路径>'
    argsTemplate: string[] // ['scripts/build_report.py', '--issue', '{{issueId}}']
    cwdMode: 'workspace-root' | 'tool-assets'
    envAllowlist: string[] // 显式白名单（如 ['PATH','LANG','PYTHONIOENCODING']），不继承全量
  }
  safety: { maxOutputBytes: number /*默认 1MB*/; killGraceMs: number /*默认 3000*/ }
}
```

**安全细则**：

- **`execFile` + argv 数组、`shell:false`**——参数值即使包含 `; && | $()` 也只是一个 argv 元素，注入在结构上不存在（FfmpegRunner 同款）
- 脚本文件路径必须落在 `SafeFileProtocol.getSafeFileAllowedRoots()`（workspace/userData/temp）内；工具资产目录 `{userData}/custom-tools/assets/<toolId>/`
- PowerShell 脚本只允许 `-File` + 类型化参数，**禁止 `-Command` 字符串**
- 超时 → SIGTERM → `killGraceMs` → SIGKILL（对齐 FfmpegRunner）；输出 stdout+stderr 截断到 `maxOutputBytes`
- 保存时用户必须逐工具确认授权（风险披露卡片：将执行什么、在哪执行）；risk 默认 low-write，用户可上调；destructive 级每次调用走审批卡片
- Windows 优先（本产品主力平台），node/python 解释器优先 Spark 自建制品（`artifacts_resolve`），缺失时引导安装而非放行系统 PATH 随意解析

### 3.5 提示词工具（M3）

```ts
interface PromptToolSpec {
  promptTemplate: string
} // '{{input}}' 等占位
```

无副作用，risk 固定 `read`、effect 固定 `read`。把高频提示词套路（代码评审清单、SQL 生成规范等）封装成可被 Agent 组合调用的工具。

### 3.6 复合工具（M3，评估项）

`steps: [{ toolId, inputFrom: { previous: '$.rows[0].id' } | literal }]` 线性链，审批风险取各步最大值。**实现前必须先与 workflow 引擎合流评估**（画布 workflow 已有编排/审批/条件节点，复合工具可能应该薄封装 workflow 而非自建状态机）。

---

## 4. 数据模型与协议

### 4.1 存储（`084_custom_tools.sql` + `088_custom_tool_provider_vision.sql`）

```sql
CREATE TABLE custom_tools (
  id TEXT PRIMARY KEY,                      -- slug
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http','sql','command','prompt','composite')),
  input_schema_json TEXT NOT NULL,
  spec_json TEXT NOT NULL,                  -- 含 secretRefs（仅引用，无明文）
  risk TEXT NOT NULL CHECK (risk IN ('read','low-write','high-write','destructive')),
  effect TEXT NOT NULL,
  idempotency TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  enabled INTEGER NOT NULL DEFAULT 0,       -- 导入的工具默认 0（待审）
  origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local','imported')),
  last_test_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE custom_tool_invocations (      -- 审计（M2 启用写入）
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT NOT NULL,
  session_id TEXT,
  turn_id TEXT,
  input_sha256 TEXT NOT NULL,               -- 不存完整输入输出（隐私+体积）
  status TEXT NOT NULL CHECK (status IN ('ok','error','timeout','denied')),
  duration_ms INTEGER NOT NULL,
  error_code TEXT,
  output_bytes INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_cti_tool_created ON custom_tool_invocations(tool_id, created_at);
```

配套 `packages/storage/src/repositories/custom-tool.repository.ts`（extends `BaseRepository`），从 `@spark/storage` 导出。zod 校验层拒绝 spec 内出现疑似密钥明文（复用 plugin 系统的 `SENSITIVE_METADATA_KEY` 嗅探）。

### 4.2 协议（`packages/protocol/src/custom-tools.ts`）

- 全部类型 + 每种 tool type 的 zod schema（拒绝分支是测试重点：未知 type、坏模板、明文密钥、risk 低于类型下限）
- `CustomToolsIpcSchemaRegistry`（照抄 plugin 域模式），spread 进 `IpcSchemaRegistry`
- IPC 通道：`custom-tools:list/get/create/update/delete/set-enabled/test-run/write-secret/has-secret/export/import`
- 删除工具 → 确认弹窗（破坏性操作规则）→ 级联删除密钥库条目（`PluginManager.uninstall` 先例）

### 4.3 变更事件

`CustomToolService.onChange` → `CustomToolsRuntimeService` 串行执行 `stop → update → start` → `McpService.onChange` bump `mcpVersion` → 下一 turn 生效。连续保存期间只保留必要的后续刷新，避免并发重连；工具数为 0 时把受管行 `enabled=0`。Provider Vision 变更也复用同一事件源，但执行发生在宿主路由而非 MCP 工具调用。

---

## 5. 执行与权限

### 5.1 执行器接口

```ts
interface CustomToolExecutor {
  readonly type: CustomToolType
  execute(spec: ResolvedSpec, input: unknown, ctx: ExecutorContext): Promise<ExecutorResult>
}
interface ExecutorResult {
  text: string // markdown，已截断
  meta: { durationMs: number; bytes: number; truncated: boolean }
}
// ExecutorContext: { signal: AbortSignal; resolveSecret(ref): Promise<string>; sessionId?: string }
```

`test-run`（编辑器 playground）与桥内 `call_tool` 走**同一个执行入口**——保证测试过的行为与线上一致。

### 5.2 权限模型：risk floor + 既有 profile 取严

| 工具 risk                | 调用时生效动作                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| read / low-write         | 完全跟随用户 permission profile 对 `mcp_tool` 的既有判定                                                                                 |
| high-write / destructive | **floor = ask**：即使 profile 是 allow 也弹审批卡片（卡片展示工具风险徽标、目标摘要——HTTP 显 url 模板、SQL 显语句首行、command 显 argv） |

实现落点：`custom-tool-policy.ts` 在桥的 invoke 入口做 floor 判定，审批交互复用 `permission.service` 的 `ask` 路径（`stream:permission:approval-request` → `InlineApprovalRequest` 卡片，30min 过期）。codex 侧 `spark_*` 前缀 server 默认 `default_tools_approval_mode: 'approve'` 已有兜底（W0 确认 `spark_custom_tools` 命中该规则）。审计行在每次 invoke 后落 `custom_tool_invocations`。

### 5.3 错误口径

对齐 `RuntimeErrorShape` 的 13 错误码风格，桥侧映射为 MCP tool error（超时/参数校验失败/密钥缺失/目标不可达/执行失败/被拒），LLM 可读且不泄露密钥与内部路径。

---

## 6. 双引擎接入

### 6.1 注册时序（应用启动）

1. Main 启动 `CustomToolsBridgeService`（127.0.0.1 随机端口 + 随机 bearer，生命周期随 app）
2. `CustomToolsRegistration.ensureRegistered(db)`：按当前端口/token 幂等 upsert 受管行 `{ scope:'managed', name:'spark_custom_tools', configJson: { type:'stdio', command: resolveStandaloneNodeRuntimePath(), args:[resolveRuntimeToolPath('custom-tools-mcp-server.mjs')], env: { SPARK_CUSTOM_TOOLS_BRIDGE_PORT, SPARK_CUSTOM_TOOLS_BRIDGE_TOKEN } }, enabled: <随工具数> }`（config 变化才写库，保留用户 enabled 偏好——Playwright 同款）
3. 熟路径：`copyRuntimeToolsPlugin` 打包规则已按目录拷贝 `src/tools/*.mjs`，新 .mjs 自动入包

### 6.2 每 turn 数据流

引擎拉起 stdio .mjs → .mjs 用 env 里的端口/token 连桥 `list_tools` → 返回当前启用工具（name/description/inputSchema）→ 引擎 `call_tool` → 桥 → policy floor 检查 → executor → 结果文本。工具 CRUD → mcpVersion bump → 下一 turn 子进程重启 → 新工具面。

### 6.3 W0 Spike（动工前置，0.5~1 天）

| #   | 验证项                                                                                                                      | 退出标准           |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| S1  | 受管行 configJson 的 `env` 经 `resolveMcpConfig` → claude `sdk.query` 子进程能收到（写最小 .mjs 打印 env 回传验证）         | 双引擎下工具可调用 |
| S2  | codex 三执行器（SDK/CLI TOML/OpenAI）对同一 stdio 行为处理一致（`buildCodexMcpConfig`/`writeCodexTempProfile` 的 env 透传） | 三路径全通         |
| S3  | `spark_custom_tools` 命中 codex 的 `default_tools_approval_mode:'approve'` 前缀规则（看匹配实现）                           | 命中或补适配       |
| S4  | 行 `enabled` 翻转 + env 更新 → mcpVersion bump → 下一 turn 生效（不需重启）                                                 | CRUD 热更新闭环    |

**备选路线 B**（S1/S2 失败时）：改走 `session-mcp-tooling-helpers.ts` 注册（同 `spark_memory` 模式），需在 session.service 两个 merge 块加条目——**必须排到 Phase 1 W2 合并之后**，工期顺延约 1 周。

### 6.4 W0 Spike 结论（2026-08-19 代码级验证，路线 A 定稿）

| #   | 结论                    | 关键证据                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | ✅ 通过                 | env 全链路透传：`config-normalize.ts:72-80` → `buildMcpServersForSDK`（session.service.ts 实测 5834-5856，每 turn 活读 mcp_servers 表）→ `claude-sdk-executor.ts:716/946`；SDK 类型 `McpStdioServerConfig.env` 兼容                                                                                                          |
| S2  | ✅ 通过（三可执行路径） | Codex SDK：`buildCodexMcpConfig` env 原样（codex-sdk-executor.ts:801）；App-Server 复用同函数；CLI TOML：`codex-cli-executor.ts:667-671` 序列化 env 段，`sanitizeConfigKey` 不伤 `SPARK_CUSTOM_TOOLS_*`。**OpenAI Chat Completions 路径本就无任何 MCP**（既有限制，非本方案缺口）                                            |
| S3  | ✅ 通过                 | `codexDefaultToolsApprovalMode` 两处实现均 `rawName.startsWith('spark_')`（codex-sdk-executor.ts:807、codex-cli-executor.ts:676），`spark_custom_tools` 必命中 approve                                                                                                                                                       |
| S4  | ⚠️ 机制完整，有一个断点 | onChange→mcpVersion bump→下一 turn `continueSession=false` 闭环存在（session.service.ts:1095/4377/4989；`lastBuiltMcpVersion` 初值 -1 使重启后首 turn 必然 fresh）。**断点：PlaywrightMcpRegistration 式裸 repo 写不 emit change**——运行中重写 configJson 不 bump。**约束 W1：注册/更新走 McpService（或显式触发变更通知）** |
| S5  | ✅ 通过                 | `electron.vite.config.ts:38-65` 通配拷贝 `src/tools/*.mjs` + electron-builder.yml:153-157 入包；`resolveRuntimeToolPath`（session-mcp-tooling-helpers.ts:51-68）；**configJson 读取链路无二次路径解析——command/args/env 必须注册时固化为最终值（绝对路径 + 当时端口）**                                                      |
| S6  | ✅ 参照                 | spark-memory-mcp-server.mjs：stdio JSON-RPC + `127.0.0.1:${PORT}/rpc`。**桥端口 listen(0) 每次启动随机 → 每次应用启动 ensureRegistered 重写 env（跨重启安全，S4 的 -1 机制兜底）**                                                                                                                                           |

**W1 硬约束**：① `CustomToolsRegistration` 不得完全照抄裸 repo 写，configJson 变化时须经 McpService 触发变更；② 注册时固化 command（`resolveStandaloneNodeRuntimePath()`）/args（`resolveRuntimeToolPath('custom-tools-mcp-server.mjs')`）/env（bridge 启动后的实际端口+token）；③ 桥服务须在注册前启动完成。

---

## 7. UI 设计（扩展中心 `CustomToolsSection.tsx`）

- **入口**：扩展中心内「自定义工具」独立页签，与 MCP、插件并列，不新增顶层导航噪音
- **列表页**：采用应用统一的**扁平化风格**——工具以分隔线组织，不叠加卡片容器、阴影或描边；hover 只改变底色。行内容包含类型图标、risk、启用开关、最近测试状态及 local/imported 来源标记；空态只提供通用“创建工具”入口，不突出任何具体业务模板
- **编辑器**（Drawer，窄屏可全屏）：
  - 基本信息区 → 类型选择（选定后不可改）→ 类型专属表单 → 参数 Schema 构建器（照抄 `ProviderManifestParameterEditor` 交互）→ 安全与超时 → 风险声明（编辑器给出类型建议值，只可上调）
  - 密钥字段：掩码输入 + 「写入密钥库」按钮，永不回显；`has-secret` 状态灯
  - 全状态覆盖：loading/校验错误/disabled（无密钥时禁用保存并提示）
- **测试运行**：右侧面板，参数表单（`CanvasParameterControl` 管线渲染）→ `custom-tools:test-run` → 展示原始响应 + 提取预览 + 耗时/字节数；high-write 以上需再点一次确认
- **导入导出**：单文件 JSON（`formatVersion` + 工具数组 + 密钥占位符显式标注）；导入后全部 `enabled=0` 且带「待审」徽标，逐个 review 后启用
- **首版已落地交互**：列表/搜索/刷新/启停/编辑/删除确认、通用创建入口、HTTP 与图像理解模板、Provider 优先选择“自部署图像理解”、测试图片选择、Cmd/Ctrl+S 保存；图像理解仅作为二级模板和端到端验收用例，不作为默认按钮、默认空态或默认创建入口；视觉样式采用扁平分隔线，不堆叠卡片容器

---

## 8. 分期计划

| 阶段                    | 内容                                                                                                                                                                                         | 工期     | 验收标准                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| **W0**                  | §6.3 spike S1-S4；确认/否决路线 A                                                                                                                                                            | 0.5~1 天 | 双引擎调用通；路线定稿                                             |
| **M1** 框架+HTTP+Vision | protocol 类型与 zod；084/088 迁移 + repo；CustomToolService；HTTP / Provider Vision 执行器；桥（.mjs + BridgeService）；CustomToolsRuntimeService；扩展中心基础 UI；宿主视觉路由；行为锁测试 | 已落地   | HTTP 工具双引擎可调用；文本模型图像回退；CRUD 热更新；安全用例全绿 |
| **M2** SQL+命令+审批    | SQLite 执行器（readonly）；命令执行器（argv/execFile/超时/白名单）；risk floor + 审批卡片联动；审计写入；导入导出                                                                            | ~1 周    | 三类型工具可用；注入/只读/超时攻击用例全绿；审计行完整             |
| **M3** 扩展（可选）     | prompt 工具；composite 与 workflow 合流评估；per-agent/per-workflow 启用粒度；MySQL/PG（若 Q1 通过）；readwrite SQL（随审批数据评估放行）                                                    | ~1 周    | 按选定项定                                                         |

单人串行预估：核心（W0+M1+M2）**约 2.5~3 周**。

---

## 9. 测试与安全验证清单

- **协议**：zod 拒绝分支矩阵（未知 type / 模板坏占位符 / 明文密钥嗅探 / risk 低于类型下限 / slug 冲突）
- **HTTP 执行器**（本地 mock server）：鉴权头注入、URL 编码、JSON body 结构注入样本（`"}}&c=` 类）必须产出合法 JSON 或校验拒绝、大小上限、超时、secretRef 缺失报错
- **Provider Vision**：Keychain 凭据、OpenAI vision 消息格式、图片数量/格式/大小、Provider 响应上限、非多模态 Provider 拒绝、原生多模态旁路、优先级稳定选择、失败闭合
- **SQL 执行器**：readonly 打开下 `INSERT/UPDATE/DELETE/ATTACH` 全拒；参数绑定注入样本（`'; DROP TABLE`）按值传递；maxRows 截断标记；不存在路径报错口径
- **命令执行器**：参数值含 `; && | $( ) backtick` 时仍是单 argv 元素（无 shell 解释）；超时强杀链路（TERM→grace→KILL）；输出截断；路径白名单外拒绝
- **Policy**：risk floor 矩阵（profile=allow × risk=high-write ⇒ ask）；审批拒绝路径；审计行落库
- **桥契约**：list_tools 随 CRUD 刷新；错误码映射；token 失效拒绝；Provider Vision 永不出现在 `tools/list`；stdio list/call 转发
- **集成**：`buildMcpServersForSDK` 含受管行（单测）；codex `buildCodexMcpConfig` 转换快照；既有行为锁 100/100 不回退
- **命令**：`pnpm --filter @spark/agent-runtime test:unit`（注意 sqlite-abi 双跑耗时×2）、desktop `pnpm -C apps/desktop run typecheck`、`verify:migrations`（迁移编号冲突在构建前拦截）

---

## 10. 与工程化 roadmap 及多 agent 并行的协调

- HTTP 热插拔链路不改既有内置工具注册；Provider Vision 仅在 `session.service` 当前 turn 的附件预处理位置增加一个宿主路由调用，原生多模态和无图 turn 保持原路径
- **触碰共享文件仅 4 处、均 ≤5 行**：① `ipc/index.ts` 挂 `registerCustomToolsIpc`（1 行，Phase 2 热区——挑安静窗口合入）② `protocol/src/ipc/index.ts` spread schema registry（1 行）③ `App.tsx` 路由+导航（2 行）④ `@spark/storage` 出口导出（2 行）。其余全为新文件；按惯例 worktree 物理隔离开发
- 与 Phase 2.2/2.3（protocol/ipc 拆分）无文件重叠，可并行；Phase 3 PermissionProfile 上线后，risk floor 语义与其正交叠加，不需要返工

---

## 11. 开放问题（待拍板）

| #   | 问题                                                                         | 建议                                                                                   |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Q1  | SQL 是否 M2 即带 MySQL/PostgreSQL（新依赖 `mysql2`/`pg`，包体+连接管理成本） | **先 SQLite-only**：零新依赖覆盖本地分析场景；远程库按真实需求再评估                   |
| Q2  | 命令工具授权粒度：保存时一次授权 vs 每次调用审批                             | 建议**保存时授权 + risk floor 兜底**（destructive 仍每次审批），纯每次审批会废掉易用性 |
| Q3  | 导入导出格式是否需兼容第三方（Dify/Coze/OpenAPI）                            | M1-M2 只做自家 JSON；兼容转换放 M3+ 按需求做                                           |
| Q4  | M1 是否需要 per-agent 启用粒度                                               | 建议**全局启用**（与用户自添 MCP 行为一致），per-agent 放 M3                           |

---

## 12. 风险与缓解

| 风险                                                 | 等级 | 缓解                                                                                                            |
| ---------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| W0 spike 推翻路线 A（env 透传在 codex CLI 路径断链） | 中   | 路线 B 已预置（排 W2 后），架构其余部分（executor/service/UI）不受影响                                          |
| stdio 桥随引擎每 turn 重启的冷启动开销               | 低   | 工具面通常 ≤10 个，list_tools 单次 RPC；实测超 50ms 再考虑常驻 HTTP 桥（`spark_plugins` 模式）                  |
| 用户把危险命令包装成工具并授信                       | 中   | 风险披露卡片 + risk 不可下调 + destructive 每次审批 + 审计表；导入工具默认禁用待审                              |
| 内网目标 SSRF（工具被 LLM 诱导改打内网其他地址）     | 中   | URL 参数结构化编码；用户可关闭私网访问，关闭后由 socket BlockList 同时约束 DNS 与重定向连接；分享功能上线前重审 |
| 图片提示词注入或任意路径读取                         | 中   | Provider Vision 不进入 MCP tools/list；只消费宿主本轮附件；结果标记为不可信观察数据，失败时禁止猜图             |
| better-sqlite3 ABI（electron/node 双跑）             | 低   | 沿用现有 sqlite-abi 测试包装，无新增原生依赖                                                                    |
