# MCP 远程服务器 OAuth 2.1 授权支持方案

> 状态: 待开发 | 最后核对: 2026-07-05

## 一、说明（背景与目标）

### 背景

当前 Spark-Agent 的 MCP 管理只支持「无认证」或「静态 header/token」的远程服务器。而越来越多的托管 MCP（OpenRouter、GitHub 官方 MCP、Linear、Notion 等）采用 **MCP 授权规范**要求的 OAuth 2.1 + PKCE + 动态客户端注册（DCR）流程：

- 未认证请求先返回 `401`，`WWW-Authenticate` 头指向受保护资源元数据（RFC 9728）。
- 客户端做 discovery，动态注册（RFC 7591），浏览器弹出用户同意页，PKCE 换取 access/refresh token。
- 以 OpenRouter 为例：拿到的是一把专属 API key（7 天过期、$10 默认额度），必须走浏览器授权，**填 URL 无法直接连**。

现状核查（已确认）：

- 我们依赖的 `@anthropic-ai/claude-agent-sdk` 的公开 `Query` 接口**只暴露** `mcpServerStatus()` / `reconnectMcpServer()` / `toggleMcpServer()` / `setMcpServers()`，**没有** 编程式的 `authenticateMcpServer()`。`/mcp` 里点「Authenticate」触发的浏览器授权是 Claude Code **交互式 CLI 自己的终端 UI**，我们走程序化 `query()` 够不到。→ **不能指望 SDK 帮我们完成授权。**
- 但 `SDKMcpServerConfig.headers` 支持静态头。→ **我们只要自己完成一次授权拿到 access token，把它当 `Authorization: Bearer` 注入 headers，SDK 侧即可正常连接。**
- `@modelcontextprotocol/sdk@1.29.0`（已在 `packages/agent-runtime` 依赖里）**自带完整 client OAuth 能力**：`auth()` 高层编排（discovery + DCR + PKCE + token 交换/刷新）、`OAuthClientProvider` 接口、`StreamableHTTPClientTransport({ authProvider })` 内置 401→刷新→触发授权。→ **不引入新依赖，只实现存储/跳转接口。**

### 目标

1. 支持给任意 http/sse 远程 MCP 服务器完成 OAuth 2.1 授权（含 DCR），拿到并安全持久化 access/refresh token。
2. agent 会话、内部管理页（状态/工具列表）两条消费路径都能用上授权后的 token。
3. token 到期前**主动提前刷新**；刷新失败/被吊销时把服务器标为 `needs-auth`，引导用户重新授权。
4. 服务器不支持 DCR 时提供**手填 client_id/client_secret 的降级 UI**。
5. 全程可离线复现测试：提供一个要求 OAuth 的本地调试 MCP server。

### 非目标

- 不实现 OAuth 授权服务器端（我们只做 client）。
- 不改变 agent 注入的整体架构（仍走 `buildMcpServersForSDK` → SDK 自连）。
- 不支持 client_credentials / device code 等非交互流程（本期只做 authorization_code + PKCE；预留接口）。

---

## 二、功能需求设计

### 2.1 数据模型

MCP server 配置（`mcp_servers.config_json`）在现有 `{ transport, url, headers }` 基础上新增 `auth` 段：

```jsonc
{
  "transport": "http",
  "url": "https://mcp.openrouter.ai/mcp",
  "auth": {
    "type": "oauth2",              // 'none'(默认) | 'oauth2'
    "scope": "",                    // 可选，OAuth scope
    "dcr": true,                    // 是否允许动态注册（默认 true）
    "clientId": "",                 // 降级：手填的静态 client_id（dcr=false 时必填）
    "hasClientSecret": false        // 仅标记，secret 本身不落 config，存 keychain
  }
}
```

**token 与敏感凭据不写入 `config_json`**，另存安全存储（见 2.4）。`config_json` 只保留「需要 OAuth」的声明与非敏感元数据。

### 2.2 授权状态机

每个 server 的授权态（在内存/查询时计算，不落 config）：

