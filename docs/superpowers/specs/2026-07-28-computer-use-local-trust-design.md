# Computer Use 本地信任与完整访问设计

> 状态: 已落地 | 最后核对: 2026-07-28

## 目标

开发模式、macOS ad-hoc/无 Developer ID 安装包、Windows 无 Authenticode 安装包都必须提供与签名包相同的 Computer Use 观察、Accessibility/UIA、键鼠输入和验证能力。会话选择“完全访问”时，Spark 不再显示工具或动作审批；操作系统隐私授权仍由系统负责。

## 信任模式

- `signed`：应用和 Native Host 有可验证发布者身份时，继续校验发布者、固定标识、最终文件 hash、平台、架构和协议握手。
- `local`：无签名包和开发模式使用。Host 必须来自固定资源/构建目录，是非符号链接普通文件，不可被组或其他用户写入，且 SHA-256 必须与严格 manifest 一致。Host 仅通过父子进程管道通信。
- 签名 artifact 不允许静默降级成 local；开发模式直接接受 local，打包应用则先检查外层应用发布者身份：有有效发布者身份时拒绝 local manifest，确属无签名包时才允许 local verifier。

macOS local Host 使用 ad-hoc 签名以满足系统代码身份和隐私授权要求；Windows local Host 无需证书。两端的 local Host 仅在显式编译的 local/debug 变体中接受无发布者签名父进程，正式 signed Host 不包含该旁路。

## 构建与运行

- `pnpm dev` 在启动 Electron 前构建当前平台的 local Host。
- unsigned `electron-builder` 产物不再省略 Host，而是打入 local Host 与 local manifest。
- Runtime 同时依据开发/打包状态、外层应用发布者身份和 manifest 选择 verifier，并在启动 local Host 时传递仅供 local/debug 编译变体识别的父进程授权开关。
- capability 错误保留明确的 missing/untrusted/incompatible 原因，避免把 Host 缺失误报为版本不兼容。

## 权限语义

- `claude-bypass` 与 `codex-full-access` 是真正的完全访问：`start_task`、`resume` 和全部已审核的 Computer Use task tools 都加入免审批列表；Broker 的 L2/L3 ticket 由本地运行时直接签发，不弹 UI。
- 所有权限模式都直接挂载 `start_task` 与 `resume`，SDK 工具层不得以权限模式为由阻断 Computer Use。其他模式在 Broker 真正准备执行 L2/L3 动作时申请精确审批。
- Screen Recording、Accessibility、Input Monitoring、UAC/secure desktop 等系统权限不伪造、不绕过；未授权时由应用请求，必要时用户在系统界面确认。
- 全局紧急停止快捷键是 best-effort 辅助停止通道；注册失败只在 capability 中报告 `killSwitchArmed: false`，不能把已经具备的 Host 执行能力改成只读，也不能关闭已启用的 My Desktop。Pause/Stop/takeover 始终保留。

## 快照显示

`spark-snapshot://` 继续要求短期 capability token、`no-store`、`nosniff` 和严格图片类型校验；自定义 scheme 注册 `corsEnabled`，图片响应使用 `Cross-Origin-Resource-Policy: cross-origin`，允许主 Renderer 的 `<img>` 加载不同 origin 的受权预览。

## 自动回退

Agent 始终先用 `spark_computer`。若 Broker/Host/权限暂时不可用，继续按目标选择浏览器、API/CLI、AppleScript/JXA、PowerShell UI automation 或已有自动化工具；需要系统权限、安装依赖或高影响操作时走当前会话的权限模式。不得仅因 Computer Use unavailable 就终止可完成的任务。

## 工具契约

`start_task` 当前只公开真实可用的 `environment: "my_desktop"`。最小输入只要求 `goal` 与 `environment`；`successCriteria` 可省略，Spark 优先从 goal 的引号文本生成视觉验收条件，否则使用前台应用状态。MCP schema 和系统提示词同时给出最小 JSON、`acceptanceCriteria` 简写和 status/control 的 `computerSessionId` 示例，Agent 不得猜测 `safe_browser` 或 `safe_desktop`。任务范围包含启动时 Host 当前发现的应用集合，使任务切换到已经运行的目标应用后仍能继续执行。

## 验证

- TypeScript 单元测试覆盖 signed/local artifact 选择、local Host spawn 环境、完全访问工具列表和提示词回退。
- Swift/Rust 测试覆盖 local 编译变体授权与 signed policy 不回退。
- 运行 desktop/agent-runtime 定向测试、typecheck、Swift tests、可用平台上的本地 Host 构建，并人工通过 `get_capabilities` 验证开发模式。
