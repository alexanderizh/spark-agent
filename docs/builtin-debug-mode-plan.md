# Spark 调试模式（Debug Mode）—— 开发计划（交付文档）

> 状态: 已落地（长驻日志服务 + spark_debug MCP + skill + 前端 toggle/快捷回复已上线） | 最后核对: 2026-06-19
>
> **本文档面向执行 agent**。请按阶段顺序实施，每阶段完成后对照「验收条件」自检；未通过不要进入下一阶段。
> 修改任何现有 symbol（尤其 `session.service.ts`）前**必须**先运行 `impact({target: "符号名", direction: "upstream"})`，HIGH/CRITICAL 风险需在 commit message 中说明。
> 本项目核心运行时是 **Claude CLI（claude-sdk-executor）**，调试模式必须与该 turn 制对话模型契合，不引入常驻 agent。

---

## 一、Context（为什么做、做成什么样）

对标 Cursor 的「debug 模式」，但更克制：**不假装 agent 能复现 bug，把"复现"交回用户，agent 只闭环自己擅长的"假设 / 插桩 / 读日志 / 分析 / 修复 / 清理"**。

### 人机协作状态机

```
[1 收集]  用户描述 bug
   ↓
[2 假设]  agent 读代码 → 形成假设 → 决定插桩点
   ↓
[3 插桩]  改代码，注入带「本轮唯一标记」的 debug 日志（上报到本地日志服务）
   ↓
[4 等待]  通知用户「请复现」→ 结束本 turn（agent 不常驻）
   ↓           ← 本地 HTTP 日志服务在后台持续接收
[5 确认]  用户点「已复现」/ 说复现完了 → 触发下一 turn
   ↓
[6 分析]  agent 拉取「本轮」日志 → 验证 / 推翻假设
   ↓
   ├─ 假设成立 → 改代码修复 → 再插一轮「验证日志」 → 回 [4]
   └─ 假设不成立 → 新假设 → 调整插桩 → 回 [4]
   ↓
[7 验收]  用户点「已解决 / 没解决」
   ↓
   ├─ 解决  → [8 交付]
   └─ 没解决 → 回 [6]
   ↓
[8 交付]  清除所有 debug 插桩 → grep 校验零残留 → 提交成果
```

### 硬性约束

- **日志服务长生命周期**：HTTP 接收服务必须活在**跨 turn 的长驻进程**里（agent-runtime 单例），不能放在 per-session 的 stdio MCP 子进程里——否则用户"两 turn 之间去复现"时 buffer 会丢。
- **允许跨域（CORS）**：浏览器内 / webview / 前端项目的 bug 日志是从**别的 origin**（`localhost:3000` / `file://` / `https://...`）发起的，**必须正确处理 CORS 预检与 Private Network Access**，否则浏览器侧日志一条都收不到。详见附录 A。
- **轮次可追溯**：每批插桩带 `sid + round + tag`，日志按此分桶；agent 只读「当前轮」，不被上一轮残留污染。
- **可清理性**：插桩用统一可识别标记包裹，交付时按标记批量删 + grep 校验**零残留**。
- **不破坏宿主应用**：插桩上报必须 `try/catch` + 静默失败 + `keepalive`，绝不能因日志服务挂了而影响被调试的 app。
- **仅监听 127.0.0.1**：日志服务只绑回环地址，端口动态分配，token 隔离 session。
- **可整体关闭**：调试模式是 **per-session 开关**，default off，关闭后行为与现状完全一致（不注入 MCP、不起服务、不注入 prompt、不显示快捷回复）。

---

## 二、开关形态决策（已定）

**调试模式 = per-session 能力开关，与权限模式下拉「并列」，不是权限枚举里的一个值。**

理由：
- 权限模式（`SessionPermissionMode`：`claude-ask` / `claude-auto-edits` / `claude-plan` / `claude-auto` / `claude-bypass`，见 `apps/desktop/src/renderer/design/utils/permission-options.ts`）是**互斥单选**，语义是"工具执行的批准强度"。
- 调试模式与之**正交**：用户会想"调试模式 + ask 权限"或"调试模式 + auto-edits"组合。塞进权限枚举会逼出假二选一。
- 调试模式本质是"激活一套能力"（挂 debug MCP + 起日志服务 + 注入状态机 prompt + 显示快捷回复），是能力开关不是权限档位。

落地：
- session 新增布尔状态 `debugMode`（protocol 类型 + DB 持久化 + `session:update` IPC）。
- composer 工具栏在权限下拉**旁边**放独立 toggle，default off。
- **不做全局 settings 总闸**（保持简单）。per-session toggle 即唯一开关。
- `debugMode === true` 同时是**快捷回复按钮的显示条件**。

---

## 三、架构与组件

