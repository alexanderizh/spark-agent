# Computer Use 开发实施规格书（Sky CUA 复刻）

> 状态: 待开发（基于六轮逆向分析，见 [codex-computer-use-逆向解析与复刻方案.md](./codex-computer-use-逆向解析与复刻方案.md)） | 最后核对: 2026-09-05

> 本文档是逆向解析文档的配套**实施蓝图**：所有接口签名、协议字段、算法伪码、里程碑验收标准均直接取自逆向证据（标注 §N 对应解析文档章节）。目标：Spark-Agent 桌面端获得与 Codex Computer Use 同构的 macOS UI 自动化能力。

---

## 目录

1. [目标与范围](#1-目标与范围)
2. [总体架构与模块划分](#2-总体架构与模块划分)
3. [IPC 协议规格（可直接实现）](#3-ipc-协议规格可直接实现)
4. [MCP 工具规格（12 工具完整 schema）](#4-mcp-工具规格12-工具完整-schema)
5. [AX 引擎规格（感知层核心算法）](#5-ax-引擎规格感知层核心算法)
6. [注入器规格（执行层核心算法）](#6-注入器规格执行层核心算法)
7. [人机协同子系统规格](#7-人机协同子系统规格)
8. [可视化子系统规格](#8-可视化子系统规格)
9. [存储与数据结构](#9-存储与数据结构)
10. [安全实现清单](#10-安全实现清单)
11. [测试与验收](#11-测试与验收)
12. [里程碑计划（M1–M4）](#12-里程碑计划m1m4)

---

## 1. 目标与范围

### 1.1 MVP 交付边界（对齐原版 §5.1 的 12 工具）

| 包含                                                                                                                                                                      | 不含（二期+）                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| macOS App 会话式控制：list_apps / get_app_state / click / perform_secondary_action / set_value / select_text / scroll / drag / press_key / type_text / paste / screenshot | iMessage 工具族、Record & Replay、Skysight 屏幕记忆、系统音频录制 |
| AX 语义优先 + CGEvent postToPid 兜底 + 焦点通知伪造（非前台控制）                                                                                                         | 锁屏自动解锁（一期只做锁屏阻断）                                  |
| 审批协议（elicitation + session/always 持久化）+ 组织策略位                                                                                                               | Windows / Linux 目标                                              |
| 虚拟光标可视化 + 状态栏联动 + 用户中断（userIntervened）                                                                                                                  | Record & Replay 提示词组                                          |
| 按回合锁定（turn-scoped availability）+ 全链路遥测                                                                                                                        | 授权插件（SecurityAgentPlugins）                                  |

### 1.2 技术选型（逆向结论决定，无悬念）

| 组件         | 选型                                                                                         | 依据                               |
| ------------ | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| 控制服务     | **Swift 独立常驻进程**（LSUIElement App 或 launchd agent），持有全部 TCC 权限                | §2.2：权限集中在服务进程是安全边界 |
| Agent 侧接入 | TS（agent-runtime）直连 MCP stdio；Electron 宿主另用原生模块持有状态栏/图标（对应 sky.node） | §3.3、§17.2                        |
| 传输         | Unix socket + 4 字节长度前缀 JSON-RPC 2.0                                                    | §4.1                               |
| AX 层        | AppKit/HIServices 原生 `AXUIElement*`（130 常量面按 §17.1 清单实现）                         | §6、§17.1                          |
| 事件注入     | CoreGraphics `CGEventPostToPid` + `CGEventTapCreateForPid`                                   | §7.1、§8.1–8.3                     |
| 截图         | ScreenCaptureKit（视频+音频同管线）或 CGWindowListCreateImage                                | §16.7                              |
| 宿主桥       | Electron `N-API` 原生模块（Swift 包装），能力面照抄 sky.node 导出表                          | §17.2                              |

---

## 2. 总体架构与模块划分

### 2.1 进程拓扑（对齐 §2.2）

```
Spark-Agent 桌面端 (Electron)
├── agent-runtime (TS)：ComputerUseToolProvider —— MCP server 进程（node 子进程）
│     └── CuaClient (TS)：JSON-RPC 客户端 + 审批策略包装 + 遥测包装
├── SparkCUAService (Swift, LSUIElement)：唯一权限持有者
│     ├── IPCServer（socket + XPC 双传输，trait 门控）
│     ├── AppSessionManager（每 App 会话：AppController）
│     ├── AXEngine（树抓取/Markdown渲染/diff/select_text）
│     ├── Injector（AX 优先 + postToPid + 焦点伪造 + 拟人间隔）
│     ├── Skyshot（截图 + 文件生命周期）
│     ├── Settle（busy 驱动的稳定等待）
│     ├── InterruptionMonitor（PID EventTap）
│     ├── CursorOverlay + PermissionCoordinator + PIP(二期)
│     └── ApprovalStore（session/always 两级，per-app）
└── 宿主原生模块 (N-API)：状态栏项 / App 图标 / 前台窗口查询 / PIP 引导
```

### 2.2 Swift 包结构（建议）

```
SparkCUAService/
├── Package.swift
├── Sources/
│   ├── CUAService/                 # 主可执行（@main, LSUIElement bundle）
│   │   ├── main.swift              # 启动：权限预检 → socket 监听 → 空闲自毁计时
│   │   ├── IPCServer.swift         # JSON-RPC 路由 + SenderContext 认证
│   │   └── ServiceLifecycle.swift  # idle timeout / shutdownOnBackground
│   ├── CUAKit/                     # 核心库（无 App 依赖，可测试）
│   │   ├── AXEngine/
│   │   │   ├── AXElement.swift             # AXUIElement 包装（属性读写缓存）
│   │   │   ├── AXTreeBuilder.swift         # flatTree + 可见子集 + 菜单并入
│   │   │   ├── AXMarkdownRenderer.swift    # 渲染行 + sourceOffsets 映射
│   │   │   ├── AXTreeDiff.swift            # 渲染行级 diff + ID 继承
│   │   │   └── AXEnablementAssertion.swift # AXManualAccessibility
│   │   ├── Injector/
│   │   │   ├── CGEventAPI.swift            # post/postToPid/tapCreateForPid/unicode
│   │   │   ├── SynthesizedEvent.swift      # click/move/scroll/type/pressKeys/notify*
│   │   │   └── FocusEnforcer.swift         # 焦点通知伪造
│   │   ├── Session/
│   │   │   ├── AppController.swift         # 会话（对齐 §16.1 签名）
│   │   │   ├── AppSessionManager.swift
│   │   │   └── CoordinateSpace.swift       # scalingFactor/visibleRect 换算
│   │   ├── Settle/
│   │   │   └── UISettler.swift             # busy 通知 + 1s 基线 + ≤5s 追加
│   │   ├── Skyshot/
│   │   │   ├── SkyshotCapture.swift        # {attachment, axTree, imageSize}
│   │   │   └── ScreenshotService.swift     # ScreenCaptureKit
│   │   ├── Human/
│   │   │   ├── InterruptionMonitor.swift   # PID EventTap → userIntervened
│   │   │   ├── ApprovalStore.swift         # session/always
│   │   │   └── PolicyEngine.swift          # allowed/denied/forbidden
│   │   ├── Visual/
│   │   │   ├── CursorOverlay.swift         # 果冻光标 + CloseEnough
│   │   │   └── LockScreenMonitor.swift     # CGSSessionScreenIsLocked
│   │   └── Support/
│   │       ├── LockGuard.swift             # screenLocked 错误门控
│   │       ├── URLPolicy.swift             # 域名黑名单
│   │       └── Telemetry.swift             # protobuf/OTel 埋点
│   └── CUACLI/                     # 客户端形态：mcp / turn-ended / status
└── Tests/CUAKitTests/
```

### 2.3 TS 侧接入点（agent-runtime）

```
packages/agent-runtime/src/services/
└── computer-use/
    ├── computer-use.mcp.service.ts     # MCP stdio server（工具注册=§4）
    ├── cua-rpc-client.ts               # socket JSON-RPC 客户端（帧协议=§3.1）
    ├── cua-policy.ts                   # 审批包装（对齐 §16.6 语义）
    ├── cua-telemetry.ts                # 工具调用/审批/失败事件
    └── cua-tool-schemas.ts             # §4 的 schema 常量
```

---

## 3. IPC 协议规格（可直接实现）

### 3.1 帧与信封（对齐 §4.1，逐字段）

```
传输:   AF_UNIX socket, 路径 ~/Library/Application Support/SparkAgent/cua/cua.sock (0600)
帧:     [u32 LE 长度][UTF-8 JSON]，长度上限 8 MiB
协议:   JSON-RPC 2.0
握手:   ping {clientApiVersion} → {serverApiVersion}，不等则错误 incompatibleProtocolVersion(-10013)
请求:   request {
          clientApiVersion: "SparkCUAIPC-1",
          turnMetadata: {threadId?, turnId?, itemId?, model?, reasoningEffort?},
          deadlineUnixMilliseconds: Int64,
          requestType: String,          // 见 §3.2
          request: object               // 各类型字段
        }
错误码: 语义沿用原版 20 个（§4.4），号码原样保留便于对表
```

### 3.2 请求类型（一期实现集）

| requestType            | request 字段                            | 响应                                                                                                                                                                                  |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ListApps`             | —                                       | `{apps: [{bundleId, displayName, appPath?, isRunning, lastUsedDate?, useCount?}]}`                                                                                                    |
| `AppGetState`          | `{app: String, disableDiff: Bool}`      | `{app:{bundleId, displayName, appPath}, skyshot:{screenshot:{url,mimeType}\|null, text, appSpecificInstructions?}, risk, warningSubtitle?, allowPersistentApproval}`（对齐 §16.5/§5） |
| `AppPerformAction`     | `{app, action: oneof}`（oneof 见 §3.3） | `{skyshot?: {…同上}}`（returnSkyshot 语义）                                                                                                                                           |
| `AppStart` / `AppStop` | `{app}`                                 | `{app}`                                                                                                                                                                               |
| `AppPolicy`            | `{app}`                                 | `{decision: allowed\|denied\|forbidden, appPath, allowPersistentApproval, risk}`                                                                                                      |
| `FrontmostWindow`      | —                                       | `{pid, windowId, title?, bounds}`                                                                                                                                                     |
| `TurnEnded`            | `{threadId, turnId?}`                   | `{}`                                                                                                                                                                                  |

二期追加：`AudioStart/AudioStop`、`EventStreamStart/Stop/Status`、`HistoryStatus`、`Messages*`（对齐附录 B）。

### 3.3 action oneof（对齐 §16.1 签名与 JS 客户端字段名）

```jsonc
{ "click":   { "at": {"elementID": "42"} | {"coordinate": [x, y]},   // x,y = 截图像素坐标
               "clickCount": 1, "mouseButton": 0 }                    // 0/1/2 = left/right/middle
, "drag":    { "from": [x,y], "to": [x,y] }
, "type":    { "_0": "literal text" }                                 // 逐字符合成，\n=Return
, "pressKey":{ "_0": "super+c" }                                      // xdotool 风格
, "scroll":  { "at": {…}, "direction": "up|down|left|right", "pages": 1 }
, "setValue":{ "elementID": "42", "value": "...", "autosubmitSearchFields": true }
, "selectText":{ "elementID": "42", "text": "...", "prefix"?: "...", "suffix"?: "...",
                "selection": "text|cursor_before|cursor_after" }
, "performSecondaryAction": { "elementID": "42", "action": "Show Menu" }
, "paste":   { "text": "...", "format": "text|md|html" }              // 剪贴板还原
}
```

### 3.4 请求 trait 门控（对齐 §18.5，照抄的设计模式）

```
protocol CUARequest { var requiresSender: SenderContext { get } }
protocol RequiringSystemPermissions { static var permissions: [Permission] { get } }   // → permissionsNotGranted(-10009)/Pending(-10014)
protocol ExemptFromLockScreenAutoUnlock {}                                            // 锁屏期仍放行（如权限引导）
protocol AuditedUsage {}                                                              // 记入使用统计
```

路由器按 trait 组合施加：发送方签名认证（§10）→ 锁屏门控（`screenLocked(-10020)`）→ 权限门控 → 审计。业务 handler 只写业务。

---

## 4. MCP 工具规格（12 工具完整 schema）

命名/描述**逐字采用原版**（§5.1 表格），inputSchema 统一模式：

```jsonc
// click 示例（其余同构，字段见解析文档 §5.1 表）
{
  "name": "click",
  "description": "Click an element by index or pixel coordinates from screenshot",
  "inputSchema": {
    "type": "object",
    "properties": {
      "app": {
        "type": "string",
        "description": "App name, full app path, or unambiguous bundle identifier",
      },
      "element_index": { "type": "integer", "description": "Element index to click" },
      "x": { "type": "integer", "description": "X coordinate in screenshot pixel coordinates" },
      "y": { "type": "integer", "description": "Y coordinate in screenshot pixel coordinates" },
      "mouse_button": {
        "type": "string",
        "enum": ["left", "right", "middle"],
        "description": "Mouse button to click. Defaults to left.",
      },
      "click_count": { "type": "integer", "description": "Number of clicks. Defaults to 1" },
    },
    "required": ["app"],
  },
}
```

工具清单与关键描述原文（必须保留的警示语句）：

1. `list_apps` — "…currently running, as well as any that have been used in the last 14 days, including details on usage frequency"
2. `get_app_state` — "**This must be called once per assistant turn before interacting with the app**"
3. `click` / `drag` / `scroll` / `press_key` / `type_text` / `set_value` / `select_text` / `perform_secondary_action` / `paste` / `screenshot`
4. 每个写操作工具的响应 meta 回写 `codex/toolSurface = {app:{appId}, kind:"computerUse"}`

TS 侧策略包装（对齐 §9.2 流程）：冻结参数 → `AppPolicy` 裁决 → elicitation 审批（persist: session/always）→ 遥测包裹（durationMs + terminalStatus）→ `userIntervened/userStoppedSession → cancelled`。**审批后把 `app` 归一为 bundleId 并回填 appPath**（防 TOCTOU）。

---

## 5. AX 引擎规格（感知层核心算法）

### 5.1 树构建

```
buildTree(app, window: keyWindow, includeMenus: true):
  1. root = AXUIElementCreateApplication(pid)
  2. 若响应缺失 → 先 set AXManualAccessibility=true / AXEnhancedUserInterface=true（Electron/Chromium）
  3. focusWindow = KeyWindowTracker.current（onKeyWindowChanged 维护）
  4. depth-first 遍历（recursionBudget 上限，建议 40 层 / 5000 节点）：
       - 超阈值容器（children > 200）→ 可见子集 + 子集描述符（"…第 1–20 项，共 N 项"）
       - 动作中打开的 menu / 聚焦的 menuBarItem 并入（对齐 §16.1 状态字段）
  5. 每节点采集：role, roleDescription, title, label(AXDescription/AXValue),
       identifier(AXIdentifier), placeholder, help, url(短化), value,
       selected, focused, actions(AXActionNames→PresentationAction{kind,description}),
       boundsForRange(文本区间→屏幕坐标，select_text 用), frame
  6. 表格节点补 rowIndexRange/columnIndexRange；文本节点补 numberOfCharacters/visibleCharacterRange
```

### 5.2 Markdown 渲染 + 反向映射（对齐 §16.2）

```
renderLine(node, depth):
  line = indent(depth) + focusMark + idPrefix(node.id) + roleWord(node) + " " + quoted(title|label)
         + (node.value 非空 ? " value=..." : "") + (identifier 有效 ? " id=..." : "")
         + actions 后缀（" actions:[press, Show Menu]" 仅当非平凡动作）
  offsets[node.id] = {markdownRange → AX 文本 range 映射}     // appendMappedString 等价物

产物:
  RenderTree { lines: [RenderLine{id, text, isFocus, depth}], sourceMap: [id→NSRange] }
```

- 每元素一个稳定自增 `element_index`（渲染顺序 = depth-first 序；diff 继承保稳，见 5.3）；
- URL 以 Markdown 链接输出且经 URLShortener 截断（保 host + 截断 path，防注入长串）；
- 行级截断标记 `[truncated to visible range]`；预算：diff 行数上限（建议 1500 行），超限抛 `DifferenceLineBudgetExceeded` 并降级为"焦点子树优先"。

### 5.3 渲染行 diff（对齐 §18.3）

```
diff(oldRender.lines, newRender.lines):
  对比单位 = 行（id 感知）：
    - id 在旧有新无 → removed（收集进 "Removed element IDs: [..]" 行）
    - id 新增      → added
    - 同 id 文本变 → changed（只输出新行）
  继承规则：结构位置变化但子树内容一致 → 保留旧 id（inheritElementID 等价）
输出: 仅变更行的文本块（模型默认收 diff；disable_diff 收全量）
```

### 5.4 select_text 算法

```
selectText(elementID, text, prefix?, suffix?, selection):
  1. 取元素 AXValue/AXAttributedStringForTextMarkerRange（网页走 text-marker）
  2. 找 text 的全部匹配；>1 个时用 prefix/suffix 过滤（匹配前后各 max(0,k) 字符窗口）
  3. 仍歧义 → error elementAmbiguous
  4. 用 sourceMap 把匹配 range 换算回 AX 文本区间
  5. 可编辑 → AXSelectedTextRange 写入；cursor_before/after → 位置±0
```

### 5.5 settle（对齐 §16.1/§17.1/§18.2）

```
settle(after action):
  base = 1.0s
  监听 AXElementBusyChanged + 检测 AXProgressIndicator/加载动画 token：
    若 busy → 延长等待（上限 base+5s）
    稳定判据：连续 2 次树哈希相同 且 无 busy 标记
  needsUISettleBeforeSkyshot 标志由动作写入，settle 完成清除
```

---

## 6. 注入器规格（执行层核心算法）

### 6.1 动作决策树（对齐 §7）

```
perform(node, action):
  if action 可语义化 (AXPress/AXConfirm/AXIncrement… 且元素可达):
      AXUIElementPerformAction → 成功即返回
  else:
      合成事件序列（全部 postToPid(pid)，0.1s 拟人间隔 §18.2）：
        click:  moveMouse(to) → [down, up] × clickCount（间隔 0.1s）
                + flags（修饰键） + insideWebView 坐标特判
        drag:   down → 匀速插值移动（≥10 步） → up
        type:   逐字符 CGEventCreateKeyboardEvent + keyboardSetUnicodeString
                '\n' → Return keyCode 事件（不附字符）
        pressKey: 解析 xdotool 语法 → modifier 组合 + 主键 keyDown/Up
        scroll: createScrollWheelEvent(line 单位, pages×3 行/页) → postToPid
  失败 → alwaysSimulateClick 兜底路径（跳过语义尝试）
```

### 6.2 焦点通知伪造（对齐 §8）

```
ensureReceptiveTarget(app):
  if !app.isActive:
    notifyAppActivated(windowID, bounds, activationPoint)   // 事件字段级"假激活"
    notifyWindowKeyFocusReturned()
  // 不调用 NSRunningApplication.activate —— 永不真实抢焦点（activate 仅作为显式逃生舱）
```

### 6.3 中断监测（对齐 §9.1）

```
InterruptionMonitor(pid):
  tap = CGEventTapCreateForPid(pid, listenOnly, [leftMouseDown, keyDown, scrollWheel…])
  onUserEvent → 发 .userIntervened 到会话 → 取消在途动作
    → 错误码 -10016 上抛 → TS 层转 terminalStatus=cancelled + 自然语言转述
  tap 被系统禁用 → 自动重启（shouldAutoreenable）
Esc 全局取消: 全局 EventTap 监听 Esc（有 AX 权限时合法）→ userStoppedSession(-10012)
```

---

## 7. 人机协同子系统规格

### 7.1 审批状态机（对齐 §9.2）

```
states: unknown → policyChecked(allowed|denied|forbidden) → awaitingApproval → approved(session|always) → refused
存储:   $CODEX_HOME/spark-cua/sessions/<sessionId>.toml
        [apps] allowed = ["com.example.app", …]      # always 级
        [messages] read_approved_chats = [...], send_approved = false
 elicitation meta（对齐 §16.6 字段名）:
   {codex_approval_kind:"mcp_tool_call", connectorId:"computer-use",
    persist:["session"]|["session","always"], riskLevel, subtitle?,
    toolCallId, toolName, toolParamsDisplay:[{name:"app", displayName:"App", value}]}
```

### 7.2 锁屏（一期）

```
LockScreenMonitor: 轮询 CGSessionCopyCurrentDictionary()["CGSSessionScreenIsLocked"]（2s 周期）
锁屏期间: 非豁免 trait 请求 → error screenLocked(-10020)
解锁恢复: 自动重置 settle 状态，无需重启会话
（二期: Guardian 独立进程 + 登录授权 socket + auto-unlock lease，对齐 §9.3）
```

### 7.3 回合锁定（对齐 §16.4）

```
TurnRegistry: turnEnded(threadId, turnId) → 该 thread 的所有会话进入 locked
locked 状态下工具调用 → 错误消息原文:
  "Computer Use is unavailable because the current turn ended. It will work again after the next user message."
新 user message → 解锁（由 agent-runtime 调 TurnBegin 通知）
```

---

## 8. 可视化子系统规格

### 8.1 虚拟光标（对齐 §10.1/§16.1）

- 独立 NSWindow（非激活、浮于 targetWindowID 之上、透明背景）；
- 状态机：`hidden → moving(path) → attached → pressing → fadingOut`；
- 运动：move 目标点 → 贝塞尔插值 + 果冻形变（stretch/squash 随速度方向）+ 到达吸附（CloseEnough：距离 < 12pt 贴元素中心）；
- 时序：`CursorNextInteractionTiming` 控制动作前光标先行（prepareToInteract 语义）；
- 光标坐标作为事件流入 PIP（二期）与遥测（`cursorLocationDidChange`）。

### 8.2 状态栏（宿主持有，对齐 §17.2）

N-API 模块导出（对应 sky.node 面）：`createStatusItem / destroyStatusItem / updateState(active:bool) / updateMenuState(recentApps[])`；Electron 渲染层通过 IPC 收 `computerUseActive` 状态与 turn-ended 复位。服务端经 `StatusItemMenuState` 请求同步菜单内容。

---

## 9. 存储与数据结构

| 存储         | 路径                                       | 格式   | 内容                                                                                                                   |
| ------------ | ------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 会话状态     | `$CODEX_HOME/spark-cua/sessions/<id>.toml` | TOML   | `[apps] allowed`（always 审批）、会话元数据                                                                            |
| 审批会话级   | 内存（服务生命周期）                       | —      | session 级 allowed 集合                                                                                                |
| App 使用目录 | `…/spark-cua/usage.sqlite`                 | SQLite | `apps(bundle_id, display_name, app_path, target_id, last_used_date, use_count)`（对齐 §6.3，支撑 list_apps 14 天语义） |
| 截图文件     | `…/spark-cua/shots/<chatId>/<n>.png`       | PNG    | 由 `skyshotImageFiles` 集合管理回收                                                                                    |
| 配置         | `…/spark-cua/config.json`                  | JSON   | locale、accentColor、状态文案（"Agent is using your computer"/"Esc to cancel"）                                        |

---

## 10. 安全实现清单（一项都不能省）

1. **socket 0600 + 发送方认证**：接收时 `SecTaskCreateFromSelf`/audit token 对比发送方 code signing（对齐 §16.3 六字段：parent/responsible × executable/signingId/teamId）；不匹配 → `senderProcessNotAuthenticated(-10000)`；
2. **权限集中在服务**：agent/宿主进程永不申请 AX/屏幕录制；服务启动即 `AXIsProcessTrusted` + `CGPreflightScreenCaptureAccess` 预检，缺权限走 PermissionWindow 引导（文案含"仍pending时让模型再调一次"的行为，对齐 §5 的 pending 提示原文）；
3. **策略裁决在服务端**（denied/forbidden 不可被客户端覆盖）+ URL 域名黑名单（`blockedURL(-10015)`）；
4. **审批默认拒绝**；session/always 两级；拒绝话术含防绕过条款（对齐 §5.2）；
5. **服务进程路径校验**：宿主侧校验服务可执行路径（对齐 sky.node `computerUseServiceProcessMatchesExecutablePath`）；
6. **审计完备**：工具调用/审批/IPC失败/截图四类事件 + turn 指标（对齐 §16.6 四个 time_to_first 指标照抄命名）；
7. **prompt 层防注入**：拒读话术模板、AppInstructions 注入 `<app_specific_instructions>` 且按会话去重（对齐 §16.5）。

---

## 11. 测试与验收

| 层          | 测试                                          | 验收标准                                                                              |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| 协议        | 帧编解码/版本握手/超时/错误码单测             | 与 §3 规格逐字段一致；8MiB 上限；-10013 握手拒绝                                      |
| AX 引擎     | 对 Finder/Safari/Notes/一个 Electron App 抓树 | Markdown 行含 index/role/label/actions；Electron App 首次访问自动启用 AX；URL 已短化  |
| diff        | 脚本化 UI 变更                                | 仅变更行输出；被删元素出现 Removed IDs；元素 id 继承稳定                              |
| select_text | Safari 页面/Notes 编辑器                      | 唯一匹配选中；prefix/suffix 消歧；cursor_before/after 落点正确                        |
| 注入        | 后台窗口点击/打字（用户在前台操作别处）       | 焦点不转移；目标 App 正确响应；两次点击间隔 ≈0.1s                                     |
| settle      | 点击需加载的列表                              | 状态返回时数据已加载（无 loading 态截图）；上限 6s                                    |
| 中断        | agent 执行中用户点击目标窗口                  | 动作取消、错误 -10016、聊天区自然语言转述                                             |
| 审批        | 首次操作新 App                                | elicitation 弹出；always 批准后同会话/跨会话不再询问；denied 时错误文案含组织策略说明 |
| 锁屏        | 锁屏期间调用                                  | -10020；解锁后自动恢复                                                                |
| 回合锁定    | turn 结束后调用                               | 固定文案错误；新消息后恢复                                                            |

---

## 12. 里程碑计划（M1–M4）

### M1 — 感知 + 语义执行（约 2–3 周）

Swift 服务骨架、socket JSON-RPC（帧/握手/错误码）、AXEngine（构建/渲染/diff/setValue/click(AX)/type/pressKey/scroll/get_app_state）、权限预检与引导。
**验收**：通过 `get_app_state` 完整驱动 Finder/Safari/Notes 三应用完成"打开 App→读树→set_value→读回"闭环；Electron App AX 自动启用。

### M2 — 事件兜底 + 非前台（约 2 周）

Injector（postToPid 全套、0.1s 间隔、Unicode 输入、坐标换算、insideWebView）、焦点伪造、settle 完成（busy 驱动）、paste（剪贴板还原）。
**验收**：用户前台看视频的同时，agent 完成对后台备忘录的多步输入；截图坐标系换算通过 Retina 双屏用例。

### M3 — 人机协同 + 可视化（约 2 周）

审批协议与存储、PolicyEngine、中断监测（PID tap + Esc）、虚拟光标、状态栏（N-API 模块）、回合锁定、遥测四类事件 + 指标。
**验收**：§11 全表通过；`time_to_first_get_app_state` 等四指标有数据。

### M4 — 增强（排期另行）

锁屏 Guardian（独立进程 + 授权插件 + 租约）、iMessage 双审批工具族、Record & Replay（JSONL 事件流 + 四内嵌提示词命令）、Skysight 记忆（10min/6h 摘要 + 观察策略）、Windows/Linux 目标（Window2 API / 全桌面 API，对齐 §14）。

---

## 附：与原版的差异声明（诚实边界）

- 渲染行的**确切视觉格式**（分隔符、引号风格）无法从静态逆向 100% 还原——本规格给出等价格式（index+role+label+actions），语义完全对齐；
- 原版部分常量（settle 的内部分段、diff 行预算具体数值）为启发式推断，已在 §5/§18 标注"建议值 vs 实测值"；
- 授权插件（锁屏自动解锁）涉及系统级提权安装，M4 前不做，属有意的安全保守。