```
unconfigured → (声明 oauth2) → needs-auth → (用户点授权/浏览器同意) → authorizing → authorized
authorized → (token 快过期) → refreshing → authorized
authorized → (refresh 失败/401 吊销) → needs-auth
```

对外暴露的状态枚举与 SDK 对齐并扩展：`connected | needs-auth | authorizing | failed | disabled | pending`。

### 2.3 用户流程（UI）

**A. 新建/编辑带 OAuth 的 MCP（McpView 抽屉）**

1. 传输选 http/sse 后，出现「认证方式」选择：`无` / `OAuth 2.0`。
2. 选 OAuth 后展开：
   - 「授权范围 scope」（可选）
   - 「动态注册」开关（默认开）。关掉后出现降级字段：`Client ID`（必填）、`Client Secret`（可选，password 输入）。
3. 保存后卡片显示 `● 需要授权` 角标 + 「连接授权」按钮。

**B. 授权（点「连接授权」）**

1. 前端 `mcp:authorize({ id })` → 主进程启动授权：
   - 起临时 loopback callback server（`http://127.0.0.1:<随机端口>/callback`）。
   - `auth(provider, { serverUrl })` 触发 discovery + DCR + 构造授权 URL。
   - `shell.openExternal(authUrl)` 打开系统浏览器。
   - 前端进入「等待浏览器授权…」loading（可取消）。
2. 用户在浏览器同意 → 重定向到 loopback，callback server 收到 `code` + `state`。
3. 校验 `state`，`auth(provider, { serverUrl, authorizationCode: code })` 换取 token → 存储。
4. 关闭 callback server，前端收到 `mcp:auth-changed` 事件刷新为 `● 已授权`，自动 `reconnect`。

**C. 重新授权 / 断开**

- `needs-auth` 或 `failed` 时卡片显示「重新授权」；成功过的显示「断开授权」（清除 token + client 注册信息）。

**D. agent 侧可见性**

- `mcp_status` 平台工具返回真实态：授权缺失时返回 `needs-auth`（附带一句「请在 MCP 设置页点击授权」），而非笼统 `disconnected`，避免 agent 误判/误报。

### 2.4 安全存储

复用现有 [`TokenStore`](../apps/desktop/src/main/services/Auth/TokenStore.ts)（keytar 主存 + Electron `safeStorage` 加密备份）的模式，**参数化为按 server 维度的多实例**：

- keychain service 名：`spark-mcp-oauth:<serverId>`
- 存储项：`tokens`（access/refresh/expires_at）、`client_information`（DCR 结果 client_id/secret）、`discovery_state`（缓存 discovery，避免每次连都打 discovery）。
- `code_verifier`：授权流程期间的短期值，进程内存即可（一次授权生命周期内有效），不落盘。

---

## 三、技术开发方案

### 3.1 依赖选型

| 能力 | 方案 | 说明 |
|---|---|---|
| OAuth 编排（discovery/DCR/PKCE/交换/刷新） | `@modelcontextprotocol/sdk` 的 `client/auth.js` `auth()` | **已在依赖**，零新增 |
| 带授权的 HTTP transport | `@modelcontextprotocol/sdk` 的 `StreamableHTTPClientTransport({ authProvider })` | 内部 client 远程连接切到官方 transport |
| 浏览器跳转 | Electron `shell.openExternal` | 仓库已用 |
| callback 接收 | Node `http.createServer` loopback | RFC 8252 原生应用标准做法 |
| 安全存储 | keytar + `safeStorage`（复用 TokenStore 模式） | 已有 |

> 结论：**不引入 openid-client 等新依赖**，全部复用现有依赖，最大化省力。

### 3.2 新增/改动模块

**① `packages/agent-runtime/src/mcp/oauth/oauth-provider.ts`（新增）**

实现 `OAuthClientProvider` 接口（对接官方 `auth()`）：