| 组件 | 位置 | 生命周期 | 职责 |
|------|------|---------|------|
| **DebugLogServer**（HTTP 日志服务） | `packages/agent-runtime/src/services/debug-log-server.service.ts` | 长驻单例（懒启动，跨 turn 存活） | 收日志（CORS）、内存 ring buffer、轮次/假设状态、按 sid+round 检索 |
| **debug MCP server**（stdio 桥接） | `packages/agent-runtime/src/tools/debug-mode-mcp-server.mjs` | per-session 子进程 | 把 agent 工具调用代理到 DebugLogServer 的 localhost HTTP 接口 |
| **spark-debug skill** | `apps/desktop/resources/skills/spark-debug/{SKILL.md,manifest.json,references/}` | 静态 | 承载状态机提示词、插桩规范、各语言上报片段 |
| **前端 toggle + 快捷回复** | `ChatPanel.tsx` / `CanvasAgentModal.tsx` / `permission-options.ts` 同区 | UI | per-session debugMode 开关 + 「请复现/已复现/已解决」快捷回复 |

### 数据流

```
被调试的 app（浏览器/Node/...）
   │  POST http://127.0.0.1:<port>/ingest   ← 插桩代码上报（跨域）
   ▼
DebugLogServer（agent-runtime 长驻单例，内存 buffer）
   ▲  GET /logs?sid=&round=  /  POST /round  /  DELETE /logs
   │  （localhost，仅本机）
debug-mode-mcp-server.mjs（stdio 子进程，端口由 SPARK_DEBUG_LOG_PORT 注入）
   ▲  JSON-RPC stdio（SDK 命名空间 mcp__spark_debug__）
   │
Claude CLI agent（执行 spark-debug skill 的状态机）
```

> 接线模板完全复刻现有 `spark_search`：
> - `resolveWebSearchMcpServerPath()` / `resolveWebSearchMcpServer()` @ `session.service.ts:4038 / 2073`
> - env 注入方式见 `session.service.ts:2090-2101`（`ELECTRON_RUN_AS_NODE: '1'` + `SPARK_*`）
> - MCP 挂载点 `session.service.ts:1511 / 1791`（`mcpServers.spark_search = ...`）

---

## 四、组件详细设计

### 4.1 DebugLogServer（HTTP 日志服务）

Node 内置 `http` 起服务，绑 `127.0.0.1`，端口 `0`（系统分配后读回真实端口）。进程内单例，**懒启动**：首次有 session 需要调试模式时启动，之后常驻。

**内部状态**（内存）：

```ts
interface DebugEntry {
  sid: string
  round: number
  tag: string            // 假设标记，如 "hypothesis-A"
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  data?: unknown         // 任意结构化负载
  source: string         // 'browser' | 'node' | ...
  ts: number             // 客户端时间
  receivedAt: number     // 服务端落地时间
}

interface DebugSessionState {
  sid: string
  round: number
  hypotheses: { round: number; text: string }[]  // 假设台账，防止打转
  entries: DebugEntry[]      // ring buffer，单 session 上限 5000 条
  createdAt: number
}
```

**HTTP 接口**：

| Method / Path | 用途 | 备注 |
|---------------|------|------|
| `OPTIONS *` | CORS 预检 | 返回 204 + 全套 CORS 头（附录 A） |
| `POST /ingest` | 接收一条/一批日志 | body 见下；写入对应 sid 的 buffer；**带全套 CORS 响应头** |
| `GET /logs?sid=&round=` | 读取日志 | `round` 省略=当前轮；返回 `{ entries, total, round }` |
| `POST /session` | 开/续一个 debug session | body `{ sid? }`；无则生成；返回 `{ sid, port, round }` |
| `POST /round` | 进入下一轮 | body `{ sid, hypothesis }`；round++；记台账；返回新 round |
| `GET /status?sid=` | 状态 | `{ round, total, thisRound, hypotheses }` |
| `DELETE /logs?sid=` | 清空该 session 日志 | 交付阶段调用 |

`POST /ingest` body：

```json
{ "sid": "...", "round": 3, "tag": "hypothesis-A", "level": "debug",
  "message": "checkout state", "data": { "cartId": 12, "step": "pay" },
  "ts": 1718600000000, "source": "browser" }
```

服务端：校验 `sid` 存在；`round` 缺省取该 session 当前 round；超 buffer 上限丢最旧（ring）；任何字段缺失给默认值，**绝不 500 影响上报方**。

**安全 / 健壮性**：
- 仅 `127.0.0.1` 监听；`sid` 是随机不可猜 token，跨 session 隔离。
- body 大小上限（如 256KB/条），超限截断。
- 服务异常不得冒泡到主流程；启动失败则调试模式降级为「不可用」并提示用户。

### 4.2 debug-mode-mcp-server.mjs（stdio 桥接）

