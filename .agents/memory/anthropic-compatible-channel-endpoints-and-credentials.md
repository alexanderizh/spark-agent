# Anthropic 兼容渠道：端点写法与凭据投放经验

> 记录日期: 2026-09-20
> 适用范围: Claude 适配器（claude-sdk-executor）、spark 引擎 / spark CLI anthropic 路由、渠道连接探测、模型列表、会话标题/分支名/画布文本生成、桌面端 CLI 桥与子应用网关

## 一、端点有三种合法写法，用之前必须归一化

渠道 `apiEndpoint` 允许三种写法，历史上各调用点各写一套判断，导致同一份渠道配置在
不同功能里表现不一致：

| 写法                                 | 示例                                            |
| ------------------------------------ | ----------------------------------------------- |
| 根地址（推荐，Claude Code 文档写法） | `https://api.stepfun.com/step_plan`             |
| 版本地址                             | `https://openrouter.ai/api/v1`                  |
| 完整 messages 地址                   | `https://api.stepfun.com/step_plan/v1/messages` |

规则（`@spark/shared/anthropic-endpoint.ts`）：

- **`ANTHROPIC_BASE_URL`（claude CLI / Agent SDK）必须传裸根地址**：SDK 会自行追加
  `/v1/messages`。把完整 messages 地址原样塞进去会请求
  `…/v1/messages/v1/messages` → 404 空体，而 CLI 的错误信息会误导为
  「There's an issue with the selected model (xxx). It may not exist or you may not have access
  to it.」——表现为「claude 适配器不可用」，但根因是端点没归一化。
  用 `resolveAnthropicBaseUrl()`。
- **直连 HTTP 调用**需要「恰好一个 `/v1/messages`」→ `resolveAnthropicMessagesUrl()`。
  多数老调用点已有 `if (base.endsWith('/v1/messages')) return base` 去重逻辑，
  新代码不要再手写这段判断。
- 模型列表候选 URL 也要先摘掉 `…/v1/messages`，否则会派生
  `…/v1/messages/v1/models` 这类必然 404 的候选。

## 二、凭据投放：第三方渠道双投放，官方渠道单投放

- `ANTHROPIC_API_KEY` → HTTP `x-api-key`；`ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer`。
- 国产端点官方文档（阶跃 `step_plan`、GLM、Kimi、MiniMax）多写 `ANTHROPIC_AUTH_TOKEN`，
  中转站多写 `ANTHROPIC_API_KEY`，只投一种会出现「key 正确但 401」。
- 规则（`@spark/shared/anthropic-auth.ts`）：
  - 非 `*.anthropic.com` 端点：两个环境变量/两个请求头同时投放，渠道按自己支持的那个取用。
  - 官方端点：单投放，`sk-ant-oat*`（OAuth token）走 Bearer，其余走 `x-api-key`。
- 依据：claude CLI 在同时设置两个环境变量时，客户端也是同时发送 `X-Api-Key` 与
  `Authorization: Bearer`（内置 SDK `authHeaders()` 合并两组头）；CLI 自身还会在
  TUI 提示「Both … set · auth may not work as expected」，官方把双凭据视为「可能不符合
  预期但可用」。
- 注入前先清掉 customEnv/宿主继承里残留的同名认证键，避免残留 token 与新凭据并存
  （历史上 401 的常见来源）。
- `useLocalConfig`（本地 CLI provider）路径不注入任何认证键，保持宿主配置。

## 三、实测方法与陷阱

- 用真实凭据对自己的端点做最小 `max_tokens: 1` 的 `/v1/messages` POST，可以区分
  401（鉴权）、404（路径/模型）、429（限流）。注意 429 经常是账号级并发限制
  （阶跃会返回 `scene-global concurrency reached`），不代表渠道配错。
- 复现 claude 适配器问题时，直接用内置 CLI 复现最快：

  ```bash
  CLI=node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude
  env -i PATH="$PATH" HOME="$HOME" \
    ANTHROPIC_BASE_URL='<裸根地址>' ANTHROPIC_API_KEY='<key>' ANTHROPIC_MODEL='<model>' \
    "$CLI" --print --setting-sources project "reply with exactly: ok"
  ```

  `--setting-sources project` 与 `claude-sdk-executor` 的 `settingSources: ['project']` 对齐；
  不加这个参数时 CLI 会读宿主 `~/.claude/settings.json` 的 env 块，把 `ANTHROPIC_BASE_URL`
  等覆盖掉，导致测试结果与 app 内行为不一致。

- 应用日志位于 `~/Library/Logs/@spark/desktop/main.log`；`provider.service` 的
  `testConnection` / `fetchModels` 日志是判断「渠道本身可用、还是 app 侧拼错了路径」的
  第一手证据（内置 testConnection 会去重 `/v1/messages`，因此它成功并不能证明适配器路径正确）。

