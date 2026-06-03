# 浏览器自动化（Browser Automation）

让内置 Agent 通过 Playwright MCP 自动操作网页：导航、点击、输入、提取数据、截图。

## 工作原理

Spark Agent 内置注册了一个 **managed MCP server**（名称固定为 `playwright`，scope=`managed`，不可删除）。当启用时，Claude SDK 会自动发现该 MCP 提供的全部 `mcp__playwright__browser_*` 工具，Agent 可以像调用其他工具一样调用它们。

```
┌──────────────┐   IPC    ┌──────────────────┐  stdio  ┌──────────────────────┐
│  Chat / Agent│ ───────▶ │ Spark Main Proc  │ ──────▶ │ @playwright/mcp      │
│  (renderer)  │          │  + managed row   │         │ (subprocess)         │
└──────────────┘          │  in mcp_servers  │         │                      │
                          └──────────────────┘         └────────┬─────────────┘
                                                                │ CDP
                                                                ▼
                                                ┌──────────────────────────┐
                                                │ Embedded BrowserWindow   │
                                                │ (or Playwright's own     │
                                                │  Chromium if view closed)│
                                                └──────────────────────────┘
```

### 浏览器放在哪？

- **嵌入式窗口（默认）**：在 Chat view 右侧的"浏览器自动化"面板里点 **+ 打开浏览器视图**，会弹出一个独立的 Chromium 窗口。Agent 操作的页面就显示在这里，并通过 CDP（端口 9223）让 Playwright 连接到该窗口。
- **Playwright 自带 Chromium**：如果未打开嵌入式视图，Playwright 会启动自己下载的 chromium（headful 或 headless，取决于 mode 设置）。

## 启用流程

### 1. 安装依赖

进入 **Settings → 浏览器自动化**：

1. 点 **安装 MCP** —— 等待 `pnpm add @playwright/mcp playwright` 完成
2. 点 **下载浏览器** —— 等待 `playwright install chromium` 完成（约 150 MB）

> 两个步骤只做一次。状态徽章会变绿。
> 如果状态显示“使用系统浏览器”，说明当前只找到了本机 Chrome/Edge 回退，不代表安装包内已经包含 Chromium；请重新点 **下载浏览器** 或使用 `pnpm --filter @spark/desktop-dev download-browser`。
> 下载过程中设置页会显示当前阶段、百分比（当 Playwright 输出提供时）和最近一行安装日志。

### 2. 启用 MCP

安装完成后，**MCP 已启用** 按钮默认亮起（toggle 状态为启用）。如需临时禁用，点该按钮切换。

### 3. 选择运行模式

| 模式 | 适用场景 | 显示 |
|------|----------|------|
| `headful`（默认） | 调试、演示、需要看 Agent 在干什么 | 嵌入式窗口可见 |
| `headless` | 后台批量任务、信息采集 | 无窗口，速度更快 |

### 4. 在会话中使用

新建一个会话，在 skill 选择器里挑 **浏览器自动化** (`builtin:browser-automation`)，然后像普通对话一样发任务。

## 使用示例

### 例 1：网页信息采集

```
请帮我打开 https://news.ycombinator.com，把首页前 10 条新闻的
标题、链接、得分整理成 Markdown 表格。
```

Agent 会按以下步骤操作：

1. `browser_navigate` → 打开页面
2. `browser_snapshot` → 获取可访问性树 + ref 编号
3. 分析 snapshot，按 ref 依次 `browser_click` / 提取文本
4. 完成后 `browser_close`

### 例 2：登录后采集

```
我需要从公司内网 https://intranet.example.com/dashboard 导出
本月报表。账号在弹出的页面里输入 user=`demo`、pass=`demo123`，
登录后点 "Monthly Report"，选 "June 2026"，下载 CSV。
```

> ⚠️ **安全提示**：涉及账号密码时，Agent 会在执行前用 AskUserQuestion 弹窗确认，避免误操作。

### 例 3：UI 验证（搭配前端开发）