照 `web-search-mcp-server.mjs` 的 stdio JSON-RPC 2.0 骨架（`send/result/error`、`readline` 逐行）。从 `process.env.SPARK_DEBUG_LOG_PORT` 拿端口，工具实现都是 `fetch('http://127.0.0.1:${port}/...')` 转发。

**暴露工具**（SDK 命名空间 `mcp__spark_debug__`）：

| 工具 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `begin` | `{ sid? }` | `{ sid, port, round, snippets, ingestUrl }` | 开/续调试会话；返回各语言**上报片段**和 ingest 地址 |
| `read` | `{ round? }` | `{ entries, total, round }` | 拉取本轮（默认）日志 |
| `next_round` | `{ hypothesis }` | `{ round, ingestUrl }` | 验证完一轮要再插桩时推进轮次并登记新假设 |
| `status` | `{}` | `{ round, total, thisRound, hypotheses }` | 判断用户是否真复现（thisRound>0） |
| `finish` | `{}` | `{ markers, cleared }` | 清空日志 + 返回需删除的插桩标记清单 |

`begin` 返回的 `snippets` 直接给 agent 可粘贴的上报器（占位符已填真实 `sid/round/port`），见附录 B。

### 4.3 spark-debug skill

`manifest.json`（参考 `spark-web-tool/manifest.json`）：

```json
{
  "id": "builtin:spark-debug",
  "category": "debugging",
  "requiredTools": ["Read", "Edit", "Grep", "Bash",
    "mcp__spark_debug__begin", "mcp__spark_debug__read",
    "mcp__spark_debug__next_round", "mcp__spark_debug__status",
    "mcp__spark_debug__finish"],
  "parameters": [
    { "name": "bugDescription", "type": "string", "label": "Bug 描述", "required": true,
      "description": "现象、复现步骤、期望 vs 实际" },
    { "name": "targetRuntime", "type": "select", "label": "运行环境", "defaultValue": "browser",
      "options": [
        { "label": "浏览器 / 前端", "value": "browser" },
        { "label": "Node / 后端", "value": "node" },
        { "label": "其他", "value": "other" }
      ] }
  ]
}
```

`SKILL.md` 把第一节状态机写成**可执行的 turn 级指令**，关键纪律：

1. 入口先 `begin` 拿 `sid/port/snippets`。
2. 形成假设 → **改代码前先 `impact(...)`** → 用统一标记插桩（附录 B）→ 给用户清晰复现步骤 → **结束 turn**。
3. 用户回"复现完了" → `read` 取本轮日志：
   - `status.thisRound === 0` → 提示可能没走到插桩路径，调整后重试，不要硬分析空日志。
   - 有日志 → 验证/推翻假设。
4. 修复后插「验证日志」→ `next_round({hypothesis})` → 让用户再测 → 结束 turn。
5. 用户"解决了" → `finish` 拿 `markers` → `Grep` 定位并 `Edit` 删除所有插桩 → 再 `Grep` 校验零残留 → 交付总结（根因 / 修复 / 验证证据）。
6. 用户"没解决" → 回第 3 步；**已验证/已排除的假设不重复**（靠 `status.hypotheses` 台账），设最大轮次护栏（如 6 轮）后主动收口、求助用户补信息。

`references/`：
- `references/instrument-snippets.md` —— 各语言上报器模板（附录 B）。
- `references/state-machine.md` —— 完整状态机与边界话术。

---

## 五、接线改造点（改现有文件，先跑 impact）

> ⚠️ `session.service.ts` 是核心高频文件。改动前必须分别对下列符号跑 `impact`，HIGH/CRITICAL 在 commit 说明。

1. **`packages/protocol`**：`SessionSnapshot` / `session:update` payload 加 `debugMode?: boolean`。
2. **session DB / repository**：sessions 表加 `debug_mode` 列（默认 0），读写映射。
3. **`session.service.ts`**：
   - 新增 `resolveDebugMcpServerPath()`（仿 `resolveWebSearchMcpServerPath` @ 4038）。
   - 新增 `resolveDebugMcpServer(workspaceRootPath)`（仿 `resolveWebSearchMcpServer` @ 2073）：启动/获取 `DebugLogServer` 端口，注入 `env: { ELECTRON_RUN_AS_NODE:'1', SPARK_DEBUG_LOG_PORT: String(port) }`。
   - 在 MCP 装配处（@ 1511 / 1791）**仅当该 session `debugMode === true`** 才挂 `mcpServers.spark_debug = ...`。
   - 新增 `DEBUG_TOOL_NAMES` + `DEBUG_MODE_SYSTEM_PROMPT`（仿 `SEARCH_TOOL_NAMES` @ 4049 / `WEB_SEARCH_SYSTEM_PROMPT` @ 4059），**仅 debugMode 时注入**。