```ts
class SparkMcpOAuthProvider implements OAuthClientProvider {
  constructor(serverId, redirectUrl, store /* 存储后端 */, staticClient? /* 降级用 */) {}
  get redirectUrl() { return this.redirectUrl }
  get clientMetadata() { return { client_name: 'Spark Agent', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code','refresh_token'], token_endpoint_auth_method: 'none', scope } }
  clientInformation()      // 读 store.client_information；降级模式返回手填 clientId/secret
  saveClientInformation()  // DCR 结果落 store
  tokens()                 // 读 store.tokens
  saveTokens()             // 落 store（含 expires_at 计算）
  redirectToAuthorization(url) // → 记录 url，交给授权服务去 openExternal
  saveCodeVerifier()/codeVerifier() // 进程内存
  saveDiscoveryState()/discoveryState() // 落 store，加速后续
  invalidateCredentials(scope)  // 刷新失败/吊销时清理，触发 re-discovery / re-auth
}
```

**② `packages/agent-runtime/src/mcp/oauth/oauth-store.ts`（新增，抽象层）**

- 定义存储接口 `McpOAuthStore`（get/save/clear tokens、client info、discovery state）。
- agent-runtime 侧给一个内存实现（供测试）；真正的 keychain 实现放 desktop 主进程（依赖 Electron），通过依赖注入传入，保持 agent-runtime 不直接依赖 electron。

**③ `apps/desktop/src/main/services/mcp-oauth/McpOAuthService.ts`（新增）**

- `authorize(serverId)`：起 loopback callback server → 调 `auth()` → openExternal → 等 callback → 二次 `auth(code)` → 存 token → 关 server。含超时（如 3 分钟）与取消。
- `refreshIfNeeded(serverId)`：读 token，`expires_at - now < 阈值(如 120s)` 时用 refresh token 刷新（走官方 `refreshAuthorization` 或再跑一次 `auth()`）。
- `getAccessToken(serverId)`：返回有效 access token（内部先 `refreshIfNeeded`）。
- keychain 存储实现（`TokenStore` 多实例化）。

**④ `packages/agent-runtime/src/mcp/mcp-client.ts` / transport（改动）**

- 内部 `McpClient` 的远程连接：当 `auth.type==='oauth2'` 时，改用官方 `StreamableHTTPClientTransport({ authProvider })`，天然获得自动刷新 + 401 处理。无 OAuth 时仍走现有手写 `StreamableHttpTransport`（今天已修）。
- 用 adapter 把官方 transport 包成我们的 `McpTransport` 接口，或让 `McpClient` 直接支持官方 transport 实例（二选一，倾向 adapter，改动小）。

**⑤ `packages/agent-runtime/src/services/session.service.ts` `buildMcpServersForSDK`（改动）**

- 遍历时若 server 声明 oauth2：调 `mcpOAuthService.getAccessToken(id)`（含主动提前刷新）。
  - 有效 → 注入 `headers.Authorization = 'Bearer <token>'`。
  - 拿不到（needs-auth）→ **跳过该 server 注入**并记录，避免把一个必然 401 的服务器塞给 SDK 造成噪音。
- 该方法改为 async（当前同步）；核对所有调用点（主会话、team 成员、workflow host）改 await。⚠️ **高影响面，需回归。**

**⑥ `platform-bridge.service.ts` `mcpStatus` / `mcpCreate`（改动）**

- `mcpStatus` 增加 `needs-auth` 判定（token 缺失/过期不可刷新）。
- 授权相关操作**不**开放给 agent 自动执行（授权必须用户在浏览器手动同意），agent 只能读状态并提示用户。

**⑦ IPC + Protocol（改动）**

- 新增 `mcp:authorize`、`mcp:deauthorize`、`mcp:auth-status`，以及 `stream:mcp:auth-changed` 事件。
- `@spark/protocol` 增补对应请求/响应类型与 `config_json.auth` 的类型定义。

**⑧ McpView.tsx（改动）**

- 抽屉加「认证方式 / scope / 动态注册 / client_id / client_secret」字段。
- 卡片加授权状态角标与「连接授权 / 重新授权 / 断开授权」按钮 + 等待授权 loading/toast。

### 3.3 授权时序（authorization_code + PKCE + DCR）

