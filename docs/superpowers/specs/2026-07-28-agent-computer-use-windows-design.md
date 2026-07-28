# Agent Computer Use、媒体交付与 Windows Host 设计

> 状态: 实施中 | 最后核对: 2026-07-28

## 目标

让所有 Spark Agent 默认发现受治理的 `spark_computer` 能力，只能通过 Computer Control Broker 操作桌面；让图片、截图、改图、音频和视频产物自动形成可渲染的会话预览；在 Windows 上交付与 macOS 使用同一 wire、Broker、审批和证据协议的原生 Host。

## 已确认决策

1. `spark_computer` 是所有本地会话默认挂载的进程内 MCP，不依赖用户手工安装。
2. Agent 只看到任务级工具。点击、输入和坐标动作属于 Broker 内部协议，不直接暴露给模型绕过策略。
3. Agent 必须先查询能力；未支持、未授权或 Host 不可信时明确拒绝，不得回退到 JXA、AppleScript、`cliclick`、`pyautogui`、`xdotool`、PowerShell UI 脚本或临时安装自动化工具。
4. 多媒体交付采用“提示词要求 + Runtime 结构化兜底”双层机制。仅返回路径不算完成。
5. Windows Host 使用 Rust 与 `windows-rs`，产出自包含、可 Authenticode 签名的 EXE，不要求用户安装 .NET。
6. Windows 和 macOS 共用 `@spark/protocol` Native wire、Electron `NativeHostClient`、Broker、Policy、Approval、Snapshot Vault 和 Verification 数据模型。

## Agent 工具面

默认工具：

- `get_capabilities`：返回平台、Host 信任状态、Screen/Accessibility/Input 权限及功能位。
- `capture_app_snapshot`：只创建用户上下文快照，不自动发送给模型。
- `start_task`：创建受治理 Computer session；输入包含目标、执行环境、应用约束和验收规格。
- `get_status`：读取状态、等待审批原因和最新验证摘要。
- `pause`、`resume`、`stop`、`takeover`：安全控制，不执行任意底层动作。

`observe`、`click`、`type_text`、`keypress`、`drag`、`set_value` 等底层动作不加入 Agent allowedTools。Provider 决策循环产生动作后仍由 Broker 校验 observation version、租约、策略和审批票据。

## 装配边界

`SessionService` 新增 `ComputerUseMcpProvider` 注入点，形态与 `BrowserAutomationMcpProvider` 一致。Desktop 主进程实现 provider，并闭包访问 `ComputerUseServices`；`agent-runtime` 不反向依赖 Electron。Claude SDK 与 Codex 路径共用绑定 Agent session 的 loopback Bearer MCP bridge；普通 stdio 子进程不持有 Broker 引用。

每轮系统提示词注入 `COMPUTER_USE_SYSTEM_PROMPT`，说明真实能力、允许工具、禁止降级路径、权限弹窗边界和证据化完成要求。提示词不是安全边界，Broker 仍执行全部强制规则。

## 多媒体产物交付

新增 `MediaPresentationCollector`：

- 识别 `spark_image`、`spark_media`、Computer snapshot 以及明确的图片/音频/视频文件输出；
- 只接受 workspace 或主进程授权资源中的真实文件；
- 只接受 workspace 内经 `realpath` 归一化、扩展名属于受支持媒体集合且当前确实存在的普通文件，去重并限制单轮数量；
- Agent 已调用 `present_files` 时不重复发事件；
- Agent 遗漏展示时，在 turn 结束前补发 `presented_files`；
- 内部 observation frame、审计帧和未获用户分享授权的快照不自动展示。

通用 Host 提示词和图片/媒体专用提示词同时要求：生成、修改、截图或导出后必须调用 `mcp__spark_files__present_files`；即使 Agent 遗漏，Runtime 也会在终态前发出结构化 `presented_files` 事件供聊天渲染预览/播放卡，而不是只返回文件系统路径。

## Windows Native Host

Rust workspace 位于 `apps/desktop/native/windows/spark-computer-host/`，模块边界：

