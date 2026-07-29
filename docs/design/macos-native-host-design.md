# macOS Native Host、AX/CGEvent 与应用快照设计

> 状态: 实施中 | 最后核对: 2026-07-29

本文是 CU-03 macOS Native Host 的可直接开发规格，记录已经落地的生产边界、wire、signed/local 打包、故障恢复、ScreenCaptureKit、AXUIElement 和 CGEvent 控制闭环。当前代码可交付可信 Host 能力探测、窗口列表、单窗口 PNG、full/diff AX tree、无 AX 时视觉空树与坐标兜底、语义动作、受限键鼠和加密应用快照；最终实体机矩阵仍是发布门槛。

## 1. 代码边界

Electron 主进程：

- `NativeHostArtifact.ts`：artifact manifest、最终签名字节 SHA-256、Apple designated requirement 和父应用 Team ID 绑定。
- `NativeHostFrameCodec.ts`：5-byte 帧头和增量解码；在完整 payload 分配/处理前拒绝空、未知、超限和截断帧。
- `NativeHostClient.ts`：子进程、握手、request ID、并发 pending map、binary 邻接、hash、timeout、Abort 和终止。
- `NativeHostComputerUseBackend.ts`：共享连接、capability 映射、崩溃连接失效和下一操作重连。
- `NativeApplicationSnapshotCaptureService.ts`：敏感应用阻断、前台唯一窗口选择、捕获后 window/app/PID/代码身份复核、PNG 二次校验、预览、Vault/Repository 补偿事务。
- `NativeHostBackendFactory.ts`：生产路径与 app/host 信任链 composition root。

Swift：

- `SparkComputerHostCore`：wire codec、完整 action envelope 严格 decoder、observation/action response encoder、AX tree/diff 与输入策略、平台接口、窗口/DPR 映射和 FileHandle 长连接流。
- `SparkComputerHost`：ScreenCaptureKit、AXUIElement observer/semantic action、CGEvent 输入、CGWindow 前台顺序、Security code identity、权限请求和 stdio server。
- Host 不监听 TCP、Unix socket 或其他本地端口，不读取任意文件路径，不执行 shell/eval。

## 2. Wire 与进程生命周期

每个 frame 为：

```text
offset  size  meaning
0       4     payload length, UInt32 big-endian，不含 header/kind
4       1     kind: 1=json, 2=binary
5       N     payload
```

规则：

1. 单帧上限 64 MiB；0 长度、未知 kind、截断、无效 UTF-8、未知字段/类型/版本均终止 Host 连接。
2. `capture_result` / `observation` JSON 声明的 binary 必须是下一帧；长度和 SHA-256 必须同时匹配。
3. stdout 只允许 frame；诊断只写 stderr，且不包含窗口标题、路径、截图、AX 文本或输入正文。
4. Electron spawn 使用绝对路径、`shell=false`、仅 stdin/stdout/stderr pipe 和最小 `LANG/LC_ALL` 环境。
5. 默认请求超时 20 秒；`drag` 与 `wait_for` 按协议内动作时长增加 5 秒清理余量（总上限 180 秒）。timeout、Abort、进程错误或协议错误会终止子进程并拒绝全部 pending 请求；backend 清除连接，后续操作重新走完整信任验证与握手。
6. Swift 使用 `readabilityHandler -> AsyncStream` 读取长连接。不得改回等待 EOF 的同步 `read(upToCount:)`；回归测试必须证明 stdin 保持打开时也能收到 frame。

## 3. 启动信任链

Runtime 只接受 manifest 明确声明的两种模式：

- `signed`：执行下述 Developer ID、Team ID、designated requirement 和父进程签名链校验。
- `local`：供开发模式和无 Developer ID 的本地安装包使用。Host 使用 ad-hoc identifier，artifact 仍必须位于固定目录且通过 regular file、非 symlink、不可 group/world write、大小、平台/架构、固定文件名、SHA-256 和握手校验。只有 DEBUG 或以 `SPARK_COMPUTER_LOCAL_TRUST` 编译的 Host 接受 local 父进程；signed Host 不包含该旁路。

生产启动必须按顺序满足：

