# Agent Computer Use 与 Windows Host Implementation Plan

> 状态: 实施中 | 最后核对: 2026-07-28

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute this plan task-by-task. The user requested one final review after all implementation, so do not insert per-task review gates. Do not stage or commit files.

**Goal:** 默认向 Agent 提供受治理的 Computer Use，保证多媒体产物进入会话预览，并交付正式 Windows Rust Native Host。

**Architecture:** `SessionService` 只持有 provider 接口，Electron 主进程注入闭包访问 Broker；媒体展示由提示词与 Runtime collector 双重保证；Windows Rust Host 复用既有 native wire，由 Electron 继续完成 artifact/manifest 校验和进程生命周期管理。

**Tech Stack:** TypeScript、Vitest、Electron、MCP、Rust、`windows-rs`、Windows Graphics Capture、UI Automation、SendInput、Authenticode。

---

### Task 1: 默认挂载 `spark_computer`

**Files:**
- Create: `packages/agent-runtime/src/computer-use/computer-use-mcp-provider.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `packages/agent-runtime/src/sdk/types.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Create: `apps/desktop/src/main/services/computer-use/ComputerUseMcpProvider.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`
- Test: `apps/desktop/src/main/services/computer-use/ComputerUseMcpProvider.test.ts`

- [x] 先写测试，证明每个本地 SDK turn 都包含 `spark_computer` 与任务级 allowedTools，未注入 provider 时不出现伪工具。
- [x] 运行目标 Vitest，确认因缺少 provider/setter/工具装配而 RED。
- [x] 定义 provider 返回 `{ server, allowedTools, systemPrompt }`，并在 SDK、Codex SDK/CLI 能力允许的路径中装配。
- [x] 实现进程内工具：`get_capabilities`、`capture_app_snapshot`、`start_task`、`get_status`、`pause`、`resume`、`stop`、`takeover`。
- [x] 所有实现调用 `ComputerUseServices`/Broker；不得调用 shell、AppleScript、外部鼠标工具或 Native Host executable path。
- [x] 运行目标测试，确认 GREEN。

### Task 2: Computer Use 内置提示词与禁止临时降级

**Files:**
- Create: `packages/agent-runtime/src/computer-use/computer-use-system-prompt.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `packages/agent-runtime/src/sdk/claude-sdk-executor.ts`
- Test: `packages/agent-runtime/src/computer-use/computer-use-system-prompt.test.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`

- [x] 先写测试，断言提示词要求先调用 `get_capabilities`，且明确禁止 JXA、AppleScript、`cliclick`、`pyautogui`、`xdotool` 和 PowerShell UI 自动化降级。
- [x] 确认测试 RED。
- [x] 实现 capability-aware prompt，并仅在 provider 已装配时注入。
- [x] 明确 Agent 在 unavailable 时解释平台/权限缺口，不建议安装临时工具。
- [x] 运行测试确认 GREEN。

### Task 3: 多媒体预览交付

**Files:**
- Create: `packages/agent-runtime/src/services/media/media-presentation-collector.ts`
- Test: `packages/agent-runtime/src/__tests__/services/media/media-presentation-collector.test.ts`
- Modify: `packages/agent-runtime/src/services/session-mcp-tooling-helpers.ts`
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `packages/agent-runtime/src/sdk/claude-sdk-executor.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`

- [x] 先写测试覆盖图片、截图、改图、音频、视频 structured result 的文件提取、workspace 边界、去重、数量上限和已 present 时不重复。
- [x] 确认测试 RED。
- [x] 实现 collector，追踪成功 tool_result 与 file_change，在 turn 结束前补发 `presented_files`。
- [x] 更新图片/媒体/通用提示词：必须调用 `mcp__spark_files__present_files`，最终消息使用渲染器支持的媒体引用。
- [x] 确保 Computer observation/evidence 默认不进入用户预览。
- [x] 运行 Agent Runtime 与 Renderer event mapper 测试确认 GREEN。

### Task 4: Windows Rust Host 基础与 wire

**Files:**
- Create: `apps/desktop/native/windows/spark-computer-host/Cargo.toml`
- Create: `apps/desktop/native/windows/spark-computer-host/src/main.rs`
- Create: `apps/desktop/native/windows/spark-computer-host/src/frame_codec.rs`
- Create: `apps/desktop/native/windows/spark-computer-host/src/protocol.rs`
- Create: `apps/desktop/native/windows/spark-computer-host/tests/frame_codec.rs`
- Create: `apps/desktop/native/windows/spark-computer-host/tests/protocol.rs`

- [x] 先写 Rust 测试覆盖 5-byte header、分片/相邻帧、未知 kind、空/超限/截断和严格 JSON request。
- [x] 确认 `cargo test` RED。
- [x] 实现有界分段 decoder、response encoder、request ID、binary descriptor 紧邻规则。
- [x] 运行 `cargo test` 与 `cargo clippy -- -D warnings` 确认 GREEN。

### Task 5: Windows 身份、窗口与截图

**Files:**
- Create: `apps/desktop/native/windows/spark-computer-host/src/parent_auth.rs`
- Create: `apps/desktop/native/windows/spark-computer-host/src/window_inventory.rs`
- Create: `apps/desktop/native/windows/spark-computer-host/src/capture.rs`
- Test: `apps/desktop/native/windows/spark-computer-host/tests/parent_auth.rs`
- Test: `apps/desktop/native/windows/spark-computer-host/tests/window_inventory.rs`

- [x] 先写纯策略测试覆盖固定产品身份、同一 Authenticode signer、父 PID 稳定性和未签名拒绝。
- [x] 先写坐标测试覆盖多显示器、负坐标、DPI、最小化、无交叠窗口和唯一前台窗口。
- [x] 确认测试 RED。
- [x] 实现父进程 token/映像/WinVerifyTrust 校验、EnumWindows/GetForegroundWindow 和进程身份读取。
- [x] 使用 Windows Graphics Capture 生成单窗口 PNG；捕获前后复核 hwnd、PID、映像和前台状态。
- [x] 运行 Rust 测试确认 GREEN。

### Task 6: Windows UIA、输入和证据闭环

**Files:**
- Create: `apps/desktop/native/windows/spark-computer-host/src/uia.rs`
- Create: `apps/desktop/native/windows/spark-computer-host/src/input.rs`
- Create: `apps/desktop/native/windows/spark-computer-host/src/handler.rs`
- Test: `apps/desktop/native/windows/spark-computer-host/tests/uia_policy.rs`
- Test: `apps/desktop/native/windows/spark-computer-host/tests/input_policy.rs`

- [x] 先写测试覆盖 password/secure 元素过滤、tree version/diff、过期 element ref、secure desktop、焦点漂移、坐标边界和按键上限。
- [x] 确认测试 RED。
- [x] 实现 UIA Invoke/Value/Selection/Scroll pattern 与 full/diff tree。
- [x] 实现受限 SendInput；每个动作前后复核租约携带的目标身份并返回新 observation。
- [x] Host 仅在所有依赖真实可用时声明 `semanticActions`、`absolutePointer`、`keyboard`。
- [x] 运行测试确认 GREEN。

### Task 7: Windows 打包与 Electron 选择

**Files:**
- Create: `apps/desktop/scripts/package-windows-native-host.js`
- Modify: `apps/desktop/scripts/after-pack.js`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/src/main/services/computer-use/NativeHostBackendFactory.ts`
- Modify: `apps/desktop/src/main/services/computer-use/NativeHostArtifact.ts`
- Test: `apps/desktop/src/main/services/computer-use/NativeHostBackendFactory.test.ts`
- Test: `apps/desktop/src/main/services/__tests__/after-pack.test.ts`