## 四、CLI 侧（spark CLI / spark 引擎）同样的两个问题与处置

CLI 与桌面端走的是**不同**的两条 anthropic 调用链，但缺陷形态相同，修的时候要一起看：

| 链路                                                                | 上游调用                      | 凭据来源                                              | 端点归一化位置                                         |
| ------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| `spark` CLI（`spark-engine/src/llm/anthropic/messages.ts`）         | 自己发 HTTP                   | `api_key_env` 指向的环境变量                          | `messagesEndpoint()`                                   |
| 桌面端 spark 引擎（`packages/agent-runtime/src/sdk/spark-engine/`） | 同上，代码就是 `@spark/agent` | 渠道 Key（keystore）经 `registerHttp` 传入            | 同上                                                   |
| Claude 适配器（claude-sdk-executor → claude CLI）                   | SDK 子进程                    | `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` 环境变量 | `buildIsolatedRuntimeEnv()` 写 `ANTHROPIC_BASE_URL` 前 |
| 桌面 Spark CLI 桥（`SparkCliBridgeService`）                        | 桥代 CLI 转发                 | 桥侧解析渠道 Key                                      | `upstreamUrl()`                                        |
| 本地 Claude CLI provider（`useLocalConfig`）                        | 宿主 `claude` CLI 自己发      | 宿主环境 / `~/.claude/settings.json`                  | **不注入**，保持宿主原样                               |

- **桌面 spark 引擎的代码就是 `spark-engine/dist`**（`apps/desktop/electron.vite.config.ts`
  把 `@spark/agent` 打进 main bundle，入口指向 `spark-engine/dist`）。
  改完 spark-engine 源码后**必须 `cd spark-engine && npm run build`**，否则 CLI 与桌面
  spark 引擎仍跑旧逻辑——这是「源码已修但现象还在」的最常见原因，排查时先比
  `dist/*.js` 与源码的 mtime，再 grep 产物里是否已有新分支。
- CLI 的凭据变量名历史上是「配什么用什么」：`api_key_env` 缺省为 `ANTHROPIC_API_KEY`，
  取不到就 fail closed，于是「按厂商文档只 export 了 `ANTHROPIC_AUTH_TOKEN`」会直接报
  `requires credential environment variable ANTHROPIC_API_KEY`。现在：
  - `api_key_env` 等于该协议默认名（anthropic-messages → `ANTHROPIC_API_KEY`）时，
    回退接受 `ANTHROPIC_AUTH_TOKEN`；
  - 显式写了别的变量名（如 `STEPFUN_TOKEN`）时**不回退**，保持字面语义；
  - 两个都没有时错误信息同时列出两个名字，用户不必猜。
- CLI 侧请求头已改为与桌面端同一套规则（`spark-engine/src/llm/anthropic/auth-headers.ts`，
  与 `@spark/shared/anthropic-auth` 等价实现——spark-engine 独立发布，不引 workspace 依赖）。
- 桥（`SparkCliBridgeService`）的 anthropic 上游地址改为复用
  `resolveAnthropicMessagesUrl()`：裸 `/messages` 也要收敛，否则会拼出
  `…/messages/v1/messages`。CLI 侧的令牌不会透传到上游——桥用 `headers.set()` 覆盖成渠道凭据。
- 排查 CLI 侧问题时的低成本自检：`spark models` 看路由、`spark doctor` 看桥连接状态；
  单元测试里可以用本地 `node:http` 起一个假上游，断言**实际请求路径**恰好是
  `<base>/v1/messages` 且同时带 `x-api-key` 与 `Authorization`（见
  `spark-engine/test/unit/model-config.test.ts`）。

## 五、阶跃星辰预设端点（易错点）

- 无 Key 探测**无法**区分路径对错：`https://api.stepfun.com/v1/messages` 与
  `https://api.stepfun.com/step_plan/v1/messages` 都只回 401 `invalid_api_key`，
  而裸根 `https://api.stepfun.com/step_plan` 回 404（根上只有文档站）。
- 编码套餐（Claude Code 计划）的 Key 实测在 `…/step_plan/v1/messages` 返回 200；
  `https://api.stepfun.com` 裸根形式**未经实测**，因此渠道预设取
  `apiEndpoint = "https://api.stepfun.com/step_plan"`（`packages/protocol/src/provider-presets.ts`）。
  若以后确认通用 API 的 Key 也能在裸根 `/v1/messages` 工作，再按实测结果调整预设。
- 同类预设都要遵守「给根地址、由调用点补 `/v1/messages`」的约定，不要直接写完整
  messages 地址（虽然现在也能跑，但会让每次 review 都要重新确认一遍）。