1. 验证 SparkWork 主可执行文件的 Apple designated requirement，取得父应用 Team ID。
2. `lstat` Host 与 manifest：必须是 regular file、非 symlink、不可 group/world write、大小受限。
3. 严格解析 manifest：schema/protocol/host version、`macos`、当前 `arm64|x64`、固定文件名与固定签名 identifier。
4. manifest Team ID 必须等于父应用 Team ID；不能让 manifest 自己提供信任根。
5. 对 Host 最终签名字节计算 SHA-256，与 manifest 比较。
6. `codesign --verify --strict`，并以 `anchor apple generic + 固定 identifier + certificate OU Team ID` 验证 Host。
7. Host 启动后、创建 decoder 或读取 stdin 前，使用 Security framework 检查自身与 `getppid()` 指向的直接父进程：先执行 `SecCodeCheckValidity`，再读取代码身份；自身 identifier 必须为 `com.spark-agent.desktop.computer-host`，父进程 identifier 必须为 `com.spark-agent.desktop`，双方 Team ID 必须存在且相等，并分别通过 `anchor apple generic`。父 PID、`proc_bsdinfo` 启动时间 token 和双次 code lookup/identity 必须一致，防止 PID reuse。失败时只向 stderr 写固定清洗诊断并立即退出，release 不提供环境变量绕过。
8. 启动后首个请求必须为 `get_capabilities`；Host 返回的 protocol/host version、platform、architecture 必须与 artifact manifest 一致。

任何失败都返回稳定的 `native_host_missing|native_host_untrusted|native_host_incompatible`。Broker 不伪造执行结果；Agent Runtime 可按用户目标和当前权限模式回退到 AppleScript、shell、`cliclick`、BrowserBridge 或其他已有工具。

## 4. macOS 观察与执行闭环

已实现：

- `SCShareableContent` 枚举 displays/windows/applications。
- 使用 bundle ID、PID、应用名、Security signing identifier/Team ID 构造应用身份。
- 使用 CGWindow 前后顺序与 frontmost PID 选择任务起始窗口；任务开始后允许同一稳定应用身份内的 focused 标记、标题、window ID 和几何差异，不因 Electron 临时子窗口或透明层误报 `focus_mismatch`。
- 按窗口与 display 最大交叠面积选择显示器；`pixelWidth / pointWidth` 计算 DPR，覆盖负坐标、多显示器和 Retina。
- macOS 14+ 使用 `SCScreenshotManager` + `SCContentFilter(desktopIndependentWindow:)` 捕获单窗口，编码 PNG，经 descriptor + binary frame 返回。
- macOS 13 manifest 诚实关闭 `captureWindow`，保留窗口枚举；不伪造兼容截图。
- `request_permissions` 仅接受去重后的 `screen|accessibility`，分别调用系统 TCC API。
- AXUIElement 从绑定 PID 的 focused window 生成最多 2,000 项、48 层的 full/diff tree；达到边界时截断而不是让整个任务失败。不再要求 AX 与 ScreenCaptureKit 的窗口标题和边界完全一致；单个应用拒绝或无法提供 AX 树时返回截图绑定的视觉 tree，使用系统 Vision OCR 提取可见文本并让视觉模型继续使用坐标。element ref 绑定 tree version，下一次观察后旧引用失效。
- `AXSecureTextField` 不返回 value，不声明 `set_value`，并形成 `sensitiveRegions`；名称、value、role、action 和 geometry 全部本地有界清洗。
- 语义动作支持 Invoke/Confirm、Focus、Select、Expand/Collapse、SetValue 和 SelectText；元素 Scroll 当前仍按元素 bounds 经受管 CGEvent 执行，不伪装成 AX 语义动作。不支持或未产生效果返回稳定 `action_noop|action_not_allowed`。
- CGEvent 支持归一化窗口坐标 click/move/drag/scroll、组合键和 UTF-16 文本；长拖拽、组合键和文本输入在注入过程中持续复核 PID/bundle/executable/signing identity，稳定应用身份漂移或取消立即停止，不再校验临时 window/focused/geometry。drag 通过兜底 mouse-up 避免遗留按下状态。安全输入框拒绝文本及可修改值的 keypress。
- `execute_action` 只返回严格 `action_result`；Electron 随后重新 `observe`。动作前后原图仅驻留有界内存，持久层只接收敏感区域脱敏后的缩略图并设置 24 小时 TTL；noop 使用感知图像指纹与无版本语义元素摘要，`wait_for` 则以 Host 条件结果为准。
- cancel session 会使旧 observation 和 element refs 失效，并拒绝该 session 的后续动作。