```
我刚改完登录页样式，请帮我打开 http://localhost:3000/login，
用 3 组账号（test1/test1、test2/test2、admin/admin）尝试登录，
把每组的实际表现（成功/失败提示、跳转页面）截图发给我。
```

## 工作流推荐

### 最佳实践

1. **总是先 snapshot**：让 Agent 看到页面结构再操作，避免猜 CSS selector
2. **基于 ref**：snapshot 返回的 `ref=N` 是最稳定的定位方式
3. **每步后再次 snapshot**：表单填写、按钮点击后都要回看效果
4. **错误恢复**：如果 Agent 卡住，可以让它 `browser_close` 重新开始

### 与 Agent 的协作

`builtin:browser-automation` skill 的 system prompt 已经教会 Agent：

- 使用 ref-based 操作，不写 CSS selector
- 遇到 CAPTCHA / 二次验证 → 立即停止求助
- 不批量提交敏感表单（先确认）
- 操作完毕 `browser_close` 释放资源

如果需要让 Agent 操作**内部业务系统**，可以在 prompt 里补充：

```
这个系统是公司内部 CRM，可以放心操作。允许批量提交表单。
不需要每步确认，完成后给我一份摘要报告即可。
```

## 故障排查

| 现象 | 排查 |
|------|------|
| **MCP 工具未在 Agent 工具列表出现** | Settings → 浏览器自动化：确认"MCP 已启用"按钮亮起；重启会话 |
| **`browser_navigate` 报错"Failed to launch browser"** | 没下载浏览器。点"下载浏览器" |
| **日志提示 `No chromium found, falling back to system chrome`** | 安装包内未检测到可用 Chromium。打包前确认 `apps/desktop/browsers/` 内有 Chromium 可执行文件；`build:*` 和 `pack` 脚本会先运行 `download-browser` 并把目录打进 `resources/browsers/` |
| **Agent 调用 `browser_*` 卡住不动** | 可能是前一个会话没 `browser_close`。重启应用 |
| **嵌入式窗口里网页加载不出** | 检查 CDP 端口 9223 是否被其他进程占用：`netstat -ano \| findstr 9223` |
| **playwright install 失败** | 国内网络可设镜像：`set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/` 后重试 |
| **MCP server 进程残留** | 任务管理器搜 `playwright`，结束孤儿进程 |

## 隐私与安全

- 嵌入式浏览器窗口**不加载任何 preload 脚本**，**不注入 IPC bridge** —— 与主 UI 完全隔离
- Agent 操作浏览器的内容**不会**自动上传到任何第三方服务（CDP 是本地 127.0.0.1 通信）
- 默认 Skill 系统提示**禁止** Agent 访问支付、银行等敏感页面，遇到时弹窗确认
- `--remote-allow-origins=*` 配合 loopback 绑定，CDP 端口不对外网暴露

## 进阶

### 自定义 MCP 配置

`playwright` MCP server 的 `configJson` 存在 `mcp_servers` 表里。如需手动修改（例如加 `--device` 模拟手机）：

1. 在 Settings → MCP 找到 `playwright` 行（**不能 delete**，只能 update）
2. 编辑 configJson 的 `args` 数组
3. 或在"浏览器自动化"卡片点 **重置 MCP 配置** 恢复默认

### 与其他 MCP server 共存

`playwright` 是 managed scope，与用户自建的 MCP server 完全独立。你可以同时挂载任何其他 MCP server（GitHub、Slack、数据库等），Agent 会同时看到所有工具。

### Phase 2 视图嵌入（已实现）

打开嵌入式浏览器视图后，Playwright 会通过 `--cdp-endpoint=http://127.0.0.1:9223` 连接到我们托管的 Chromium，而不是启动自己的浏览器实例。这样：

- 资源占用更低（不重复开 Chromium）
- 用户可见 Agent 操作
- 关闭嵌入式视图后，Playwright 自动 fallback 到自己启动浏览器

## 相关链接

- [@playwright/mcp on npm](https://www.npmjs.com/package/@playwright/mcp)
- [Playwright Documentation](https://playwright.dev/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