- [x] 先写测试证明 win32 x64/arm64 选择正确 artifact，其他架构 fail-closed。
- [x] 先写打包测试验证 Authenticode signer、SHA-256 manifest、最终 EXE hash 和外层应用 signer 一致。
- [x] 确认测试 RED。
- [x] 实现 Rust release build、复制、signtool 签名/时间戳、manifest 与 electron-builder resources。
- [x] 无签名环境只允许本地明确省略 Host；CI release 必须失败。
- [x] 运行 Desktop contract test 与 x64/arm64 Windows target check 确认 GREEN；正式 Windows CI/实体机 smoke 由 Task 8 发布门槛执行。

### Task 8: 安全阻断关闭与总验收

**Files:**
- Modify: `apps/desktop/src/main/services/computer-use/NativeHostArtifact.ts`
- Modify: `apps/desktop/src/main/services/computer-use/NativeHostFrameCodec.ts`
- Modify: `apps/desktop/src/main/ipc/registerApplicationSnapshotIpc.ts`
- Modify: `apps/desktop/src/main/services/computer-use/SnapshotProtocol.ts`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `docs/COMPUTER_USE_PLAN.md`
- Modify: `docs/design/computer-use-threat-model.md`
- Modify: `docs/design/macos-native-host-design.md`

- [x] TDD 固定 `/usr/bin/codesign` 并关闭 Electron RunAsNode/NodeOptions/inspect，启用 ASAR integrity/OnlyLoadAppFromAsar。
- [x] TDD 增加 Renderer/会话所有权和短期预览 capability。
- [x] TDD 修复 focus TOCTOU、frame decoder O(n²)、跨语言元数据边界和敏感应用 blocklist。
- [x] 运行 Protocol、Agent Runtime、Desktop、Storage、Swift、Rust 全量测试和 typecheck/lint/format。
- [ ] 运行 macOS Developer ID 与 Windows Authenticode 最终产物 smoke test；未具备证书的平台在 CI 中保持不可发布。
- [x] 修复统一审查发现的证据保留/脱敏、diff 验收、后台应用状态、durable verification、能力拆分、noop、独立 Node 信任和 macOS 长输入安全问题。
- [x] 刷新实现文档与 GitNexus 索引。
- [x] 最后执行一次统一规格、安全和代码质量复核；代码范围内 Critical/Important 已关闭，正式签名实体机 smoke 继续作为发布阻断门槛。