```
用户点授权
  └─ McpOAuthService.authorize(serverId)
       ├─ 起 loopback: http://127.0.0.1:PORT/callback
       ├─ auth(provider, { serverUrl })
       │    ├─ discoverOAuthProtectedResourceMetadata (RFC 9728)
       │    ├─ discoverAuthorizationServerMetadata
       │    ├─ registerClient (DCR, RFC 7591) → saveClientInformation
       │    ├─ PKCE: 生成 verifier/challenge → saveCodeVerifier
       │    └─ redirectToAuthorization(authUrl) → shell.openExternal
       ├─ 浏览器：用户同意 → 302 到 loopback?code=...&state=...
       ├─ callback server 收 code，校验 state
       ├─ auth(provider, { serverUrl, authorizationCode: code })
       │    └─ exchangeAuthorization → saveTokens(access+refresh+expires_at)
       └─ 关 loopback，广播 mcp:auth-changed，reconnect
```

### 3.4 主动提前刷新策略

- **注入前刷新**：`buildMcpServersForSDK` 对每个 oauth server 调 `getAccessToken`（内部 `refreshIfNeeded`，阈值 120s）。
- **定时后台刷新**（可选增强）：对已授权 server 起一个到期前定时器提前刷新，减少 turn 首字延迟。本期至少做「注入前刷新」，定时刷新列为增强。
- 刷新失败 → `invalidateCredentials('tokens')` → 标 `needs-auth` → 广播事件。

---

## 四、注意事项

1. **agent-runtime 不能直接依赖 electron**：keychain 存储与 `shell.openExternal` 必须放 desktop 主进程，通过依赖注入把 `McpOAuthStore` / 授权触发器传进 agent-runtime。保持包边界。
2. **`buildMcpServersForSDK` 改 async 是高风险点**：它被主会话、team 成员、workflow host 多处调用（见 `session.service.ts` 2485/3054/5031 一带）。必须逐一改 await 并跑全量 session 相关回归。
3. **loopback 安全**：callback server 只监听 `127.0.0.1`、随机端口、单次使用即关、强校验 `state`（防 CSRF）、设超时（3 分钟无回调则放弃并提示）。redirect_uri 用 `http://127.0.0.1:PORT/callback`（OAuth 允许 loopback 明文 http）。
4. **端口冲突/防火墙**：随机端口 + 失败重试；macOS 首次可能弹网络权限，文档提示。
5. **token 泄露面**：access token 会进 SDK 传给 Claude Code CLI 子进程的 mcp 配置（headers）。确认该配置不落日志、不进 checkpoint、不随会话导出。审查 `claude-sdk-executor` / `codex-*-executor` 的配置日志打印。
6. **7 天过期（OpenRouter 特性）**：refresh token 也可能整体过期，届时只能重新授权。UI 要能从 `needs-auth` 平滑走重新授权，不需要用户先删再建。
7. **DCR 不被支持时**：`registerClient` 会失败；provider 的 `clientInformation()` 要能回退到用户手填的 `clientId/secret`（降级 UI），并跳过 `saveClientInformation`。
8. **discovery 缓存失效**：连续认证失败时用 `invalidateCredentials('discovery')` 清缓存，防止授权服务器地址变更后一直用旧的。
9. **多实例 McpService 一致性**：本次前置修复已让 SessionService 复用 IPC 单例 McpService；OAuth 的 token 存储也要保证单一真源（keychain），避免两处各存一份。
10. **codex 路径**：codex CLI/SDK 通过 TOML 注入 `mcp_servers.<name>.headers.*`（见 `codex-cli-executor.ts` 544 一带）。确认注入的 Authorization header 对 codex 同样生效；codex 自身若也想跑 OAuth 由它自己处理，不在本期。

---

## 五、测试与验收标准

### 5.1 单元测试

- `SparkMcpOAuthProvider`：clientMetadata 正确；tokens/clientInformation/discoveryState 读写；降级模式返回手填 client；`invalidateCredentials` 各 scope 行为。
- `McpOAuthService.refreshIfNeeded`：未过期不刷新；将过期触发刷新；刷新失败标 needs-auth。
- `buildMcpServersForSDK`：oauth server 有效 token → 注入 Bearer；needs-auth → 跳过；非 oauth server 不受影响。
- token 存储（keychain 实现）：save→load→clear 往返；keytar 不可用时降级 safeStorage。

