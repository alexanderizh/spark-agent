# Codex Computer Use（Sky CUA）逆向技术解析与复刻方案

> 状态: 已落地（六轮逆向分析完成；第六轮完成硬验证与关键常量实测） | 最后核对: 2026-09-05
>
> **配套文档**：[computer-use-开发实施规格书.md](./computer-use-开发实施规格书.md) —— 基于本解析产出的可直接开工实施蓝图（协议规格、工具 schema、核心算法伪码、里程碑验收标准）。

> 分析对象：本机安装的 `~/.codex/computer-use/Codex Computer Use.app`（版本 26.828.1000919，build 1000919），配套 `@openai/codex` CLI 0.152.1、ChatGPT.app 内置 `cua_node` 运行时与 `@oai/sky@0.6.24` Node 包。
> 方法说明：该组件**未开源**（开源的只是 codex CLI 本体，CUA 服务为 ChatGPT/Codex 桌面端私有组件），本文全部结论来自本地解包：静态结构分析、Mach-O 符号 demangle（15.3 万符号）、Swift/ObjC 元数据与字符串提取、关键函数反汇编（含常量实测）、随包 JS 源码与提示词资产逐行阅读，以及 codex Rust 二进制与配置面的交叉验证。共六轮递进分析（第四轮执行引擎 API 与全量工具注册、第五轮 AX 属性面与宿主桥、第六轮反汇编级硬验证），附录 A 列出全部证据文件。

---

## 目录