- `frame_codec`：与 macOS 相同的 5-byte header、JSON/binary 帧和资源上限。
- `parent_auth`：父 PID、固定 SparkWork signer/subject、Authenticode 链与最终打包 manifest 绑定。
- `capabilities`：Windows 版本、交互桌面、WGC/UIA/SendInput 可用性探测；WGC 通过 `GraphicsCaptureApi::is_supported()` 实测，探测失败时 `captureWindow=false` 且 screen permission 为 `restricted`，不得静态宣称可用。
- `window_inventory`：EnumWindows、前台窗口、进程映像身份、DPI 与显示器映射。
- `capture`：Windows Graphics Capture；不可用时不伪装成功，不以 GDI 临时截图作为正式降级。
- `uia`：full/diff tree、secure/password 元素过滤、runtime element reference。
- `input`：SendInput 与 UIA Invoke/Value/Selection/Scroll pattern；执行前后复核前台窗口和进程身份。
- `handler`：wire request、取消、稳定错误和 binary descriptor。

当前实现已经落地上述正式路径：WGC 负责无光标窗口捕获并在前后复核 HWND/PID/executable identity；inventory 与 SendInput/capture 统一使用规范化 executable path SHA-256，不使用易碰撞的进程名；UIA 生成 full/diff tree 和 Host 内稳定 runtime element reference，secure 节点同时替换 value 与 provider-controlled name；Invoke/Value/SelectionItem/Scroll/Focus/ExpandCollapse 走语义 pattern，坐标、最长 5 秒拖拽、滚动、组合键和最长 20,000 UTF-16 units 文本走受限 SendInput。mouse/key down 使用释放守卫，拖拽每步复核前台身份，Client watchdog 按动作时长增加清理余量。Host 拒绝 secure desktop、过期 frame/tree/element、焦点漂移、取消后的 session 和越界 wire 数据。动作响应只返回严格 `action_result`；Electron Backend 随后执行新的 `observe`，Verification 前强制 full observation，因此不会用 diff patch 证明全局文本存在/不存在。

Electron 打包按 `windows-x64`、`windows-arm64` 复制 Host 与 manifest，GitHub Release matrix 同时构建两种架构。发布流水线要求 Authenticode 签名、时间戳、SHA-256、固定产品标识和外层 SparkWork signer 一致；Host 运行时从 WinVerifyTrust state 读取实际 leaf signer，附带证书包中的非 signer 证书不能满足 publisher 绑定；无正式证书的 CI release 直接失败。

发布包还携带匹配平台/架构的独立 Node runtime，Playwright 与内置 MCP 不再使用 Electron executable + `ELECTRON_RUN_AS_NODE`。afterPack 关闭 RunAsNode、Node options 和 CLI inspect fuses，启用 embedded ASAR integrity 与 `OnlyLoadAppFromAsar`；afterSign 强制 SparkWork.exe、Native Host 和 `runtime/node/node.exe` 使用同一 publisher thumbprint 且均有时间戳。

## 安全与验收

- Agent 不直接拥有 OS 权限或 Native Host 路径。
- Host 拒绝未知父进程；Electron production fuses 禁止 RunAsNode/NodeOptions/inspect，启用 ASAR integrity 与 OnlyLoadAppFromAsar。
- Renderer 快照 API 使用可信主窗口授权、会话归属和短期 bearer capability。
- Windows 输入只在交互桌面、租约有效、目标身份一致且无 secure desktop 时执行。
- 每个动作必须产生 before/after observation 与 verification evidence；自然语言声明不能结束任务。
- macOS 与 Windows 发布分别运行真实签名 Host handshake、窗口捕获、焦点漂移拒绝、kill switch 和未授权父进程拒绝测试。

## 当前验收状态

- Rust protocol/UIA/input/security policy 共 17 项测试通过，`cargo fmt --check` 与 `cargo clippy --all-targets -- -D warnings` 通过。
- `x86_64-pc-windows-msvc` 与 `aarch64-pc-windows-msvc` 均通过交叉 `cargo check`；Desktop artifact/fuse/afterSign contract tests 通过。
- 当前 macOS 开发机没有 Windows 正式发布证书，也不能替代真实 Windows 桌面，因此 Windows 10/11 签名安装、WGC/UIA/SendInput 实机矩阵、UWP/Win32/WPF 样本和最终 signer/timestamp smoke 必须由发布 Windows CI/实体机完成。该门槛未通过前本文保持“实施中”，不能对外声称 Windows 发布包已完成实机验收。