### 5.2 集成 / 端到端（可离线复现）

- 扩展 [`scripts/debug-mcp`](../scripts/debug-mcp)：新增 `oauth-http-server.mjs`——一个要求 OAuth 的本地 MCP（自带最小 authorization server：401 引导 + `/authorize` 自动同意回跳 + `/token` 交换/刷新 + DCR 端点）。
- 用它跑完整链路：未授权连接 → 触发授权（自动同意，无需真人点浏览器）→ 拿 token → tools/list → tools/call 成功；token 过期 → 刷新成功继续调用；refresh 失效 → 标 needs-auth。
- 复用今天的 `mcp-debug-e2e.test.ts` 风格，**不 mock transport**，真起本地 server。

### 5.3 真机验收（OpenRouter）

1. McpView 新建 openrouter（http + oauth2 + DCR 开）。
2. 点「连接授权」→ 浏览器打开 OpenRouter 同意页 → 同意 → 卡片变「已授权」。
3. 新开 agent 会话，agent 能看到并调用 `mcp__openrouter__models-list` / `ping` 等工具并返回真实数据。
4. `mcp_status` 对 openrouter 返回 `connected`（授权前返回 `needs-auth`）。
5. 等接近过期（或人为改短阈值）验证自动刷新，工具调用不中断。
6. 在 OpenRouter dashboard 吊销该 key → 下次调用被标 `needs-auth`，UI 可一键重新授权。

### 5.4 验收 Checklist

- [ ] OAuth（含 DCR）授权成功，token 安全落 keychain（非 config_json）。
- [ ] agent 会话可调用授权后的远程 MCP 工具。
- [ ] 主动提前刷新生效，过期不中断。
- [ ] 刷新/吊销失败正确降级为 needs-auth 并可重新授权。
- [ ] DCR 不支持时手填 client_id/secret 可用。
- [ ] `mcp_status` 对 agent 返回真实态（needs-auth/connected），不误报。
- [ ] 授权 token 不出现在任何日志/导出/checkpoint。
- [ ] 全量 `pnpm --filter @spark/agent-runtime typecheck` + `@spark/desktop typecheck` + 相关单测通过。
- [ ] loopback callback 有 state 校验、超时、单次关闭。
- [ ] 离线调试 server 的端到端测试进 CI。

---

## 六、工作量估算

| 阶段 | 内容 | 估时 |
|---|---|---|
| 1 | OAuthClientProvider + store 抽象（复用官方 auth()） | 1 天 |
| 2 | McpOAuthService：loopback + authorize + refresh + keychain 存储 | 1.5 天 |
| 3 | 内部 McpClient 接官方 StreamableHTTPClientTransport(authProvider) | 0.5 天 |
| 4 | buildMcpServersForSDK 改 async + 注入 Bearer + 全量调用点回归 | 1 天 |
| 5 | IPC/protocol/platform-bridge 接线 + 状态语义 | 0.5 天 |
| 6 | McpView UI（认证方式/DCR 降级/授权按钮/状态） | 1.5 天 |
| 7 | 离线 OAuth 调试 server + 单测 + 集成测 + 真机冒烟 | 1.5 天 |
| **合计** | | **约 7.5 天** |

> 相比无现成依赖的估算（引入 openid-client 或全手写 OAuth 约需额外 2–3 天），复用 `@modelcontextprotocol/sdk` 自带的 OAuth 客户端后，阶段 1 从 ~2 天压到 ~1 天，且大幅降低协议实现出错风险。

---

## 七、前置依赖与关联

- 依赖已落地的「http 传输 + transport/type 字段归一 + 写入校验 + McpService 单例复用」修复（本轮改动，见 `packages/agent-runtime/src/mcp/config-normalize.ts`、`streamable-http-transport.ts`、`session.service.ts` MCP 相关改动）。
- 关联记忆：[[内置联网搜索]]（MCP 挂载机制）、本方案落地后应更新 MCP 相关文档与 agent 工具说明。