1. [总体结论（TL;DR）](#1-总体结论tldr)
2. [组件清单与进程拓扑](#2-组件清单与进程拓扑)
3. [安装、更新与生命周期](#3安装更新与生命周期)
4. [IPC 传输层协议（逐字节还原）](#4ipc-传输层协议逐字节还原)
5. [Agent 工具面（MCP 工具全集）](#5agent-工具面mcp-工具全集)
6. [感知层：AX 树 + 截图双通道](#6感知层ax-树--截图双通道)
7. [执行层：语义优先、事件兜底的注入体系](#7执行层语义优先事件兜底的注入体系)
8. [非前台控制（不抢焦点的关键技术）](#8非前台控制不抢焦点的关键技术)
9. [人机协同：中断、审批、Esc、锁屏](#9人机协同中断审批esc锁屏)
10. [可视化：虚拟光标、状态浮窗、状态栏](#10可视化虚拟光标状态浮窗状态栏)
11. [反馈给 Agent 调用方的完整链路](#11反馈给-agent-调用方的完整链路)
12. [Skysight：屏幕记忆与事件流子系统](#12skysight屏幕记忆与事件流子系统)
13. [安全与权限模型](#13安全与权限模型)
14. [跨平台设计（Linux / Windows）](#14跨平台设计linux--windows)
15. [复刻方案（面向 Spark-Agent）](#15复刻方案面向-spark-agent)
16. [第四轮深挖补充（执行引擎、渲染管线与全量注册细节）](#16-第四轮深挖补充执行引擎渲染管线与全量注册细节)
17. [第五轮深挖补充（AX 引擎属性面、宿主桥 sky.node、回放提示词组）](#17-第五轮深挖补充ax-引擎属性面宿主桥-skynode回放提示词组)
18. [第六轮验证与硬数据（反汇编级实证）](#18-第六轮验证与硬数据反汇编级实证)
19. [附录 A：证据文件清单](#附录-a证据文件清单)
20. [附录 B：IPC 请求类型全集](#附录-bipc-请求类型全集)
21. [附录 C：Swift 模块与关键符号表](#附录-cswift-模块与关键符号表)

---

## 1. 总体结论（TL;DR）

Codex Computer Use 是 OpenAI 的 macOS 桌面控制子系统，内部代号 **Sky CUA**（`com.openai.sky.CUAService`，"CUA" = Computer Use Agent）。它的核心设计可以概括为一句话：

> **以"按 App 会话（App Session）"为单位，优先用辅助功能（AX）语义接口读写目标应用的窗口状态，AX 不够时用定向 CGEvent（postToPid）模拟鼠标键盘；全部能力通过一个单例后台服务暴露为 MCP 工具 + JSON-RPC 本地 IPC，用"审批 + 实时可视化 + 人机中断 + 锁屏守护"四层机制保证用户始终在环（human-in-the-loop）。**

七个最重要的工程结论（与常见的"截图 + 全局鼠标模拟"型 computer use 的本质区别）：

1. **语义优先，像素兜底**：感知走 AX 树文本（带 element_index、支持增量 diff），执行优先 `AXUIElementPerformAction` / `AXUIElementSetAttributeValue`；只有 AX 不可用时才退回"截图坐标点击"。速度和精度来自语义通道，而不是视觉模型。
2. **非前台控制**：输入事件通过 `CGEventPostToPid` 定向投递给目标进程（`SystemSoftware.CGEventAPI.postToPid`），配合 `tapCreateForPid`（进程级事件监听）、`notifyAppActivated/notifyWindowKeyFocus*`（向目标进程"通知"激活/焦点状态而不真正抢焦点），实现后台打字、后台点击，不打断用户正在做的事。
3. **感知-执行一体化的会话模型**：`get_app_state` = "启动 App 会话 + 抓关键窗口 AX 树 + 截图"，是每个 assistant turn 必调的第一个工具；执行层改动 UI 后由运行时自动等待（约 1s，检测到 loading 指示最多再等 5s）再回读状态。
4. **审批是协议内建的一等公民**：每个 App 首次被操作前走 elicitation 审批（`codex_approval_kind: mcp_tool_call`），支持 session/always 两级持久化（`appApprovalStorage`），组织策略可 `denied`/`forbidden`；iMessage 等敏感面甚至做了 prepare_send/commit_send 两段式提交，用户可在审批时**编辑消息内容**（`user_edited`）。
5. **可视化让用户看得见**：agent 有自己的**虚拟光标**（`ComputerUseCursor`：独立光标窗口、果冻式运动动画、按压状态、就近吸附 CloseEnough），加上 PIP 实况浮窗（`RemoteHostedPIP*`）和菜单栏状态项（"ChatGPT is using your computer / Esc to cancel"）。
6. **锁屏是一等安全边界**：独立的 `CUALockScreenGuardian.app` 通过 XPC 监控锁屏，物理输入（用户动键鼠）实时上报主服务；服务持有"自动解锁租约"（auto-unlocked lease，配合安装到 `/Library/Security/SecurityAgentPlugins` 的授权插件）；锁屏时工具返回 `screenLocked(-10020)` 错误。
7. **反馈闭环结构化**：工具结果 = 文件 URL 截图 + AX 文本（可 diff）+ 结构化 response meta（`codex/toolSurface`）+ 遥测（每次工具调用上报 durationMs、terminalStatus: completed/cancelled/failed，cancelled 专门区分 `userIntervened` 与 `userStoppedSession`）。

---

## 2. 组件清单与进程拓扑

### 2.1 磁盘布局

```
~/.codex/computer-use/
├── config.json                        # 服务 UI 配置（语言、强调色、状态文案）
├── sessions/*.toml                    # 每个 App 会话的持久化状态（已批准的 App 列表）
└── Codex Computer Use.app/
    ├── Contents/Info.plist            # CFBundleDisplayName = "ChatGPT Computer Use"
    ├── Contents/MacOS/SkyComputerUseService          # 主服务 22.9MB（LSUIElement 后台）
    ├── Contents/Resources/
    │   ├── Package_ComputerUse.bundle # 提示词资产（Skysight 摘要/记忆/按 App 指令）
    │   ├── Package_Appshot.bundle     # Appshot 音效（Appshot.wav）
    │   ├── Package_SlimCore.bundle    # OpenAI SlimCore 共享组件资源/实验开关
    │   └── SwiftProtobuf_SwiftProtobuf.bundle
    ├── Contents/SharedSupport/
    │   ├── Codex Computer Use Installer.app   # 90KB，装 AuthorizationPlugin（system.privilege.admin 提权）
    │   │   └── .../Resources/CodexComputerUseAuthorizationPlugin.bundle  # 锁屏解锁授权插件
    │   ├── SkyComputerUseClient.app           # 14MB，CLI + MCP 服务器 + 传输客户端（同二进制多形态）
    │   └── CUALockScreenGuardian.app          # 22.5MB，锁屏守护（独立进程）
    └── Contents/embedded.provisionprofile
```

相关联的外部组件：

| 组件                        | 位置                                                                                   | 角色                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `@oai/sky` npm 包 0.6.24    | `/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky`      | JS 侧客户端（RPC 桥、策略包装、类型定义、**随包文档**），内嵌一份 app 副本用于分发 |
| `cua_node` 定制 Node 运行时 | 同上 `cua_node/`                                                                       | 提供 `nodeRepl.rpc / nativePipe / launchServices / createElicitation` 宿主能力     |
| `sky.node` 宿主桥           | `/Applications/ChatGPT.app/Contents/Resources/native/sky.node`                         | Swift NAPI 模块：状态栏项、图标/前台窗口查询、PIP 引导（§17.2）、服务身份校验      |
| `codex` CLI（Rust）         | npm `@openai/codex`                                                                    | 通过 config.toml 注册插件/MCP/notify 钩子；配置键 `ComputerUseRequirementsToml`    |
| Group Container             | `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock` | 唯一 Unix socket IPC 端点                                                          |

### 2.2 进程拓扑与调用链

```
┌─────────────────────────────────────────────────────────────────────┐
│ Agent 编排层（codex CLI / ChatGPT.app 会话）                          │
│   · MCP 客户端（tools: computer_use 等）                              │
│   · notify 钩子: SkyComputerUseClient "turn-ended"（回合结束通知）      │
└──────────────┬──────────────────────────────────────────────────────┘
               │ MCP (stdio) / 每回合 turn metadata
┌──────────────▼──────────────────────────────────────────────────────┐
│ SkyComputerUseClient（可执行三形态: mcp 服务器 / CLI 子命令 / notifier）│
│   · ComputerUseMCPServer（工具注册、审批存储 approvalStore、指标）        │
│   · MessagesMCPServer（iMessage: 读审批 + 发送审批两个存储）              │
│   · MacNativePipeTransport（JSON-RPC 客户端）                          │
└──────────────┬──────────────────────────────────────────────────────┘
               │ Unix socket: computeruse.sock
               │ 帧 = [u32 LE 长度][JSON]，JSON-RPC 2.0，API 握手 CodexComputerUseIPC-5
┌──────────────▼──────────────────────────────────────────────────────┐
│ SkyComputerUseService（常驻后台，持有全部 TCC 权限）                     │
│   · ComputerUseIPCServer（请求路由 + 发送方认证 SenderContext）          │
│   · ComputerUseAppController / AppInstanceManager（按 App 会话）        │
│   · AccessibilitySupport（AX 树读写、UIElementTree、LM 可读渲染）         │
│   · SynthesizedEvent / CGEventAPI（postToPid 事件注入）                 │
│   · ComputerUseCursor（虚拟光标窗口）RemoteHostedPIP*（实况浮窗）          │
│   · EventStreamService / SkysightService（屏幕事件流 + 记忆摘要）          │
│   · Skyshot（截图）PermissionWindowController（权限引导）                 │
└───────┬───────────────────────┬─────────────────────────────────────┘
        │ AXUIElement* API       │ CGEventPostToPid / tapCreateForPid
┌───────▼──────────┐   ┌────────▼──────────────┐   ┌─────────────────────┐
│ 目标 App（AX 语义）│   │ 目标 App（事件注入）      │   │ CUALockScreenGuardian │
└──────────────────┘   └───────────────────────┘   │ （XPC，锁屏监控/解锁）   │
                                                    └─────────────────────┘
```

要点：

- **服务是唯一权限持有者**：辅助功能（AX）、屏幕录制、AppleEvents、通讯录等 TCC 授权都在 `SkyComputerUseService` 上；Agent 进程（甚至 ChatGPT 主 App）不需要这些权限，也无法绕过服务直接操作。这是清晰的安全边界（对应错误码 `senderProcessNotAuthenticated -10000`——IPC 有发送方认证）。
- **Client 是"胖客户端"**：同一个 `SkyComputerUseClient` 二进制既是 MCP stdio 服务器（`mcp` 子命令）、又是 CLI（`turn-ended`、`computer-history`、`record-and-replay`、`app-server` 等子命令）、又是 Sparkle 更新以外的运维入口。
- 版本一致性：插件版本 `1.0.1000919` 与 app `CFBundleVersion 1000919` 锁定；传输层有 API 版本握手（不匹配直接抛 `incompatibleClientVersion -10013`）。

---

## 3. 安装、更新与生命周期

### 3.1 安装位置与首次拉起

- App 安装在 `$CODEX_HOME/computer-use/`（本机 `~/.codex/computer-use/`），而非 `/Applications`——它是**用户级资源，不是系统应用**。
- 按需启动：JS 传输层连不上 socket 时有三级自愈（`native-pipe.js`）：
  1. 直连 Group Container 里的 `computeruse.sock`（重试窗口内 250ms 快速尝试 + ping）；
  2. 失败则通过宿主 `NODE_REPL_HOST_SERVICES_PIPE_PATH` 发 JSON-RPC `ensureService {service:"computer-use"}` 请求宿主（ChatGPT App）拉起服务；
  3. 再失败则 `nodeRepl.launchServices.openApplication({applicationPath: SKY_CUA_SERVICE_PATH})`（或 fallback `bundleIdentifier: com.openai.sky.CUAService`）直接 LaunchService 拉起，然后 5s 窗口重连。
- 会话状态：`sessions/<uuid>.toml` 记录该会话已授权的 App（本机三份均含 `[apps] allowed = ["com.spark-agent.desktop"]`），`config.json` 存 UI 字符串与语言（本机 `zh-CN`、`accentColor #339cff`）。

### 3.2 更新

- 主 App 内建 **Sparkle** 自动更新：`SUFeedURL = https://oaisidekickupdates.blob.core.windows.net/mac/cua/alpha/appcast.xml`，EdDSA 签名验证（`SUPublicEDKey`），自动下载安装。
- `@oai/sky` 的 package.json `files` 同时打包 `bin/mac/normal` 与 `bin/mac/relaxed` 两套构建（hardened runtime 宽松变体，推测用于开发调试），以及 Linux 二进制——说明**分发与版本升级走 npm 包 + Sparkle 双通道**。

### 3.3 与 codex CLI 的集成（config.toml 摘录）

```toml
# 回合结束通知 → 状态栏/浮窗收回"工作中"状态
notify = ["…/SkyComputerUseClient", "turn-ended"]

[plugins."computer-use@openai-bundled"]        # node_repl 形态（ChatGPT.app 主用）
command = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"
NODE_REPL_TRUSTED_SERVICES = '{"browser":"…browser-service.mjs","sky":"@oai/sky/service"}'
SKY_CUA_SERVICE_PATH = "~/.codex/computer-use/Codex Computer Use.app"
NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE = "Control desktop apps on macOS through Computer Use."
NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME = "Control the Chrome browser … Prefer this method … over alternatives (such as Computer Use) …"

[mcp_servers.computer-use]                     # 直连 MCP 形态（本机已停用，保留通道）
command = "…/SkyComputerUseClient"
args = ["mcp"]
```

两条并行通道：**node_repl + `@oai/sky` JS 客户端**（ChatGPT.app 内主力，JS 里带策略/审批包装）和**裸 MCP 服务器**（codex CLI 侧直连）。插件目录另含 `skills/computer-use/SKILL.md`（给模型的完整使用手册 + 确认策略，见 §5.4）。

Rust 侧还有专门的配置结构（从 codex 二进制符号提取）：

- `ComputerUseRequirementsToml { allow_locked_computer_use: bool, allow_persistent_approval: bool }` —— 是否允许锁屏状态下继续使用、是否允许"永久记住批准"。
- 权限面：`allow_browser_and_computer_use`、`allow_appshots`、`allow_remote_control`。
- 工具开关：`tools { browser_use, computer_use, … }`。

---

## 4. IPC 传输层协议（逐字节还原）

来源：`@oai/sky/dist/project/cua/sky_js/src/targets/mac/native-pipe.js`（完整可读源码）+ 服务二进制符号。

### 4.1 传输与帧格式

- 载体：Unix domain socket `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`（0600 权限，本机已验证存在）。
- 帧格式：`[4 字节小端长度][JSON UTF-8]`，单帧上限 **8 MiB**（8388608），超限抛 `TransportError("frame is too large")`。
- 协议：**JSON-RPC 2.0**。方法仅两种业务调用 + 一个握手：
  - `ping {clientApiVersion}` → 必须返回相同 `serverApiVersion`（本机为 `CodexComputerUseIPC-5`），否则 `incompatibleClientVersion`；
  - `request {clientApiVersion, codexTurnMetadata, deadlineUnixMilliseconds, request:{requestType, request}}`；
  - id 为自增整数，带每请求超时（默认 120s，与 `deadlineUnixMilliseconds` 双保险——服务端也拿 deadline 做取消）。
- 请求体发送前会**剥离所有 `undefined` 字段**（递归 compact），保证与 Swift Codable 解码兼容。

### 4.2 请求类型（requestType）

已确认存在的 requestType 字符串（客户端硬编码）：

| requestType                                                              | 用途                                                                                                                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ComputerUseIPCListAppsRequest`                                          | 列出正在运行 + 近 14 天使用过的 App（含 displayName、bundleId、lastUsedDate、useCount、isRunning）                                              |
| `ComputerUseIPCAppStartRequest`                                          | 显式启动 App 会话                                                                                                                               |
| `ComputerUseIPCAppGetSkyshotRequest`                                     | **get_app_state 本体**：返回 AppState = 截图（Skyshot）+ AX 文本（可 diff）                                                                     |
| `ComputerUseIPCAppPerformActionRequest`                                  | 所有动作的统一入口，`action` 为 oneof（click/drag/paste/pressKey/scroll/setValue/selectText/performSecondaryAction/type）                       |
| `ComputerUseIPCAppModifyRequest` / `AppStopRequest`                      | 会话调整/结束                                                                                                                                   |
| `ComputerUseIPCAppStartCaptureRequest` / `AppNextCaptureUpdateRequest`   | 启动捕获（带动画目标 target/rect/color/display）与后续帧——供 PIP 实况流                                                                         |
| `ComputerUseIPCAppPolicyRequest`                                         | 服务端策略裁决：`allowed` / `denied`（组织策略）/ `forbidden`（安全策略），附带 `allowPersistentApproval`、`risk`、`warningSubtitle`、`appPath` |
| `ComputerUseIPCStartAudioRecordingRequest` / `StopAudioRecordingRequest` | 录系统音频（需单独审批，riskLevel: high）                                                                                                       |
| `ComputerUseIPCSkysight*Request`                                         | 屏幕记忆子系统：Start/Stop/Status/Pause/Resume/GetSettings/UpdateSettings/UpdateObservationPolicy/ClearHistory                                  |
| `ComputerUseIPCEventStream{Start,Stop,Status}Request`                    | Record & Replay 事件流录制（≤30 分钟，返回 metadata/events 文件路径）                                                                           |
| `ComputerUseIPCMessages*Request`                                         | iMessage 工具族（FindChats/SearchChats/SearchMessages/ReadMessages/ReadImage/PrepareSend/CommitSend/CountActivity）                             |
| `ComputerUseIPCCodexStatusItemMenuStateRequest` / `…StateNotification`   | 菜单栏状态项双向同步                                                                                                                            |
| `ComputerUseIPCCodexTurnEndedRequest`                                    | 回合结束（与 notify 钩子对应）                                                                                                                  |
| `ComputerUseIPCFrontmostWindowRequest`                                   | 查询前台窗口                                                                                                                                    |

完整类型与字段见附录 B。

### 4.3 发送方认证与元数据

- Swift 侧每个请求带 `ComputerUseIPCSenderContext`（发送方 PID / 审计上下文），配合错误码 `senderProcessNotAuthenticated` 与 `couldNotGetSenderPID`：**socket 是认证边界，不是所有本地进程都能驱动 CUA**。
- `codexTurnMetadata` 由 node_repl 宿主从 `requestMeta["x-codex-turn-metadata"]` 注入，内含 `call_id` / `item_id`——服务端遥测能把每一次工具调用关联回 agent 的具体 tool call。

### 4.4 服务端错误码（协议级）

```
-10000 senderProcessNotAuthenticated   -10011 noActiveSession
-10001 couldNotGetRequestData          -10012 userStoppedSession      ← 用户主动停止
-10002 couldNotGetRequestTypeName      -10013 incompatibleClientVersion
-10003 couldNotResolveRequestType      -10014 permissionsPending
-10004 unhandledEvent                  -10015 blockedURL
-10005 unknownError                    -10016 userIntervened          ← 人为介入
-10006 appNotAllowed                   -10017 couldNotGetSenderPID
-10007 runningApplicationNotFound      -10018 ambiguousApp
-10008 accessibilityError              -10019 couldNotGetBootstrapPort
-10009 permissionsNotGranted           -10020 screenLocked            ← 锁屏阻断
-10010 invalidApp
```

`userStoppedSession` / `userIntervened` 两个码在 JS 策略层被映射为 `terminalStatus: "cancelled"`（区别于普通失败），并触发对用户的自然语言转述（"已停止"），同时约束模型**不要**转述底层错误细节。

---

## 5. Agent 工具面（MCP 工具全集）

### 5.1 计算机操作工具（MCP 注册全量：computer-use 12 个）

来自客户端二进制 MCP 注册字符串（每个工具名都在二进制中出现且可对应描述文本）：

| 工具                       | 参数                                                                                               | 描述（原文摘录）                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_apps`                | —                                                                                                  | "List the apps on this computer… currently running, as well as any that have been used in the last 14 days, including details on usage frequency"                                                                    |
| `get_app_state`            | `app`（名称/完整路径/bundle id），`disable_diff?`                                                  | "Start an app use session if needed, then get the state of the app's key window and return **a screenshot and accessibility tree**. **This must be called once per assistant turn before interacting with the app**" |
| `click`                    | `element_index` 或 `x,y`（**截图像素坐标**），`click_count`（默认 1），`mouse_button`              | "Click an element by index or pixel coordinates from screenshot"                                                                                                                                                     |
| `perform_secondary_action` | `element_index`, `action`                                                                          | 调用元素暴露的**次级 AX 动作**（Show Menu / Scroll Up / Expand / Raise…），"Do not guess action names"                                                                                                               |
| `set_value`                | `element_index`, `value`                                                                           | 直接设置可写 AX 元素的值（AXValue），不经过键盘                                                                                                                                                                      |
| `select_text`              | `element_index`, `text`, `prefix?`, `suffix?`, `selection_type`（text/cursor_before/cursor_after） | 在可编辑元素中按文本定位并选中/放置光标，前后文消歧                                                                                                                                                                  |
| `scroll`                   | `element_index?` 或坐标，`direction`，`pages`（默认 1，支持小数）                                  | "Scroll an element in a direction by a number of pages"                                                                                                                                                              |
| `drag`                     | `from_x,from_y,to_x,to_y`（截图像素坐标）                                                          | 坐标拖拽                                                                                                                                                                                                             |
| `press_key`                | `key`（xdotool 风格："a"、"Return"、"super+c"、"KP_0"）                                            | 按键/组合键；**定向到目标 App，无法触发全局快捷键**                                                                                                                                                                  |
| `type_text`                | `text`                                                                                             | "Type literal text using keyboard input"；含 `\n` 会真实按 Return（文档特别警示聊天输入框误发送问题）                                                                                                                |
| `paste`                    | `app`, `text`, `format: "text"\|"md"\|"html"`                                                      | 写系统剪贴板 → 粘贴 → **还原用户原剪贴板内容**；推荐用于富文本/多行                                                                                                                                                  |
| `screenshot`               | —                                                                                                  | 独立截屏（不建 App 会话）                                                                                                                                                                                            |

另有 `start_audio_recording` / `stop_audio_recording`（录系统音频，走同一 MCP 服务器，见 §16.7）。

### 5.2 iMessage 工具族（独立 MCP 服务器，双审批存储）与 Record & Replay / 历史工具

MCP 注册全量共 **24 个工具**：computer-use 12 + iMessage 7（`find_chats` / `search_chats` / `search_messages` / `read_messages` / `read_image` / `send_message` / `count_message_activity`，`send_message` 内部拆为 prepare/commit 两段式）+ Record & Replay 3（`event_stream_start` / `event_stream_stop` / `event_stream_status`）+ 1（`computer_history_status`）。

`find_chats` / `search_chats` / `search_messages` / `read_messages` / `read_image` / `count_message_activity` / `send_message`（内部拆为 `prepare_send` + `commit_send`）。设计细节非常值得复刻：

- **分页游标**（`next_cursor`，要求原样回传，禁止跨响应复用 `local_ref` 映射）；
- **发送两段式**：prepare 生成待发内容 → 用户在审批界面**可编辑**（`user_edited`）→ commit 提交；不支持的反应/编辑/撤回明确指向"用 Computer Use 操作 UI 完成"；
- **拒读话术防绕过**（原文）：_"Read access was not approved. No content was returned. **Do not ask the user to approve access or retry. Do not fall back to Computer Use or other tools** to access the withheld content unless the user explicitly requests that alternative."_
- 权限过滤透明化：`permission_filtered: true` + 原因说明，允许"页内消息少于 limit 但仍有 next_cursor"。

### 5.3 工具描述中的行为约束（直接写进 tool description）

- `get_app_state` 每 assistant turn 必须先调（"once per assistant turn"）；
- 动作后**无需 sleep**："运行时会自动等待合适时间再抓新状态（约 1 秒；检测到 loading 指示等状态变化迹象最多再加 5 秒）"——把时序处理从 prompt 责任下沉到运行时（Linux 侧对应实现 `action_settler.js`）;
- 优先 `element_index`，坐标只是兜底；AX 异常时切换"截图 + 坐标 + 按键"；
- `list_apps` 不要只为解析 bundle id 而调；先直接 `get_app_state(app 名)`，失败再用 bundle id 重试一次。

### 5.4 随包 SKILL.md（给模型的操作手册 + 确认策略分类学）

插件内 `skills/computer-use/SKILL.md` 是完整的模型侧手册，其中 **Computer Use Confirmations Policy** 值得整段复刻，它是四档风险分类学（编号体系）：

1. **必须移交用户**：提交改密码、绕过 HTTPS/付费墙安全屏障；
2. **动作时必确认（预批准无效）**：删除数据、账号/权限/API 密钥、解 CAPTCHA、安装/运行新软件、对第三方表达性操作（发消息/表单/点赞）、订阅/退订、金融交易、改系统安全设置、医疗操作；
3. **初始 prompt 明确预批准即可**：登录与浏览器权限弹窗（"打开 xyz.com"隐含同意登录 xyz.com）、年龄验证、第三方确认弹窗、上传文件、本地/云上文件移动改名、传输敏感数据（必须"具体数据 + 具体目的地"）；
4. **无需确认**：Cookie 同意、ToS 接受、下载文件、以及一切不改变浏览器/UI 状态的动作。

配套"确认卫生学"：第三方内容永不构成授权；模糊指令不是总授权；确认必须解释风险与机制；数据传输要在"输入前一刻"确认；已确认且无新增风险不重复打扰。

---

## 6. 感知层：AX 树 + 截图双通道

来自服务二进制 `ComputerUseCore` / `AccessibilitySupport` 模块符号（共 2737 + 3716 个）：

### 6.1 AX 树引擎

- `ApplicationUIElement.flatTree(for: WindowUIElement, contextType:, transformed:, includingMenus:)` —— 按窗口展开扁平 AX 树；`UIElementTree.add/addMenuBarWithImmediateItems/focusTree/transformed/trimURLs/render` 完成裁剪与渲染。
- **LM 可读渲染**：`LMReadableElement.lmReadableDescription(for: UIElementContextType)`；`UIElementRenderTree` 输出带缩进/焦点标记/行选项的文本；`AccessibilityNode` 提供 `presentationActions`（次级动作列表）、`isSentByCurrentUser`、`rowIndexRange/columnIndexRange`（表格语义）、`placeholderValue`、`help`、`url` 等。
- **增量 diff**：`UIElementTreeRevision.appending(tree:)` + `UIElementRenderDifference` —— get_app_state 默认返回"相对上一次的增删改"，`disableDiff` 才给全量（JS 侧同名字段）。这是 token 效率的核心。
- **元素寻址与防陈旧**：元素以 `elementID`（序列化为字符串的整数索引）寻址；错误枚举揭示一整套陈旧处理：`elementNoLongerValid`、`elementAmbiguousAfterRefetch`、`elementNoLongerValidAfterRefetch`、`elementIsOOPButExpectedToTargetAppAndNoEligibleParentElementWasFound`、`elementPresumedOOPAndNotFound`（OOP = 越进程元素）——失败时**重取树（RefetchableUIElement / RefetchableSkyshotAXTree）再定位**，而不是让模型重试。
- **子集描述符**：`AXPartialValue/AXArraySubsetDescriptor` + `visibleChildrenIfChildrenExceedsThreshold` —— 超大列表只取可见子集并标注子集位置（"第 1–20 项，共 3,412 项"式语义），避免全树爆炸。
- **URL 缩短**：`UIElementURLShortener.Configuration` + `trimURLs` —— AX 文本中的长 URL 统一短化，既省 token 又防注入长串。
- **能力检测**：`AXUIElementIsAttributeSettable`（决定 set_value 可用性）、`AXUIElementCopyActionNames/ActionDescription`（决定 perform_secondary_action 候选）、`AXEnhancedUserInterface`（`enableAccessibilityIfNeeded` 主动为目标 App 打开 AX 增强，首次访问 lazily 加载的 App 尤其重要）。

### 6.2 截图（Skyshot / Appshot）

- 屏幕录制权限：`CGPreflightScreenCaptureAccess` / `CGRequestScreenCaptureAccess`，`ScreenCaptureKit` + `CGWindowList*` 双路径；`CGWindow`（SystemSoftware 模块）封装窗口几何/层级/归属。
- `get_app_state` 返回的截图是**关键窗口级**（key window）而非全屏；`ComputerUseSkyshotAttachment` 管理附件生命周期（file:// URL 交给宿主 emitImage）。
- `Appshot` 模块含 `AppshotCaptureTransition(sourceWindow: CGWindow, animationTarget:, appIcon:)` —— 从目标窗口"飞出"截图的动画过渡（与 Appshot.wav 音效配合），属于 UX 层。
- Windows 的 Window2 API 更进一步：一次状态返回**多块有界截图**（`originX/originY/width/height/zIndex`），覆盖窗口 + 相关瞬态 UI（菜单/弹层），模型可以同时看到被遮挡层级。

### 6.3 会话与生命周期

- `ComputerUseAppInstanceManager` / `ComputerUseAppInstance`（SerialExecutor 串行化每 App 操作）："Start an app use session if needed"——同一 App 的连续操作共享会话（窗口、坐标系、上次树快照）。
- `AppUsageCatalog`（SQLite 持久化）记录 14 天 App 使用频率/最近使用时间，支撑 `list_apps` 排序与"Transparently launch"判断。
- `FrontmostWindow` / `frontmostApplicationTracker`（NSWorkspace 通知 + AX Observer）：服务持续跟踪前台应用，为"非前台操作"与中断检测提供基线。

---

## 7. 执行层：语义优先、事件兜底的注入体系

### 7.1 两级执行路径

1. **语义路径（AX）**：
   - 点击 → `AXUIElementPerformAction(AXPress)`；
   - 设值 → `AXUIElementSetAttributeValue(kAXValueAttribute)`（`set_value`，Slack/AppleMusic 指令大量推荐以规避 Return 误发）；
   - 次级动作 → `perform_secondary_action`（AXActionNames 枚举）；
   - 文本选择 → parameterized attribute（`AXSelectedTextRange` 等）+ `select_text` 的文本定位算法（prefix/suffix 消歧）。
2. **事件路径（CGEvent 定向注入）**：`SynthesizedEvent` 类型即事件描述符（反汇编确认最终调用 `SystemSoftware.CGEventAPI.postToPid`）：

```swift
// 关键 API（从符号表还原）
SynthesizedEvent.click(at:andDragTo:mouseButton:count:flags:inWindow:windowBounds:…)
SynthesizedEvent.moveMouse(to:inWindow:windowBounds:windowUsesFlippedCoordinates:)   // 坐标系换算
SynthesizedEvent.scroll(at:deltaX:deltaY:inWindow:windowBounds:…)
SynthesizedEvent.type(string:) / .pressKeys([SAIVirtualKeyPress]) / .pressKeysForHolding(…)
SynthesizedEvent.notifyAppActivated(windowID:windowBounds:activationPoint:)          // "假激活"通知
SynthesizedEvent.notifyAppDeactivated() / .notifyWindowKeyFocusRemoved() / .notifyWindowKeyFocusReturned()
SynthesizedEvent.send(to: pid, delay:) / .send(delay:)          // 定向投递 / 全局投递
static SynthesizedEvent.humanClickInterval                      // 拟人点击间隔
CGEventAPI.postToPid(_, pid:) / .post(_, tap:) / .tapCreateForPid(pid:…) / .keyboardSetUnicodeString(…)
```

要点：

- **键盘输入 = `CGEventCreateKeyboardEvent` + `keyboardSetUnicodeString`**：先把字符挂到事件上再投递，绕过键盘布局映射（`TISCopyCurrentKeyboardLayoutInputSource` 用于取当前布局做 key code 换算）；`type_text` 逐字符合成并按 Return 规则处理 `\n`。
- **点击注入有拟人化**：`humanClickInterval`（点击间固定节奏延迟，**反汇编实测 = 0.1 秒**，§18.2）、`alwaysSimulateClick`（某些元素 AXPress 无效时强制走事件模拟）、`insideWebView` 特判（WKWebView 内坐标偏移处理）、click_count（双击/三击）与 `CGEventFlags`（点击时按住修饰键）。
- **`UIElementProtocol.click(_:count:delay:alwaysSimulateClick:)` 是"语义优先、事件兜底"的直接证据**：同一入口先试 AX，失败降级事件。
- **拖拽**：`click(at:, andDragTo:)` 一次调用完成按下-移动-释放序列。

### 7.2 状态回读的"稳定等待"

每次动作后 `get_app_state` 由**运行时**负责 settling：约 1s 基础等待；检测到 loading 指示/状态变化迹象追加最多 5s（SKILL.md 明示）。这消除"动作后立刻截图拿到旧状态"的经典竞态（Spotify.md 甚至把它写成 App 专属指令："不要 sleep，直接再 get-state 确认"）。

---

## 8. 非前台控制（不抢焦点的关键技术）

这是该系统最精华的部分，四个机制叠加：

### 8.1 事件定向投递（postToPid）

CGEvent 不投 `kCGHIDEventTap`（全局硬件层），而是 `CGEventPostToPid` 直达目标进程。事件不经过窗口服务器焦点路由，**用户当前 App 保持前台**。键盘同理——字符事件带 Unicode 字符串投给目标 PID。

### 8.2 激活/焦点的"通知式伪造"

`notifyAppActivated(windowID:windowBounds:activationPoint:)` / `notifyWindowKeyFocusReturned()` 等合成事件：把"你被激活了/焦点回来了"作为**事件字段**发给目标进程，让 App 内部状态机认为自己是焦点（否则很多控件收到点击/键盘会丢弃）。配合 `SyntheticAppFocusEnforcer`（自带 `clickEventTap`）与 `CGEventRef` 扩展字段 `focusTheftID / focusThiefAlsoStoleTypingFocus / subjectPID / targetBundleID`——服务对"谁真的抢了焦点"有字节级观测，专门区分 agent 注入的焦点切换与真实用户切换。

### 8.3 进程级事件监听（tapCreateForPid）

`EventTap(for: location: placement: options: eventTypes:)` + `tapCreateForPid` + 自动重启（`shouldAutoreenable`，CGEventTap 被系统禁用后自愈）。用于两个目的：

- **UserInteractionMonitor**：监听用户在目标 App 上的真实输入 → 触发 `computerUseAppControllerDidReceiveUserInterruption`（见 §9.1）；
- 焦点窃取检测（上面的 focusTheft 字段）。

### 8.4 设计规范上的保证

- Window2 API 显式提供 `activate_window` 作为**逃生舱**，并注明"输入方法会自动激活目标窗口"——即正常路径不需要激活，激活是异常兜底；
- Chrome/浏览器走专用插件通道（`NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME`），"Prefer this method … over alternatives (such as Computer Use)"——能不走 GUI 就不走；
- AX 语义操作天然不涉及焦点（`AXUIElementPerformAction` 是进程间调用，不是事件）。

**复刻含义**：非前台控制的可行组合 = AX 优先 + postToPid 兜底 + 焦点通知伪造。纯 Electron/JS 做不到 2、3，必须有原生 helper（Swift 或 C/NAPI）。

---

## 9. 人机协同：中断、审批、Esc、锁屏

### 9.1 实时中断（人一动手，agent 让路）

- `ComputerUseUserInteractionMonitor`：字段 `currentProcessID / monitoringLoop / onAppInterrupted / resolveTarget / state` —— 按 App 目标循环监听真实用户输入；
- 一旦检测到用户操作目标 App → `NSNotification computerUseAppControllerDidReceiveUserInterruption` → 当前动作中断，服务端错误码 `userIntervened(-10016)`（或用户按停止 → `userStoppedSession(-10012)`）；
- JS 策略层把两者映射为 `terminalStatus: "cancelled"` 并要求模型用自然语言转述（"因为你接管了，我停下来了"），**禁止**倾倒原始错误；
- `InterruptedAction` / `UserInterruptedIntervention` 类型与 `CODEX_APP_TURN_STATUS_INTERRUPTED` 状态贯通到会话层。
- 键盘兜底：状态浮窗文案 "Esc to cancel"（config.json），Esc 全局取消回合。

### 9.2 审批流（协议内建，非 prompt 约定）

`computer-use-policy.js`（完整可读）定义了每次工具调用的包装：

```
withComputerUsePolicy(toolName, args, inner):
 1. 冻结参数（Object.freeze，app 属性不可变）——防 TOCTOU
 2. getAppPolicy(app) → 服务端裁决
    ├─ denied    → "blocked from using the app … by your organization's policy"
    ├─ forbidden → "not allowed … for safety reasons"
    └─ allowed   → 继续（附带 appPath 回填进冻结参数）
 3. 需要审批时 → nodeRepl.createElicitation({
      message: 'Allow Computer Use to use "X"?',
      meta: { codex_approval_kind:"mcp_tool_call", connector_id:"computer-use",
              persist: allowPersistentApproval ? ["session","always"] : ["session"],
              riskLevel, subtitle?, tool_call_id, tool_name, tool_params_display:[…] } })
 4. accept 且 persist=always → 写入 appApprovalStorage（sessions/*.toml 的 [apps] allowed）
 5. withComputerUseToolTelemetry 包裹执行：durationMs + terminalStatus(completed/cancelled/failed)
```

审批 UI 数据里最有价值的是 `tool_params_display`（把 `{app: "com.apple.Music"}` 翻译成 "App: 音乐"）与 `riskLevel`/`warningSubtitle`（服务端下发的风险分级与警示副标题）。录音审批单独走 `requestComputerAudioApproval`（riskLevel: high，仅 session 级持久）。

### 9.3 锁屏守护（独立进程 + 授权插件）

- `CUALockScreenGuardian.app` 通过 XPC 协议 `SAILockScreenGuardianClientXPCProtocol` 与服务通信：`beginUnlockGuardForThreadID:withReply:` / `completeUnlockGuardForThreadID:didUnlock:` / `retainAutoUnlockedLeaseForThreadID:` / `releaseAutoUnlockedLeaseForThreadID:` / `lockScreenGuardianDetectedPhysicalInput`；
- 服务端 `LockScreenGuardianCoordinator`：`withUnlockGuard(threadID:)` 包裹会话；`setPhysicalInputHandler` / `setPendingUnlockPhysicalInputHandler`（锁屏界面上的物理输入回调——用户回来输密码时服务能感知并协调）；`setConnectionLossHandler`（守护进程死亡兜底）；
- **解锁授权插件**：Installer 以 `system.privilege.admin` 提权把 `CodexComputerUseAuthorizationPlugin.bundle` 装进 SecurityAgentPlugins，支撑"自动解锁租约"（`allow_locked_computer_use` 配置开关控制是否允许）；
- 锁屏期间工具直接失败 `screenLocked(-10020)`；
- `SkysightPauseDuration`（paused/thirty_minutes/one_hour/until_tomorrow）同样适用于屏幕观察子系统。

### 9.4 观察策略（用户可控的"它能看到什么"）

`ComputerUseIPCSkysightObservationRule`（matches host / url / bundleIdentifier）+ `ObservationDefaultBehavior` + `UpdateObservationPolicyRequest`：用户可按 App/域名配置黑名单；`ComputerUseURLBlocklist` / `URLPolicyChecking` / `blockedURL(-10015)` 与通知 `eventStreamServiceURLPolicyStateDidChange` 构成执行侧强制。`SkysightObservationSuppressionReason`（含 `FocusStealSuppression`）记录"为何此刻没有记录"。

---

## 10. 可视化：虚拟光标、状态浮窗、状态栏

### 10.1 虚拟光标 ComputerUseCursor

符号揭示的完整形态：

- 独立 `Window`（`_TtCC11ComputerUse17ComputerUseCursor6Window`）悬浮于目标窗口之上（`targetWindowID` 绑定）；
- `Style`：`velocityX/velocityY`（运动速度）、`scootStretchXScale/scootStretchScale/scootStretchAngle/scootStretchPivotX`（移动时的"果冻"拉伸挤压形变）、`angle`、`isPressed`（按压形变）、`activityState`、`isAttached`；
- `MotionConfiguration`（运动曲线）与 `CloseEnoughConfiguration`（**就近吸附**：目标点接近时自动贴合元素中心，消除坐标误差观感）；
- `AppMonitor`（目标 App 变化时跟随/隐藏）、`shouldFadeOut`（空闲淡出）、`CursorNextInteractionTiming`（下一次交互的节奏）；
- API：`show/orderOut/move/press`；`FogCursorStyle`（"Fog" 模块——辉光/雾化视觉）。

Agent 的每一次点击用户都看得见——**这不是装饰，是审批 UX 的一部分**（用户能预判下一秒哪里会被点）。

### 10.2 实况浮窗（RemoteHostedPIP）

`RemoteHostedPIPContentProducer/Publisher/Stream/Renderer/CheckerboardRenderer/Fence/WindowGeometryObserver/WindowOwnership/ConnectionDiagnostics`：把服务侧捕获的目标窗口内容推流到一个 PIP 浮窗（"ChatGPT is using your computer" + 实况画面），含几何跟随、所有权仲裁、诊断事件。`CUAServiceRemoteHostedPIPController` 管理其生命周期。

**补充（第五轮）**：浮窗的建立由宿主发起——`sky.node` 通过 Apple Event `com.openai.codex.remote-hosted-pip.bootstrap` 向服务传递 mach rendezvous 端口，服务回以 `NSXPCListenerEndpoint` 完成连接移交（§17.2）；浮窗视觉由宿主配置（appearance/blur/controlOpacity/iconColor），虚拟光标坐标作为内容流事件推入浮窗渲染。

### 10.3 状态栏与回合联动

- 状态栏图标由**宿主**持有（`sky.node` 的 `SkyCreateStatusItem/DestroyStatusItem/UpdateStatusItemState/UpdateStatusItemMenuState`），服务经 `CodexStatusItemMenuState`（IPC 双向）同步"正在使用电脑 + 最近使用 App 列表"菜单内容；前端资源 `computer-use.svg`、`computer-history*.svg` 在 ChatGPT.app 内；
- `ComputerUseIPCCodexTurnEndedRequest`（notify 钩子）：回合结束 → 状态解除；
- `computerUseAppControllerDidUpdateSkyshot`：截图更新通知，驱动浮窗刷新。

---

## 11. 反馈给 Agent 调用方的完整链路

一次典型 `get_app_state` 的完整数据流（自上而下）：

```
模型发出 MCP 工具调用 (call_id/item_id)
  → codex app-server 注入 x-codex-turn-metadata
  → node_repl 宿主暴露为 requestMeta
  → @oai/sky JS：withComputerUsePolicy（审批）→ MacComputerUseClient.getAppState
  → native-pipe JSON-RPC（deadline、apiVersion、turnMetadata）
  → 服务端 ComputerUseIPCServer → AppController（等价会话建立/复用）
      → AX 树抓取 + diff（vs 上一revision）→ Skyshot 截图（ScreenCaptureKit/CGWindow）
      → 自动 settle 等待（~1s，loading 时 +≤5s）
  → 响应: { app, screenshot:{url: file://…png}, text: "<AX 文本/diff>" }
  → JS: window_result 包装 → nodeRepl.write(state.text)；emitImage(截图)
  → 遥测: CodexComputerUseMcpToolCalled {toolName, transport, durationMs, terminalStatus…}
  → response meta: codex/toolSurface = {app: {appId, kind:"appId"}, kind:"computerUse"}
     （Chrome 额外标记 codex/computerUseChrome=true，供宿主引导走浏览器插件）
```

给调用方的反馈一共五类，缺一不可：

1. **状态数据**：AX 文本（diff 优先）+ 截图 file URL（宿主负责转多模态输入）；
2. **错误语义**：协议错误码（§4.4）——模型据此自愈（换 bundle id 重试、感知被锁屏/被介入）；
3. **元数据回写**：`setResponseMeta`（toolSurface）让宿主知道"这回合用了哪个 App"，驱动状态栏与策略；
4. **遥测与审计**：每次工具调用（`CodexComputerUseMcpToolCalled`）、每次审批（`AppApprovalRequested/Resolved`）、每次 IPC 失败（`ComputerUseIpcRequestFailed`）、每次截图（`AppshotCaptureFinished`）、Skysight 工具调用（`SkysightMcpToolCalled` 带 model/reasoningEffort）全部走 protobuf 埋点；
5. **回合边界事件**：turn-ended 通知 → UI 状态复位。

---

## 12. Skysight：屏幕记忆与事件流子系统

CUA 的"操作"与 Skysight 的"观察"共享同一个服务进程与 IPC：

- **事件流**（`EventStreamService/EventStreamRecorder/EventStreamRecord/EventStreamAXElement/EventStreamMetadata`）：后台滚动记录前台 App/窗口/AX 文本/浏览器 URL 域名/终端输出等，受观察策略（App/域名规则）与暂停档位（30 分钟/1 小时/明天前）控制，落 SQLite；
- **摘要**：`SkysightSummarizer`（随包提示词全文 234 行）把事件流压缩成 **10 分钟/6 小时两级 Markdown 记忆**（YAML frontmatter：title/description/applications/suggestion），存 `$HOME/.codex/memories/extensions/skysight/resources/`，供后续 agent 会话"接续上下文"；
- **提示词安全工程**（可直接复用的范本）：观察内容全部视为不可信污点（"Untrusted taint is sticky"）、禁止把观察到的指令转成规则、禁止存储秘密/PII/律师-委托人特权内容、输出必须"描述性而非指令性"、引用只允许本地路径、敏感内容最小化；
- **建议生成**：摘要器可产出 `suggestion: {type: skill|automation}` —— 从用户行为中挖掘可固化的技能/自动化建议（含判定准则与反例）；
- **记忆整合**：`SkysightMemoryInstructions`（21 行）规定 phase2 记忆整合如何引用 Skysight 资源并打 `[skysight memory]` 标签；
- **Record & Replay**：`computer-history` CLI（"Get Computer History status and paths to recent activity files"）+ `event_stream_status` + 录制上限 30 分钟 + `secure-delete`/`delete-all`（含 `SkysightClearHistoryScope`），是完整的"录屏回放 + 数据清退"工具面。

---

## 13. 安全与权限模型

| 层       | 机制                                                                                                                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TCC 权限 | 服务持有 Accessibility（`AXIsProcessTrusted`）、Screen Recording（`CGPreflightScreenCaptureAccess`）、AppleEvents、Contacts（iMessage 附件人名解析）；`PermissionRequirement`（78 个符号）+ `PermissionRowRegistry` + `PermissionWindowController` 做权限引导 UI（"ChatGPT needs these permissions to take appshots…"） |
| 进程边界 | socket 0600 + SenderContext 认证（`senderProcessNotAuthenticated`）；权限集中在服务进程，agent/宿主无法绕过                                                                                                                                                                                                             |
| App 边界 | 服务端策略（allowed/denied/forbidden）+ 审批存储 + 风险分级下发                                                                                                                                                                                                                                                         |
| URL 边界 | URL 规则/blocklist（`blockedURL`），观察与操作双层生效                                                                                                                                                                                                                                                                  |
| 锁屏边界 | screenLocked 阻断 + Guardian 物理输入感知 + 可配置的受控解锁                                                                                                                                                                                                                                                            |
| 内容边界 | 防提示注入：read_messages 拒读话术防"换工具绕过"；Skysight 提示词的污点隔离；AppInstructions（按 App 覆盖的 7 份指令）本身也是注入面管控的一部分                                                                                                                                                                        |
| 行为边界 | SKILL.md 四档确认分类学 + "确认卫生学"；敏感数据传输的"具体数据+具体目的地"规则                                                                                                                                                                                                                                         |
| 隐私出口 | 截图/录音需单独审批；观察历史提供 scope 化清除与 secure-delete                                                                                                                                                                                                                                                          |

---

## 14. 跨平台设计（Linux / Windows）

`@oai/sky` 单包三目标（`create_client.js` 分发）：

- **Linux**（`target:"linux"`，社区确认桌面端 Linux 预览尚无 CUA UI，但运行时已打包）：全桌面 API（`get_screenshot/click/drag/drag_handle/move/press_key/scroll/type_text`），X Window keysym 键名（`Control_L+a`、`Super_L+d`），截图为 JPEG data URL + bytes + filepath；**drag_handle** 是亮点：start/move_to/end 三段式拖拽，每段之间可以截图观察再决定下一步（多步拖拽协议）。点击支持 `duration`（按住毫秒）与点击时按住键位（`key` 字段）。
- **Windows**（`target:"windows"`，WGC = Windows Graphics Capture 测试脚本佐证）：**Window2 API**（§6.2 提到的有界截图/zIndex/screenshotId 缓存），窗口寻址（`Window{app,id,title}`），`activate_window` 逃生舱，结构化 accessibility state（document_text/focused_element/selected_elements/selected_text + tree）。
- **macOS**：App 级 API（本文主体），AX 最完备，非前台能力最强。

三代 API 的演进方向明确：**坐标全桌面 → App 会话 → 窗口对象**，粒度越细、上下文越省、权限越准。复刻时应直接以"窗口/会话为锚"设计。

---

## 15. 复刻方案（面向 Spark-Agent）

> **实施蓝图已独立成文**：[computer-use-开发实施规格书](./computer-use-开发实施规格书.md)（IPC 协议规格、12 工具完整 schema、AX 引擎/注入器/审批算法伪码、Swift 包结构、测试验收表、M1–M4 里程碑）。本章保留决策依据与总纲。

以下按"必须 1:1 对齐的设计决策"→"可裁剪项"→"分阶段路线"组织。Spark-Agent 现状：Electron 桌面端（`apps/desktop`）+ TS monorepo（`packages/agent-runtime` 已有 MCP 服务管理、workflow 执行器、会话服务），macOS 优先。

### 15.1 架构总图（复刻形态）

```
┌─────────────────────────────────────────────────────────────┐
│ agent-runtime（Node/TS，现有）                                 │
│  ComputerUseToolProvider：10 工具注册 + 审批策略包装 + 遥测       │
└──────────────┬──────────────────────────────────────────────┘
               │ JSON-RPC 2.0 over UNIX socket（复用 §4 帧协议设计）
┌──────────────▼──────────────────────────────────────────────┐
│ SparkCUAService（Swift 常驻 helper，LSUIElement）              │
│  · AXEngine：AXTree 构建/diff/LM渲染/元素陈旧重取                │
│  · Injector：AX 优先 + CGEventPostToPid 兜底 + 焦点通知伪造      │
│  · Skyshot：ScreenCaptureKit 截图                              │
│  · InterruptionMonitor：PID 级 EventTap                        │
│  · CursorOverlay：虚拟光标窗口        StatusItem：状态栏         │
│  · PermissionCoordinator：TCC 引导                             │
└──────────────┬──────────────────────────────────────────────┘
        （可选二期）LockGuardian 独立进程 + 授权插件
```

关键取舍：**必须用 Swift 原生服务**。Electron 渲染进程拿不到 AX 权限语义；CGEventPostToPid、tapCreateForPid、AXUIElement 都需要原生层。Node 与 Swift 之间用我们已经熟悉的 socket + JSON-RPC（agent-runtime 已有 MCP/IPC 基建可复用）。

### 15.2 逐项对齐表（功能 → 复刻要点）

| 能力         | 对齐设计决策                                                                                                                  | Spark-Agent 落点                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 会话模型     | App 会话 + 关键窗口锚定 + 每回合先 get_app_state                                                                              | `session.service.ts` 增加 cua 会话表；工具描述写死"once per turn"                 |
| AX 感知      | 树渲染带 element_index/action 列表/占位符；**diff 默认、全量可选**；超大容器可见子集描述符；URL 短化                          | Swift AXEngine + TS 侧快照缓存（revision）                                        |
| 元素陈旧     | 失败自动重取树再定位；错误枚举区分 noLongerValid/ambiguous/OOP                                                                | Swift 侧自愈，模型永远拿到"重试后"的结果或确定性错误                              |
| AX 渲染管线  | **Markdown 渲染 + sourceOffsets 反向映射**（§16.2）；diff 行数预算 + 递归预算 + `[truncated to visible range]`                | select_text 的前提；预算防止大 App 树爆炸                                         |
| 动作回带状态 | 动作响应直接携带 `SkyshotCapture`（新截图+新树，`returnSkyshot` 参数）                                                        | 减少一轮 get_app_state 往返（§16.1）                                              |
| 回合绑定     | turn 结束即工具锁定（"unavailable because the current turn ended"），thread/turn 粒度状态机                                   | 防跨回合漂移；对齐 agent-runtime 的回合模型                                       |
| AX 属性覆盖  | 130 个 AX 常量的覆盖清单（§17.1）：text-marker、表格行列、菜单快捷键、ScrollByPage 动作、BusyChanged 通知、Electron 强制开 AX | Swift AXEngine 的功能清单直接照此实现                                             |
| settle 检测  | `AXElementBusyChanged` 通知 + `AXProgressIndicator` 角色 + 动画 token，非盲等                                                 | Swift 侧注册 busy 通知驱动 settle（比定时更准）                                   |
| 宿主桥       | `sky.node` 模式：状态栏/图标/前台窗口查询由**宿主侧原生模块**持有，服务只管控制面；PIP 经 Apple Event + mach rendezvous 移交  | Spark-Agent（Electron）等价物 = Native NAPI 模块或独立 Swift helper，职责划分照抄 |
| 语义执行     | set_value（AXValue）、perform_secondary_action（AXActionNames）、select_text（文本+前后文消歧）                               | 同左；`AXUIElementIsAttributeSettable` 预检                                       |
| 事件兜底     | postToPid + keyboardSetUnicodeString + 窗口坐标系换算（含 flipped）+ humanClickInterval                                       | Swift Injector；坐标一律"截图像素 → 窗口逻辑坐标"的服务端换算                     |
| 非前台       | 焦点通知伪造（notifyAppActivated 等）+ 禁用全局激活（activate 只作逃生舱）                                                    | Injector 必做，否则打扰用户                                                       |
| 自动等待     | 动作后 settle：1s 基线 + loading 检测追加 ≤5s；工具描述声明"无需 sleep"                                                       | Swift 侧 loading 启发式（AX 忙碌标记/进度指示器存在性）                           |
| 审批         | elicitation 协议（persist session/always、riskLevel、params_display、冻结参数防 TOCTOU）                                      | 复用现有审批 UI；审批存储放 per-session toml（对齐 `sessions/*.toml` 格式）       |
| 中断         | PID EventTap → userIntervened；Esc 全局取消；错误码区分 userIntervened/userStoppedSession                                     | CursorOverlay 进程内实现；聊天流回写"已因你的接管而暂停"                          |
| 锁屏         | screenLocked 错误；物理输入感知；auto-unlock 租约列为二期可选                                                                 | 一期：NSDistributedAttribute 锁屏通知 + 直接报错                                  |
| 可视化       | 虚拟光标（吸附+按压+淡出）+ 状态栏"正在使用"+ turn-ended 复位                                                                 | CursorOverlay（SwiftUI）+ Electron 托管状态同步                                   |
| 反馈         | 五类反馈全链路（§11）；turn metadata 贯穿（call_id/item_id）                                                                  | agent-runtime 已有 trace 体系，补 toolSurface response meta                       |
| 遥测         | 工具调用/审批/IPC 失败/截图四类事件 + durationMs + terminalStatus                                                             | 复用现有 telemetry sink                                                           |
| 记忆（可选） | Skysight 两级摘要 + 观察策略 + secure-delete                                                                                  | 二期；提示词直接参考随包 Summarizer.md 的安全条款                                 |
| iMessage 等  | 读/发分离双审批 + 两段式发送 + 防绕过拒读话术                                                                                 | 按需做；话术模板直接复用                                                          |

### 15.3 工具面定义（建议照抄的十二个工具）

直接采用 §5.1 的工具名/参数/描述（英文描述可原样保留——它们经过实战调优，特别是 "once per assistant turn"、"element index 优先"、"do not guess action names"、"\n 会发送消息" 四条警示）。含 `paste`（剪贴板还原语义）与 `screenshot`；`start/stop_audio_recording` 按 §16.7 的参数区间与审批语义补齐。

### 15.4 提示词资产清单（可直接借鉴的四份）

1. `SKILL.md` 的确认策略分类学（四档 + 卫生学）——照搬后按 Spark-Agent 业务裁剪编号；
2. `AppInstructions/*.md`（Clock/Slack/Spotify/Notion/Numbers/AppleMusic/iPhone Mirroring）——按 App 覆盖指令的形态："先 get-state 确认状态机→再用 set_value 而非 type_text→避免 Return 误发"的写法范式；
3. `SkysightSummarizer.md` 的防注入/输出安全条款（若做记忆子系统）；
4. read_messages 的拒读话术（任何"读不到就别绕"的场景通用）。

### 15.5 风险与工作量评估

| 风险                   | 说明                                                     | 缓解                                                                                                                              |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| TCC 引导体验           | AX/屏幕录制授权弹窗流程繁琐且用户易拒绝                  | 服务启动即 `CGRequestScreenCaptureAccess`+`AXIsProcessTrusted` 预检，PermissionWindow 分步引导（对齐 PermissionRowRegistry 模式） |
| 签名与分发             | 原生服务需独立签名+公证；授权插件需提权安装              | 一期不做授权插件（放弃锁屏自动解锁），仅做锁屏阻断                                                                                |
| WebView/游戏等 AX 盲区 | Electron/WebView AX 不全、全屏游戏无 AX                  | 坐标 + 截图兜底路径必须与语义路径同等健壮                                                                                         |
| 稳定性                 | AX 树抓取在大型 App（Xcode/Chrome 200+ tab）可能秒级耗时 | 可见子集描述符 + 树缓存 + deadline 取消                                                                                           |
| 安全                   | 等于给 agent 了一个"全能后门"                            | socket 认证 + App 白名单 + URL 黑名单 + 审批默认拒绝 + 全量遥测，一个都不能省                                                     |

分阶段：

- **M1（感知+语义执行）**：Swift 服务骨架、socket JSON-RPC、AX 树渲染/diff、set_value/click(AX)/type_text/press_key/scroll、get_app_state、权限引导。
- **M2（事件兜底+非前台）**：Injector（postToPid、Unicode 注入、坐标换算、拟人节奏）、焦点通知伪造、自动 settle。
- **M3（人机协同）**：审批协议、中断监测、Esc 取消、虚拟光标、状态栏、遥测闭环。
- **M4（增强）**：锁屏守护、iMessage 双审批工具族、Skysight 记忆、Windows/Linux 目标。

### 15.6 一句话的设计哲学（写进我们自己的设计文档）

> 权限集中在单一服务、语义优先像素兜底、一切打断可感知、一切危险先审批、一切操作可遥测、用户随时接管且接管永远赢。

---

## 16. 第四轮深挖补充（执行引擎、渲染管线与全量注册细节）

第四轮对服务/客户端二进制做了逐模块符号提取与 JS 逐文件阅读，以下是此前章节之外的全部增量结论。

### 16.1 执行引擎完整 API（`ComputerUseAppController` 导出方法签名，逆向所得）

```swift
// 生命周期
init(applicationTarget: SystemSoftware.ApplicationTarget, chatID: String?,
     isAXTreeDiffingEnabled: Bool) throws          // 会话绑定 chatID；diff 可按会话关闭
static func all -> [ComputerUseAppController]        // 活跃会话注册表
static func for(app: NSRunningApplication) -> Self?  // / for(pid: Int32)
activate() / deactivate()
activateFocusEnforcer() -> SyntheticAppFocusEnforcer

// 观测
updateSkyshot(treeCache: TransformedUIElement.TreeCache?, disableAXDiffing: Bool,
              skipScreenshot: Bool) -> SkyshotCapture        // 可复用上次的 AX 事务缓存
updateSkyshotSettlingIfNeeded(disableAXDiffing: Bool) -> SkyshotCapture  // 需要时先 settle

// 动作（全部支持 returnSkyshot: 动作结果直接带回新截图+新树）
click(at: [Int]?, with: CGMouseButton, clickCount: Int, andDragTo: CGPoint?,
      returnSkyshot: Bool) -> SkyshotCapture?           // 元素路径或坐标 + 拖拽一体
click(elementID: Int, type: ClickType?, numberOfClicks: Int?, returnSkyshot:) -> SkyshotCapture?
leftMouseDownUp(isDown: Bool, returnSkyshot:) -> SkyshotCapture?        // 拖拽原语
moveMouse(to: [Int]?, cursorNextInteractionTiming: CursorNextInteractionTiming)
performKeyboardAction(_: KeyboardAction, text: String?, duration: Int?,
      waitForUIToSettle: Bool, returnSkyshot:) -> SkyshotCapture?       // duration = 按住毫秒
performPaste(text: String, format: IPCPasteFormat, returnSkyshot:) -> SkyshotCapture?
performSecondaryAction(elementID: Int, action: String, returnSkyshot:) -> SkyshotCapture?
scroll(deltaX: Int, deltaY: Int)
selectText(elementID: Int, text: String, prefix: String?, suffix: String?,
           selection: IPCTextSelection, returnSkyshot:) -> SkyshotCapture?
setValue(elementID: Int, value: String, returnSkyshot: Bool,
         autosubmitSearchFields: Bool) -> SkyshotCapture?   // 搜索框自动提交开关（AppleMusic.md 对应）

// 交互前置管线：解析元素 → 虚拟光标移动到位 → 返回可重取的树
prepareToInteract(with: Int, cursorNextInteractionTiming:, positionElement: Bool)
      -> (RefetchableSkyshotAXTree, UIElement…)
positionElement(_: UIElement, cursorNextInteractionTiming:?, axTree:) -> Bool

// 窗口
orderedWindows() -> [WindowUIElementProtocol]

// 结果对象
SkyshotCapture { attachment: ComputerUseSkyshotAttachment,
                 axTree: RefetchableSkyshotAXTree, imageSize: CGSize? }

// 内部状态（IVAR，全部带锁或观察者）
lastAXTree / isAXTreeDiffingEnabled / axEnablementAssertion（对懒加载 App 保持 AX 激活的断言）
windows: [CGWindowID: WindowUIElement] / _lastWindow / windowObserver(AXNotificationObserver)
orderingObserver: WindowOrderingObserver / terminationObserver
_currentlyOpenedMenu / _currentlyFocusedMenuBarItem（OSAllocatedUnfairLock，动作期间打开的菜单并入树）
needsUISettleBeforeSkyshot / scaledScreenSize / scalingFactor / visibleRect /
cursorPositionInScaledCoordinates（截图像素 ↔ 屏幕坐标 双向换算状态）
skyshotImageFiles: Set<SlimCore.File>（截图文件生命周期）/ signposter: OSSignposter（性能打点）
virtualCursor / focusEnforcer
```

设计要点（复刻必抄）：

- **动作返回 `SkyshotCapture`**：点击/输入的响应就携带"动作后的新 AX 树 + 新截图"，模型不必每次动作后再单独 `get_app_state`（那 10 个工具的描述却说"动作后再 get_state"——即两者都支持，由 settle 机制保证一致性）。
- **`prepareToInteract` 把"移动虚拟光标到目标"作为动作前置步骤**：可视化与执行同步，`CursorNextInteractionTiming` 控制光标先行的节奏。
- **坐标换算是会话状态**：`scalingFactor`（Retina 倍率）、`visibleRect`（窗口滚动偏移）、`scaledScreenSize` 缓存在控制器上，`CursorPosition.applying(scalingFactor:convertingToScreenFromWindowFrame:)` 一次完成"截图像素 → 屏幕点"。
- **菜单是树的一部分**：动作打开的菜单/聚焦的菜单栏项被跟踪（`_currentlyOpenedMenu`），抓树时并入（对照 Slack.md 里"右键菜单中的 AX"场景）。

### 16.2 AX 树渲染为 Markdown + 反向文本映射（select_text 的实现根基）

符号链完整还原了渲染管线：

- `NSAttributedString.axAttributedStringAsMarkdown(context:)` —— AX 富文本 → Markdown；
- `TransformedUIString.StringInterpolation.appendMarkdownLink(url:role:)` —— 链接以 Markdown 语法输出（配合 `UIElementURLShortener` 缩短）；
- **`appendMappedString(_:sourceOffsets:)` + `sourceRange(forMarkdownRange:)`** —— 渲染时记录"Markdown 字符区间 → AX 源文本区间"的映射。这就是 `select_text` 能接受"Target text as shown in the accessibility tree"并精确落回 AX 元素文本区间的机制：模型引用的是它看到的渲染文本，服务端通过 offset 映射反查原始范围，再设置 `AXSelectedTextRange`。
- 预算与截断：`AccessibilityDifferenceLineBudgetExceeded`（diff 行数预算）、`AXTruncationDescriptor`、渲染行内 `[truncated to visible range]` 标记、树遍历 `recursionBudget` —— 输出尺寸受硬预算控制，超限降级而不是失败。
- `AccessibilitySupport.KeyWindowTracker`（`onKeyWindowChanged` / `canBecomeKeyWindow`）——"key window"语义的实现与窗口切换跟踪。

### 16.3 IPC 发送方认证与双传输（补全 §4）

- **基于代码签名的发送方认证**：遥测字段 `cua_ipc_sender_parent_executable / parent_signing_id / parent_team_id / responsible_bundle_id / responsible_executable / responsible_signing_id / responsible_team_id` —— 服务端用 SecCode 属性链（父进程 + responsible process）校验调用方身份，配合错误码 `senderProcessNotAuthenticated` / `couldNotGetSenderPID` / `couldNotGetBootstrapPort`（XPC bootstrap 经 Apple event 获取失败的场景）。
- **双传输并存**：`ComputerUseIPCXPCTransport`（NSXPCConnection + Mach 接收端口，`computerUseIPCXPCInterface()` 导出接口）供 ChatGPT 主 App 使用；**native pipe（Unix socket，§4 帧协议）供 node_repl/codex 使用**。同一套 `ComputerUseIPC*Request` 编解码跑在两种载体上。
- **服务自动回收**：`cua_service_idle_timeout_reached` + `shutdownOnBackground` —— 无客户端时服务自杀，下次调用按需拉起（launch-on-demand 完整闭环）。

### 16.4 按回合锁定（turn-scoped availability）

`ComputerUseIPCCodexTurnEndedRequest(threadID: String, turnID: String?)` + 客户端 `ComputerUseCodexTurnEndedCommand`（"Handles a Codex turn-ended notification"，即 config.toml 的 notify 钩子）。回合结束后再调工具会得到：

> "Computer Use is unavailable because the current turn ended. It will work again after the next user message."

即 **CUA 会话状态与 agent 回合强绑定**（thread/turn 粒度），防跨回合漂移；`ComputerUseMCPTurnMetricsTracker` 的 `turnStates`（带 `turnStateTTL`）就是这层状态的容器。

### 16.5 AppInstructions 的服务端投递机制（补全 §6）

- 服务端持有 `Package_ComputerUse.bundle/Resources/AppInstructions/*.md`（按 App 命名：AppleMusic/Clock/Notion/Numbers/Slack/Spotify/iPhone Mirroring），在 `get_app_state` 响应中作为 **`appSpecificInstructions` 字段**随 AppState 返回；
- JS 层（`window_result.js`）将其包成 `<app_specific_instructions>…</app_specific_instructions>` **前置到 AX 文本之前**，并按 bundle id 去重（每会话每 App 只注入一次；`com.apple.iWork.Numbers` 被硬编码排除）；
- 客户端 `ComputerUseMCPServer` 的 IVAR `appInstructionDeliveryState` 说明 MCP 直连形态下也有同等的投递状态机。
- 二进制中内嵌了已知目标 bundle id（`com.spotify.client`、`com.tinyspeck.slackmacgap`、`com.openai.atlas*` 等），用于指令匹配与特定处理。

### 16.6 遥测与指标全 schema（补全 §11）

JS 侧 Statsig 客户端：key `client-br04gwIKFntB05BUONtNnF3NhWQsvmSI8R97Pigr7A5`，配置端点 `https://ab.chatgpt.com/v1`，事件上报 `https://chatgpt.com/ces/v1/rgstr`。

| 事件                                                                        | 字段                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CodexComputerUseMcpServerLaunched`                                         | `transport: "stdio"`                                                                                                                                                                                                                                                                  |
| `CodexComputerUseMcpToolCalled`                                             | `toolName, terminalStatus(completed/cancelled/failed), durationMs, mcpErrorPresent, invocationSource: "code_mode", mcpServerName: "node_repl", pluginId: "computer-use@openai-bundled", transport: "native_pipe", bundleIdentifier, threadId, turnId, itemId, model, reasoningEffort` |
| `CodexComputerUseMcpAppApprovalRequested / Resolved`                        | `bundleIdentifier, toolName, eventCreatedAt, approvalResult, approvalPersistence`                                                                                                                                                                                                     |
| `CodexComputerUseIpcRequestFailed / IpcAuthorizationFailureReason`          | 服务端维度（含 §16.3 的 sender 字段）                                                                                                                                                                                                                                                 |
| `CodexComputerUseIdleTimeoutReached / ServiceLaunched / ServicePermission*` | 服务生命周期                                                                                                                                                                                                                                                                          |
| `CodexComputerUseAppshotCaptureFinished`                                    | 截图完成                                                                                                                                                                                                                                                                              |

**回合性能指标**（分析观测环效率，命名即定义）：

```
computer_use_mcp_time_to_first_get_app_state
computer_use_mcp_time_to_first_write
computer_use_mcp_time_from_first_get_app_state_to_first_write
computer_use_mcp_time_from_end_of_first_successful_get_app_state_to_first_write
```

turn metadata 全字段：`thread_id|threadId|session_id`、`turn_id`、`item_id|call_id`、`model`、`reasoning_effort|model_reasoning_effort`（多别名兼容）。

### 16.7 音频与 Record & Replay

- **系统音频采集 = ScreenCaptureKit `SCStream/SCStreamConfiguration`**（与截图同管线，音频随视频流一起拿）；
- `start_audio_recording({max_duration_ms})`：合法区间 **100ms–300,000ms（5 分钟）**，默认 60s；审批为 high-risk、仅 session 级持久；`stop_audio_recording` 返回 `{filepath, bytes, data_url: audio/wav}`，停止期间用 `nodeRepl.withSuspendedTimeout` 挂起宿主超时；
- **Record & Replay**：审批文案原文——"Allow ChatGPT to record your actions on your Mac? ChatGPT will start recording your mouse clicks, text you type, and the content in windows you interact with until you press Stop (up to 30 minutes). You can cancel any time."；录制事件模型 `UIRecorder.Event`：`MouseInteraction{button, clickCount, EventType}`、`KeyPressInteraction{key, modifiers}`；产物为 `metadata.json` + 事件文件（`event_stream_status` 返回路径）；配套 `computer_history_status`、`secure-delete`/`delete-all`（`SkysightClearHistoryScope`）。

### 16.8 iMessage 实现路径

- **读取 = 直查 chat.db（SQLite）**：SQL 联表 `chat/handle/chat_handle_join/message/attachment`；群聊/单聊用 `chat.guid` 中的 `;+;` / `;-;` 标记判别；支持未读范围、分页游标、按 handle 参与者过滤、附件元数据联查；
- **发送 = ScriptingBridge**（`MessagesCore.MessagesApplication` / `SBApplicationProtocol`，错误串 "…is unexpectedly not an SBApplication"）——读写分离，读走数据库、发走 AppleScript 通道；
- 审批遥测：`CodexMessagesApprovalOperation/Persistence/Result`、`CodexMessagesMcpApprovalRequested/Resolved`；权限引导串 "Messages permission setup is still open"。

### 16.9 tinysky_alt：App 与 Tab 的统一 Target 抽象（新一代 API）

`@oai/cua` 暴露的全局 `cua = {computer, browsers, documentation}`：

```ts
interface Target {           // App 和 Tab 实现同一接口 —— 桌面与网页自动化同一动作词汇
  getAXState(options?): Promise<string>;
  getScreenshot(options?): Promise<Uint8Array>;
  getAXStateAndScreenshot(options?): Promise<{state, screenshot?}>;  // 一次调用两样都拿
  paste(text, {format}) / click(target: index|Point, {mouseButton, clickCount})
  drag(from, to) / pressKey(key) / scroll(target, direction, pages?)
  selectText(index, text, {prefix, suffix, selectionType}) / setValue(index, value)
  typeText(text) / performSecondaryAction(index, action)
}
interface Tab extends Target { goto/back/forward/reload/close/markDeliverable/markHandoff }
```

- 文档按需注入：首次输出前自动前置 `tinysky-alt-core.md`（200 行）+ 按浏览器缓存的 API 文档，输出有 **47,936 字节截断预算**（二分截断保留头部）；
- 浏览器类型三态：`"iab" | "extension" | "cdp"`（应用内浏览器 / Chrome 扩展 / CDP 直连）；
- 策略依然成立："The accessibility API is the most efficient way… Playwright locators only for long repetitive tasks or testing sites you're developing."

### 16.10 平台实现补充

- **Windows**（SKILL.md 原文）："Automates apps via **SendInput and UI Automation**, and takes screenshots of app windows via **Windows.Graphics.Capture** that works even if they are occluded." —— 与 macOS 的"AX 语义 + 定向事件 + 遮挡可截"完全同构；
- Windows 独有的容错指令：点错到 `StartMenuExperienceHost.exe` 时 → `activate_window` 后刷新截图重试一次；弹窗可能出现在 owned secondary window，`list_windows()` 找模态窗单独抓态；
- **macOS SKILL（oai_sky_lib 版）比插件版少 paste/screenshot**，且明确禁止 AppleScript/JXA/System Events/CGEvent synthesis——所有交互必须走 sky（审计与策略一致性要求）。

### 16.11 其他零散但重要的确认

- 通知全集：`computerUseCursorDidFinishMove / DidHide / locationDidChange`（光标事件也进事件流）、`computerUseAppControllerDidBecomeActive/Inactive/DidUpdateSkyshot`、`eventStreamService{RecordingState,URLPolicyState,ObservedApplications}DidChange`、`com.openai.codex.computer-use.status-item-state-changed`（跨进程 Distributed）；
- 锁屏：`lockScreenLoginAuthorizationSocketServer`（**授权插件回调的 socket 服务端**跑在主服务里）+ `SystemLockScreenSettleObservation` / `relockOverlaySettleObservation` / `lockUISettleDelay`（锁/解锁过渡期的 UI 稳定等待）；
- 截图含光标捕获配置（`CursorCaptureConfiguration/CursorCaptureKey`）——skyshot 可选择把虚拟光标渲染进截图；
- 宿主 node_repl 为定制 Mach-O 二进制（非脚本），能力面：`nativePipe(22)/createElicitation(29)/emitImage(31)/launchServices(14)/requestMeta(9)/setResponseMeta/withSuspendedTimeout(8)/x-codex-turn-metadata(6)`；
- Chrome 通道：native messaging host `com.openai.codexextension` + 两个扩展 ID，浏览器客户端/服务脚本从插件缓存加载；`@oai/browser-desktop` 为"Production browser runtime for Codex Desktop"；
- 全局状态键：`computer-use-bundled-plugin-auto-install-disabled`（插件自动安装开关）；
- Skysight 落库：SQLite（`SkysightSegmentStore/SegmentWriter`）+ `metadata.json`，历史目录 `$CODEX_HOME/memories/extensions/skysight/resources/`（支持 ad_hoc 临时段）。

---

## 17. 第五轮深挖补充（AX 引擎属性面、宿主桥 sky.node、回放提示词组）

### 17.1 AX 引擎属性面全量（130 个 AX 常量，感知能力的真实边界）

服务二进制实际使用的 AX 常量覆盖面（即它"读得到/做得到"的范围）：

- **文本标记全套（Web/Chromium 深度支持）**：`AXTextMarker/AXTextMarkerRange/AXStringForTextMarkerRange/AXAttributedStringForTextMarkerRange(+WithOptions)/AXSelectedTextMarkerRange/AXStartTextMarker/AXNextLineEndTextMarkerForTextMarker` —— 对网页内容的文本定位走 text-marker 而非字符偏移，配合 `AXAttributedStringMarkdownWriter` 直接产出 Markdown；
- **表格/网格语义**：`AXSelectedCellsChanged/AXSelectedColumns/AXSelectedRowsChanged/AXColumnHeaderUIElements/AXColumnIndexRange/AXRowCountChanged/AXVisibleColumns`；
- **菜单快捷键渲染**：`AXMenuItemCmdChar/Glyph/Modifiers/VirtualKey/MarkChar` —— 菜单项能显示快捷键（"复制 ⌘C"级别的信息）；
- **滚动动作**：`AXScrollUpByPage/ScrollDownByPage/ScrollLeftByPage/ScrollRightByPage/ScrollToShowDescendant/AXScrollToVisible` —— 这就是 AppleMusic.md 里"用 Scroll Up/Down action 滚动"的来源，比模拟滚轮稳定；
- **加载/忙碌检测**：`AXElementBusyChanged` 通知 + `AXProgressIndicator` 角色 —— settle 机制的"loading 指示器检测"实现；
- **Electron/Chromium 激活**：`AXManualAccessibility` + `AXEnhancedUserInterface`（`enableAccessibilityIfNeeded` 设置）—— 首次访问 Electron App 时强制开启其 AX 树；
- **结构语义**：`AXTitleUIElement/AXServesAsTitleForUIElements/AXLabelUIElements/AXLinkedUIElements/AXDisclosedByRow/AXDisclosureTriangle/AXPlaceholderValue/AXHelpTag/AXKeyShortcutsValue/AXDateTimeComponents`（Clock 时间选择器）/`AXTextualContext(+SourceCode)`（代码上下文识别）；
- **呈现动作**：`AXPress/AXConfirm/AXPick/AXRaise/AXIncrement/AXDecrement/AXShowMenu/AXDelete/AXCancel` + `AXIncrementButton/DecrementButton/IncrementArrow/DecrementArrow/OverflowButton`。

配套抽象：`AccessibilityPresentationAction{kind, description}`（动作带人类可读描述）、`UIElementFlattenedRole{separator, description, targetDescription}`（"table > row > cell"式链式角色）、`AXPartialValue/AXArraySubsetDescriptor`（大数组子集描述符）。

### 17.2 宿主桥 `sky.node`（ChatGPT.app 内的 Swift NAPI 模块）

位置 `/Applications/ChatGPT.app/Contents/Resources/native/sky.node`（1.2MB，模块名 `SkyNative`，源文件 `SkyNative/CGWindow.swift`、`SkyNative/StatusItemController.swift`）。**宿主侧的全部原生能力**：

```swift
// 状态栏（菜单栏图标由宿主持有，而非服务）
SkyCreateStatusItem / SkyDestroyStatusItem / SkyUpdateStatusItemState / SkyUpdateStatusItemMenuState
// 窗口与图标查询（给 PIP/会话 UI 用）
CGWindow{allWindows(relativeToWindow:), id, bounds, level, name, ownerName, ownerPID, isOnscreen}
skyFrontmostWindowJSON(pid) -> JSON
skyIconSmallDataURLForAppPath / skyIconMediumDataURLForAppPath
```

关键机制与安全设计：

- **PIP 引导走 Apple Event + Mach rendezvous port**：宿主发 Apple Event `com.openai.codex.remote-hosted-pip.bootstrap`，`sendBootstrapToServiceWithProcessIdentifier:rendezvousPort:attempt:` 把 mach 端口递给服务 → 服务端 `RemoteHostedPIPContentPublisher.endpointForHostConnection()` 返回 `NSXPCListenerEndpoint` 完成连接移交；失败有受管重连（"requesting managed CUAService reconnect…"）与拒绝处理；
- **光标位置进 PIP 流**：`remoteHostedPIPContentComputerUseCursorLocationHandler` —— 虚拟光标坐标作为内容流事件推给宿主渲染；
- PIP 视觉配置：`remoteHostedPIPAppearance/Blur/ControlOpacity/IconColor`；
- **服务身份校验**：`computerUseServiceProcessMatchesExecutablePath` —— 宿主校验正在运行的 CUAService 进程可执行路径是否匹配预期（防替换/劫持）；
- 状态导出：`computerUseActive/Available`、`computerHistoryAvailable/Enabled/Running/State`。

### 17.3 内嵌回放提示词组（Record & Replay 的模型侧命令，服务二进制内嵌）

事件段目录约定：`events.jsonl`（append-only 活动事件）+ `suppressed.jsonl`（被抑制事件单独落盘，含 `FocusStealSuppression` 等原因）+ `metadata.json`。四个内嵌提示词命令（`{{EVENT_STREAM_PATH}}` 模板注入）：

1. **`describe-activity`**：输出 Summary + Goals 两段，"Use only the event stream as evidence… If the stream is too sparse or ambiguous, say that directly and name the missing signal"；
2. **`suggest-next-actions`**：建议 ≤3 个下一步动作（JSON：`title` 短祈使句 / `why` 事件流证据 / `prompt` 可直接发给 Codex 的用户提示词），"包括可能用到 Computer Use 的动作"，宁缺毋滥；
3. **`Create Memory MD`**：生成 Computer History 风格 `memory.md`（Summary/Evidence/Useful Future Context/Open Questions），"不包含凭据、token、原始事件 JSON"；
4. **`draft-replay-plan`**：回放计划，**工具选择策略**——"优先用可用的连接器或专用工具完成稳定语义操作，仅对不支持的 UI 交互或依赖视觉的验证用 Computer Use"；结构含 Preconditions / Replay steps（每步标注所用通道）/ Verification / Ambiguities。

### 17.4 客户端多 MCP 服务器形态（同一二进制）

`SkyComputerUseClient` 的子命令实为四类 MCP 服务器入口 + 运维命令：

| 子命令              | 实质                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `mcp`               | Computer Use 工具 + 音频（§5.1/§16.7）                                                     |
| （iMessage 族）     | Messages MCP 服务器（`MessagesMCPServer(readDecisionStorageURL:sendApprovalStorageURL:)`） |
| `record-and-replay` | "Runs the Record & Replay client as an MCP server"（event*stream*\* 三工具）               |
| `computer-history`  | "Runs the Computer History client as an MCP server"（computer_history_status 等）          |
| `turn-ended`        | notify 钩子（§16.4）                                                                       |
| `app-server`        | 内嵌 codex app-server 客户端（取 auth 状态等宿主功能）                                     |

### 17.5 codex Rust 侧补充

- app-server 在 MCP 请求头注入 **`x-codex-turn-metadata` 与 `x-codex-turn-state`**（另有 `x-codex-parent-thread-id`、`x-openai-subagent`），有特性开关 `turn_metadata_includes_tool_info` 控制 tool_info 是否随元数据下发；
- **elicitation 是协议级实现**（Rust 侧含 `elicitationId`、`codex_approval_kind: elicitation|mcp_tool_call`、`persist: session|always`、`risk_level` 全字段），审批 UX 由宿主统一渲染；
- `ComputerUseRequirementsToml{allow_locked_computer_use, allow_persistent_approval}` 是服务端策略裁决（`allowed/denied/forbidden`）之外的**宿主级需求闸门**，与 §16.4 的回合锁定配合。

---

## 18. 第六轮验证与硬数据（反汇编级实证）

### 18.1 关键断言的硬验证（双端交叉）

| 断言          | 验证方式               | 结果                                                                                |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| API 版本      | 两个二进制分别提字符串 | `CodexComputerUseIPC-5` 在服务端与客户端**同时存在** ✓                              |
| socket 端点   | 客户端字符串           | `computeruse.sock` ✓（JS 侧拼接的 Group Container 路径与之吻合）                    |
| XPC mach 服务 | 服务端字符串           | `com.openai.sky.app` ✓（客户端侧为 fallback bundle id `com.openai.sky.CUAService`） |
| 事件流 JSONL  | 服务端字符串           | `events.jsonl`（append-only）/ `suppressed.jsonl` / `metadata.json` ✓               |

### 18.2 拟人化常量实测（反汇编）

`SynthesizedEvent.humanClickInterval` 为一次 `swift_once` 初始化的静态量：初始化闭包加载 `__const` 段双精度常量 **`0.1`** 传入 `Duration` 构造 → **合成点击之间的固定间隔 = 0.1 秒**。settle 等待（基线约 1s、loading 追加至多 5s）为 SKILL.md 文档级确认（运行时由 `AXElementBusyChanged`/进度指示器驱动，见 §17.1）。

### 18.3 AX 树 diff 的真实算法

`UIElementRenderDifference.init(oldRender: [UIElementRender], newRender: [UIElementRender])` —— **在渲染行级别做树对比**（不是对 AX 原始树）：

- `Change{path: IndexPath, offset: Int, depthFirstOrder, description}`，`inheritElementID()` 让变更继承被替换元素的 ID（index 稳定性）；`lines(indent: Character, options:)` 生成带缩进的变更行；
- 输出含 "Removed element IDs: " 清单（删除的元素以 ID 列表形式告知模型）；
- 会话级开关 `isAXTreeDiffingEnabled` + 服务端特性开关 `feature/axTreeDiffing`，`DifferenceBaseline` 管理对比基线；
- 超预算抛 `AccessibilityDifferenceLineBudgetExceeded`（§16.2）。

**复刻含义**：diff 应对"渲染后的文本行"做 LCS/结构对比，并为每个 Change 保留元素锚点（ID 继承），这样模型看到的 `+/-/±` 行仍可寻址。

### 18.4 锁屏检测与授权插件通道（Guardian 实现细节）

- **检测机制**：`CGSessionCopyCurrentDictionary` 查 `CGSSessionScreenIsLocked` 键（`SystemLockScreenMonitor.swift`）——经典的 console session 字典轮询/监听，不依赖私有通知；
- **协议族**（面向协议的完整抽象）：`LockScreenMonitor`（检测）、`LockScreenController`（控制）、`LockScreenOverlayPresenter`（`SystemLockScreenOverlayPresenter.swift`，锁屏期间的覆盖呈现）、`LockScreenPhysicalInputMonitor`（物理输入）、`LockScreenLoginAuthorizationApprover`（授权裁决）；
- **授权插件 ⇄ 服务通道**：Unix socket `/tmp/com.openai.sky.CUAService/LockScreenLoginAuthorization.sock` —— 装在 SecurityAgentPlugins 的插件在锁屏界面内通过该 socket 与服务通信（这是 `lockScreenLoginAuthorizationSocketServer` 的另一端）；
- **请求 trait 门控**：`ComputerUseIPCRequestRequiringSystemPermissions`（需要系统权限的请求）、`ComputerUseIPCRequestExemptFromLockScreenAutoUnlock`（豁免于锁屏自动解锁门控的请求）、`ComputerUseIPCAppUsageRequest`（使用统计）——IPC 层按 trait 自动施加权限/锁屏/审计策略，业务代码不用重复判断。

### 18.5 枚举补全（事件流/历史工具的取值域）

- **Skysight 暂停档位**：`paused` / `thirty_minutes` / `one_hour` / `until_tomorrow`（+ `running`）；
- **Computer History 时间范围**：`last_ten_minutes` / `last_hour` / `last_day` / `interval`（自定义区间）/ `application_session`（按 App 会话）；
- **传输枚举**：`apple_evxpc` / `json_rpcent`（遥测里区分请求载体）；
- `count_message_activity` 完整语义：按日历区间分桶（`counts_by_bucket`，total/sent/received 三数组按索引对齐，**空桶也要出现**），overall 或 per-chat ranked 分页，`next_cursor` 续传时必须携带原始过滤参数。

---

## 附录 A：证据文件清单

| 证据          | 路径                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 服务主二进制  | `~/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService`（22,940,944 B，153,115 nm 符号）                                                                                                                                                                                                                                                                |
| 客户端二进制  | `…/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient`（14,025,136 B）                                                                                                                                                                                                                                                                                      |
| 守护/安装器   | `…/CUALockScreenGuardian.app`、`…/Codex Computer Use Installer.app`                                                                                                                                                                                                                                                                                                                 |
| 提示词资产    | `…/Package_ComputerUse.bundle/Contents/Resources/{SkysightSummarizer.md, SkysightMemoryInstructions.md, AppInstructions/*.md, LensSequence/*.png}`                                                                                                                                                                                                                                  |
| 会话状态      | `~/.codex/computer-use/{config.json, sessions/*.toml}`                                                                                                                                                                                                                                                                                                                              |
| 插件手册      | `~/.codex/plugins/cache/openai-bundled/computer-use/1.0.1000919/{.mcp.json, plugin.json, bin/computer-use-client-launcher, skills/computer-use/SKILL.md, .codex-plugin/computer-use-node-repl.md}`                                                                                                                                                                                  |
| JS 客户端源码 | `/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky/dist/project/cua/sky_js/src/**`（含 `targets/mac/{client,native-pipe,computer-use-policy,computer-use-telemetry,errors,get_app_state}.js`、`targets/{linux,windows}/`、`docs/{sky-full-desktop-api,sky-window-api,sky-window2-api}.md`、`docs/skills/oai_sky_lib/{macos,linux,windows}/SKILL.md`） |
| codex 集成    | `~/.codex/config.toml`（notify/plugins/mcp_servers 段）、`~/.codex/ipc/ipc.sock`、codex Rust 二进制（`ComputerUseRequirementsToml` 等符号）                                                                                                                                                                                                                                         |
| 统一 CUA 包   | `…/cua_node/lib/node_modules/@oai/cua/dist/lib/js/oai_js_cua/src/{cua.js, tinysky_alt/*}` + `docs/tinysky-alt-{core,other-browser-apis}.md`                                                                                                                                                                                                                                         |
| 浏览器运行时  | `…/node_modules/@oai/browser-desktop/docs/*`（interruption / visibility / confirmations / screenshots 等 23 份）                                                                                                                                                                                                                                                                    |
| 宿主运行时    | `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl`（定制 Node 二进制）、`…/Resources/native/sky.node`（Swift NAPI 宿主桥）、`~/.codex/chrome-native-hosts-v2.json`                                                                                                                                                                                               |
| 权限佐证      | 各 Info.plist / `codesign -d --entitlements` 输出（TeamID 2DC432GLL2）                                                                                                                                                                                                                                                                                                              |

## 附录 B：IPC 请求类型全集（符号还原）

```
App 生命周期:  AppStart / AppStop / AppModify / AppPerformAction / AppGetSkyshot
              AppStartCapture(Animation{Target,Rect,Color,Display}) / AppNextCaptureUpdate
发现与查询:    ListApps(DiscoveredApp) / FrontmostWindow
策略:         AppPolicy(AppPolicyResult{decision: allowed|denied|forbidden, target, allowPersistentApproval})
状态对象:     AppState / Skyshot / SkyshotResult / Screenshot / CaptureUpdate / TargetDescriptor
音频:         StartAudioRecording / StopAudioRecording(AudioRecordingResult)
Skysight:     Start/Stop/Status/Pause/Resume/GetSettings/UpdateSettings/
              UpdateObservationPolicy(ObservationRule/ObservationSettings/ObservationDefaultBehavior)/
              ClearHistory(HistoryInterval)/State
事件流:        EventStreamStart/Stop/Status(SessionStatus/EndReason)
iMessage:     MessagesFindChats/SearchChats/SearchMessages/ReadMessages/ReadImage/
              PrepareSend(PreparedSend)/CommitSend(SendResult)/CountActivity
              (Chat/Message/Participant/ChatReference/ChatMetadata/MessageAttachment/
               ChatsPage/MessagesPage/ChatActivity/ActivityCount/ActivityRange/ActivityBreakdown)
Codex 联动:    CodexStatusItemMenuState(+StateNotification/RecentApplication) / CodexTurnEnded
传输:         IPCXPCTransport / IPCClient / IPCServer / IPCSenderContext / IPCRequest(+FileHandles)
```

## 附录 C：Swift 模块与关键符号表（服务二进制 Top 模块）

```
OAIProtobuf 21361 | SwiftProtobuf 5380 | MCP 3716 | AccessibilitySupport 2737 |
ComputerUse 2382 | ComputerUseClient 2072 | SQLite 1856 | SlimCore 1629 | Markdown 1471 |
MessagesCore 836 | ComputerUseCore 651 | ContactsCore 308 | SystemSoftware 282 |
Fog 219 | SoftLink 130 | Statsig 958 | ArgumentParser 456 …

关键类型（节选）:
ComputerUseAppController(+CursorPosition/virtualCursor) · ComputerUseAppInstance(Manager/SerialExecutor)
SynthesizedEvent · CGEventAPI(postToPid/tapCreateForPid) · EventTap · SyntheticAppFocusEnforcer
ComputerUseUserInteractionMonitor · ComputerUseCursor(Window/Style/MotionConfiguration/
CloseEnoughConfiguration/AppMonitor/FogCursorStyle) · RemoteHostedPIP*(Producer/Publisher/
CheckerboardRenderer/Fence/GeometryObserver) · CUALockScreenGuardianClient ·
LockScreenGuardianCoordinator · LockScreenController/Monitor · PermissionRequirement/
PermissionWindowController · Skyshot · Appshot(CaptureTransition) ·
ComputerUseMCPServer(appApprovalStorageURL) · MessagesMCPServer(readDecision/sendApproval) ·
EventStreamService/Recorder · SkysightService/SkysightSummariser · AppUsageCatalog(SQLite)
```

---

## 参考来源（开源情况与官方佐证）

- [Computer Use — ChatGPT Docs](https://learn.chatgpt.com/docs/computer-use)（macOS 权限项即 "Codex Computer Use"）
- [Codex for (almost) everything — OpenAI](https://openai.com/index/codex-for-almost-everything/)（桌面端 computer use 发布公告）
- [MacStories: OpenAI's New Codex App Has the Best 'Computer Use' Feature I've Ever Tested](https://www.macstories.net/notes/openais-new-codex-app-has-the-best-computer-use-feature-ive-ever-tested/)
- [OpenAI Community: Codex in ChatGPT desktop app for Linux is now in preview](https://community.openai.com/t/codex-in-chatgpt-desktop-app-for-linux-is-now-in-preview/1390027)（Linux 暂无 CUA）
- [OpenAI Community: sky.node thread exhaustion crash report](https://community.openai.com/t/macos-chatgpt-codex-launches-once-after-clean-install-then-crashes-on-every-subsequent-launch/1391717)
- 本地逆向为第一手来源；GitHub 上无 "Codex Computer Use" 开源仓库（开源的仅为 codex CLI）。

> GitNexus 说明：本次任务为纯逆向研究与文档产出，未修改本仓库任何代码符号，按 AGENTS.md 降级规则未使用 GitNexus。