capability manifest 只在 AX 信任真实存在时声明 `axui_element/fullTree/diffTree/semanticActions`；`cg_event/absolutePointer/keyboard` 按 PostEvent 与截图能力独立声明，不再被 AX 树可用性连带关闭。权限状态由 Host 定期重新读取，`clipboard` 继续固定 false。

## 5. 应用快照落库

`capture-frontmost` 的生产顺序：

1. 校验 Host 声明 list/capture 且 Screen Recording 为 granted。
2. `app_exposed` 在 AX/fullTree 未落地时返回 `environment_unavailable`，不能静默降为 visible-only。
3. 优先选择 focused 且非 minimized 的最大窗口；短暂无 focused 标记时复用上一绑定窗口，再退到最大可见窗口，不因多个辅助窗口中断任务。
4. 以服务生成的 snapshot ID 请求 Host 捕获；复核 ID、PNG kind、字节长度和 SHA-256。
5. Electron `nativeImage` 解码并复核像素尺寸，生成最大宽度 1200 的 PNG preview。
6. Vault 先以 AES-256-GCM 写 image/preview；Repository 在回调中同事务注册 blob 与 snapshot。数据库失败时 Vault 删除本次全部新密文。
7. Renderer 只得到 snapshot metadata 与 `spark-snapshot://` 认证预览 URL；捕获不会自动加入 turn 或发送给模型。

当前 Agent 应用快照可交付范围仍是用户主动 `visible_only` 图像快照；Computer observation 已使用 AX tree、secure field redaction 和持久化前图像脱敏，但 `user_context` 的 `app_exposed` 文本 hydration、Composer draft 与连续快照归组尚未接线，因此不得把应用快照宣传为完整 Appshots。

## 6. 构建、签名与公证

`afterPack` 对当前 Electron arch 执行：

1. `swift build -c release --arch arm64|x86_64`。
2. 复制到标准代码位置 `Contents/Helpers/native-host/macos-<arch>/SparkComputerHost`。
3. 使用 Developer ID Application、hardened runtime、固定 identifier 独立签名。
4. 校验签名/Team ID，对最终签名字节生成 manifest SHA-256。
5. `signIgnore` 阻止 electron-builder 再次签 Host 改变 hash；随后外层 `.app` 签名封存 Host 与 manifest，afterSign 公证整个应用。

CI 缺少 Developer ID 时构建必须失败；本地无证书时明确省略 Host，不能生成“看似可用”的 ad-hoc artifact。

## 7. 剩余发布门槛

1. 在最终 Developer ID `.app` 中验证 Host handshake、AX full/diff、语义动作、CGEvent、Kill Switch、未授权父进程拒绝和公证安装。
2. 覆盖 TextEdit、Safari/Chrome、Finder、Office/WPS、哔哩哔哩等 Electron 多窗口应用、SwiftUI/AppKit 样本，以及 SecureTextField、Retina/多显示器、窗口移动/缩放、焦点变化和 Host crash/restart。
3. 记录 Stop/Kill Switch 到停止后续动作派发 P99，必须不高于 300ms。
4. `app_exposed` 快照文本、本地图像脱敏与会话 hydration 另按 CU-04 验收，不得因为 Computer observation 已有 AX tree 就自动开放。

## 8. 当前验收证据

- Swift 41 项 unit 覆盖 frame、完整 action envelope 严格解码、handler/稳定错误映射、AX tree/diff/secure redaction、输入/坐标/身份策略、窗口几何漂移、cancel registry fail-closed、DPR/window mapper、长连接非 EOF 读取，以及 host/parent identifier、Team ID、PID start token 和 Apple anchor 信任策略。
- TypeScript unit 覆盖 framing、artifact/team trust、握手、binary hash、timeout、崩溃重连、动作后观察、跨平台 evidence noop、前台快照和 Vault 注册。
- 本机真实 release Host 已在保持 stdin 打开的同一进程内完成 `list_windows -> capture_window`；PNG magic、byteLength 和 SHA-256 全部匹配。
- 完整 Developer ID `.app` 的最终签名/公证验收必须由具有发布证书的 CI 执行，不能以本地 ad-hoc 构建替代。