4. **`sdk/types.ts`**：加 `debugMcpServer?: SDKMcpServerConfig`（仿 @ 312 的 `webSearchMcpServer`）。
5. **前端**：composer toggle + 快捷回复（见 4.4 / Phase 4）。
6. **构建产物**：确认 `debug-mode-mcp-server.mjs` 跟 `web-search-mcp-server.mjs` 一样被打包进 app 资源（检查 `out/`、build-script 拷贝规则）。

---

## 六、分阶段交付与验收

### Phase 1 — DebugLogServer + CORS（独立可测）
- 实现 HTTP 服务、buffer、轮次状态、全部接口。
- **验收**：
  - 单测：ingest→read 分轮检索正确；ring buffer 溢出丢最旧；DELETE 清空；OPTIONS 返回全套 CORS 头含 PNA。
  - 手测：浏览器控制台从 `http://localhost:3000` 页面 `fetch` 到 `http://127.0.0.1:<port>/ingest`，**预检通过、日志入桶**（CORS 关键验收，必须真在浏览器里验）。

### Phase 2 — MCP 桥接 + 接线
- 实现 `.mjs`；protocol/DB 加 `debugMode`；`session.service.ts` 按 debugMode 接线。
- **验收**：`debugMode=true` 的 session 里 agent 能调 `begin/read/next_round/status/finish`；`debugMode=false` 完全无副作用。`detect_changes()` 仅影响预期 symbol。

### Phase 3 — skill 状态机
- 写 `SKILL.md` + `manifest.json` + `references/`。
- **验收**：跑一个真实 bug 全流程（插桩→复现→读日志→修复→验证→`finish` 清理→`Grep` 零残留），多轮不重复假设、达护栏能收口。

### Phase 4 — 前端 toggle + 快捷回复（正式需求）
- composer 加 per-session `debugMode` toggle（与权限下拉并列，default off）。
- `debugMode=true` 时对话区显示「请复现 / 已复现 / 已解决」快捷回复，点击注入对应消息驱动状态机。
- **验收**：toggle 开关切换持久化正确；快捷回复仅在 debugMode 显示且能正确驱动下一 turn。

> 每个 Phase commit 前跑 `detect_changes({scope:"compare", base_ref:"master"})` 做回归对照。

---

## 附录 A — CORS / Private Network Access（务必照做）

浏览器侧日志上报会触发跨域；https 页面访问 http 回环还会触发 PNA 预检。服务端**所有响应**（含 `OPTIONS` 与 `POST`）都要带：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, GET, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 86400
```

对 `OPTIONS` 预检：直接 `204` 返回上述头。
当请求头含 `Access-Control-Request-Private-Network: true`（https/安全上下文页面访问 127.0.0.1 时浏览器会发），**必须**额外回：

```
Access-Control-Allow-Private-Network: true
```

否则 Chrome 会拦截预检，浏览器侧日志一条都收不到。

**已知坑**：
- https 页面 → http://127.0.0.1 属于"安全上下文访问本地"，现代 Chrome 走 PNA 预检，靠上面那个头放行；别依赖 `http://localhost` 被当 potentially trustworthy 的旧策略，统一用 PNA 头兜底。
- 上报方加 `keepalive: true`，避免页面跳转/卸载时丢日志。
- `Access-Control-Allow-Origin: *` 仅因服务只绑 `127.0.0.1` 且 `sid` 是随机 token 才可接受；不要在公网环境复用此服务。

---

## 附录 B — 插桩上报器模板（`begin` 返回，占位符已填真值）

统一用可识别标记包裹，便于 `finish` 阶段精确清除：

**JS / TS（浏览器 & Node 通用）**
```js
// __SPARK_DEBUG_START__ sid=<sid> round=<round>
function __sparkDebug(tag, data) {
  try {
    fetch('http://127.0.0.1:<port>/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: '<sid>', round: <round>, tag, data, ts: Date.now(), source: 'browser' }),
      keepalive: true,
    }).catch(() => {})
  } catch (_) {}
}
// __SPARK_DEBUG_END__
```

**Python**
```python
# __SPARK_DEBUG_START__ sid=<sid> round=<round>
import json, urllib.request, threading, time
def __spark_debug(tag, data=None):
    def _send():
        try:
            req = urllib.request.Request(
                'http://127.0.0.1:<port>/ingest',
                data=json.dumps({'sid':'<sid>','round':<round>,'tag':tag,'data':data,'ts':int(time.time()*1000),'source':'node'}).encode(),
                headers={'Content-Type':'application/json'})
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass
    threading.Thread(target=_send, daemon=True).start()
# __SPARK_DEBUG_END__
```

清除规则：`finish` 返回所有 `__SPARK_DEBUG_START__ ... __SPARK_DEBUG_END__` 块标记，agent 用 `Grep` 全仓搜 `__SPARK_DEBUG` 后逐块删除，交付前再 grep 一次确认零残留。
