# Computer Use V2 Phase 2.2 · 可访问性事件缓存审查

> 日期: 2026-08-01 | 阶段: Phase 2.2 可访问性事件缓存 | 结论: 双平台自主代码完成，真机性能待发布签收

## 1. 交付结论

macOS `AXObserver` 与 Windows UI Automation event handler 已接入观察树缓存。两端只有在目标身份未变、事件订阅有效、缓存非空、事件 generation 未变化且缓存年龄不超过 1 秒时复用原始节点；任一条件不满足都重新遍历完整可访问性树。语义动作执行前主动标脏，避免依赖平台事件到达时序决定动作后的新鲜度。

该实现最初被夹带在版本提交 `c06d15f88` 中，缺少独立审查与进度同步。本次复核把缓存判定抽成可测试的纯策略，保持运行时行为不变，并补齐双平台测试和文档证据。

## 2. 三遍审查

### 第一遍：调用链与生命周期

- macOS：`MacAccessibilityController.observe` 在目标窗口变化时重建 AXObserver，监听焦点、值、创建/销毁、移动、缩放、标题、选区和布局变化；`invalidate` 与实例释放移除 run-loop source。
- Windows：`UiaRuntime.observe` 在 HWND 变化时重建 UIA automation/structure handler；注册任一事件失败会撤销已注册 handler，不会在无订阅状态复用缓存；Drop 时完整移除订阅并反初始化 COM。
- 两端缓存都只保存已经过既有脱敏与资源上限处理前的原始节点，发布时仍重新生成 tree version/full-or-diff，不绕过协议校验。

### 第二遍：新鲜度与安全边界

- 目标身份不一致、订阅缺失、缓存为空、generation 变化、年龄超过 1 秒均拒绝复用。
- macOS generation 由 `NSLock` 保护；Windows generation 使用 `AtomicU64`，溢出时回到 1，避免零值歧义。
- 语义动作在执行前主动标脏；显式 session cancel、目标变化与 Host 生命周期重建仍走既有清理路径。
- 密码框/敏感 provider 的值脱敏、stale tree、目标绑定、审批、证据和签名/协议 fail-closed 逻辑均未修改。

### 第三遍：质量与回归

- 缓存判定从平台对象访问中抽成纯策略，Swift/Rust 使用同一组语义条件并各有聚焦测试。
- 未新增第三方依赖；Mac/Rust 生产文件均远低于 3000 行限制。
- GitNexus impact/detect_changes 工具本会话未暴露，按项目降级规则用直接调用点、双端测试、交叉编译与 `git diff` 核对影响范围。

## 3. 验证证据

- macOS `swift test`：43 项通过，Swift 6 编译通过。
- Windows `cargo fmt --check && cargo test`：23 项通过。
- Windows x64/arm64 MSVC `cargo clippy -- -D warnings`：均通过。
- 新增策略测试覆盖：正常复用、目标变化、订阅缺失、空缓存、generation 变化、TTL 超时。

## 4. 剩余外部签收

- 在真实签名 macOS/Windows 桌面采集树遍历次数、observe P50/P95/P99、idle/capture CPU 与内存，并证明事件缓存相对基线达标。
- SCContentSharingPicker 仍未作为 macOS 原生绑定入口；现有产品窗口 picker 与严格 app/window identity 继续有效。
- 发布签收前需覆盖事件丢失、权限撤销、目标退出/重启、窗口切换和高频布局变化矩阵。
