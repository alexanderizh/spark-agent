# 浏览器自动化（Browser Automation）

> 状态: 已落地 | 最后核对: 2026-07-05

Spark Agent 提供两套互补的浏览器能力：

- `playwright` managed MCP：成熟网页自动化，适合点击、输入、选择器/可访问性树、批量采集和 E2E 验证。
- `spark_browser` 内置 MCP：应用内可见的独立浏览器窗口，适合本地 HTML 调试、与用户共看同一窗口、持久脚本注入、复用 profile 登录态、读取 console、观察/拦截网络。

## 设置页

进入「设置 → 浏览器自动化」：

1. 安装或重新安装 `@playwright/mcp`。
2. 下载或重新下载 Playwright 使用的 Chromium。
3. 启用/禁用 managed `playwright` MCP。
4. 切换 Playwright `headful` / `headless` 模式。

旧的「打开嵌入式浏览器视图」已经移除。Agent 需要应用内可见窗口时，会通过 `spark_browser` 工具按需打开窗口。

远程连接设置里有「使用内置浏览器窗口」能力开关，默认关闭。开启后远程会话才应允许使用本机可见的 `spark_browser` 窗口，并且要意识到它可以读取页面控制台和网络元信息。

## 给 Agent 的选择规则

优先用 `playwright`：

- 要可靠点击、输入、选择器定位、snapshot/ref 操作。
- 要跑网页流程、采集列表、下载文件或做 E2E 验证。
- 不需要用户实时看到同一个应用内窗口。

优先用 `spark_browser`：

- 用户需要看到 Agent 正在操作的窗口，或需要手动介入同一窗口。
- 打开/调试本地 `file://` HTML。
- 需要持久注入脚本，跨导航继续 hook 页面。
- 需要复用登录态：`profileId` 对应持久 cookies/localStorage/IndexedDB/cache。
- 需要捕获 `console.log/warn/error`。
- 需要观察网络请求，或做 block/redirect/set_headers 这类轻量拦截。

一种工具失败时，可以切换另一种并说明原因。

## spark_browser 工具手册

工具名在 SDK 中显示为 `mcp__spark_browser__*`。

| 工具 | 用途 |
|------|------|
| `open` | 打开可见应用内 BrowserWindow，支持 `http/https/file/data` URL；可传 `profileId` 和 `reuse` |
| `navigate` | 导航已有窗口 |
| `eval` | 在页面执行一次 JS，返回可 JSON 序列化结果 |
| `inject_script` | 注入持久脚本，后续导航后自动重跑 |
| `remove_script` | 移除持久脚本 |
| `screenshot` | 返回 PNG `dataUrl` + 当前 url/title |
| `get_url` / `get_title` | 读取当前窗口状态，包括用户手动导航后的状态 |
| `list_windows` | 列出窗口、profile、可见性、脚本数、网络规则数、console 缓冲数 |
| `close` | 关闭窗口并清理该窗口脚本、网络规则和事件缓冲 |
| `console_start` | 开始捕获页面 console |
| `console_events` | 读取 console 事件，可用 `sinceSeq` 增量读取 |
| `console_clear` | 清空 console 缓冲 |
| `network_set_rules` | 设置网络规则：`record`、`block`、`redirect`、`set_headers` |
| `network_events` | 读取请求、完成、失败、拦截事件，可用 `sinceSeq` 增量读取 |
| `network_clear` | 清理网络规则和事件 |
| `clear_profile` | 清理指定 profile 的 cookies/cache/localStorage/IndexedDB |

### 常用流程

打开本地 HTML 并调试：

```text
1. open({ url: "file:///absolute/path/page.html", profileId: "local-debug" })
2. console_start({ windowId })
3. eval({ windowId, code: "document.body.innerText" })
4. console_events({ windowId })
5. screenshot({ windowId })
6. close({ windowId })
```

网络观察：

```text
1. open({ url: "https://example.com", profileId: "example" })
2. network_set_rules({ windowId, rules: [{ match: "api/", action: "record" }] })
3. navigate({ windowId, url: "https://example.com/dashboard" })
4. network_events({ windowId })
5. network_clear({ windowId })
```

持久脚本：

```text
1. inject_script({ windowId, scriptId: "trace-fetch", code: "..." })
2. navigate({ windowId, url: "https://example.com/next" })
3. remove_script({ windowId, scriptId: "trace-fetch" })
```

## 限制与安全

- `eval` 返回值必须可 JSON 序列化；DOM 节点、循环对象要在代码里自行 `JSON.stringify`。
- 当前 `spark_browser` 支持 webRequest 级记录、阻断、重定向、请求头修改；响应体级 `mock_response` 未启用，会返回 `NETWORK_RULE_UNSUPPORTED`。
- 页面保持 `sandbox:true`、`nodeIntegration:false`、`contextIsolation:true`，远程页面拿不到 Node/Electron API。
- 持久 profile 会保留登录态；任务结束后只在明确需要重置时调用 `clear_profile`。
- 任务结束时清理：`remove_script`、`network_clear`、`console_clear`、`close`。

## 文件预览影响说明

移除 `PopOutBrowserService` 和旧 `BrowserAutomationViewService` 不影响项目会话右侧文件预览、Markdown 预览或 HTML 文件打开逻辑。文件预览走 `FilePreviewPanel`、`safe-file://`、`file:read` / `file:open` 链路；HTML 文件当前按非内嵌预览处理，回退到系统默认浏览器打开。
