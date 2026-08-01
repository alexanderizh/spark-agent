# Windows Native Host、WGC/UIA 与 SendInput 设计

> 状态: 已落地 | 最后核对: 2026-08-01

本文记录 Windows Computer Use Native Host 的当前生产边界。实现位于 `apps/desktop/native/windows/spark-computer-host`，使用 Rust、`windows-rs` 与 `windows-capture`；最终签名安装包和 Windows 10/11 真机矩阵仍是发布签收门槛。

## 1. 进程与信任边界

- Host 是 Electron App 通过绝对路径、`shell=false` 和继承 stdio pipe 启动的 sidecar，不监听 TCP/Unix socket，不执行 shell/eval，不接受任意文件路径。
- `signed` 模式校验 Host 与父 App 的 Authenticode publisher SHA-256、证书链、RFC 3161 时间戳、最终字节摘要、PE machine、manifest 和协议范围；`local` 仅用于显式开发构建。
- 父 PID、进程创建时间、镜像路径和签名身份需保持稳定；PID reuse、不同 publisher、可写/符号链接制品或 strict wire 漂移全部 fail-closed。
- x64 与 arm64 MSVC target 均执行 `cargo clippy -- -D warnings`；正式 arm64 发布只有在 CI/真机矩阵签收后开放。

## 2. 观察链路

- 窗口 inventory 绑定 HWND、PID、executable identity、signing identity、标题、几何、最小化/焦点状态；同名进程不能继承旧目标租约。
- Windows Graphics Capture 生成窗口 BGRA 帧并编码 PNG，禁止 cursor capture；捕获前后复核 HWND/PID/executable identity。
- `persistentCapture=true` 时按 HWND/进程/可执行身份复用一个 WGC session，队列容量 2，只接受当前 observe 单调时钟之后的新帧；2 秒超时或 stream failure 清理会话并最多回退一次单帧。
- UIA 遍历限制元素数和序列化文本大小，生成稳定 element ref、tree version 与 full/diff；密码和 provider-secure 节点不发布 value 并形成敏感区域。
- UIA automation/structure event handler 监听布局、文本、选区、窗口打开/关闭和结构变化，以原子 generation 使缓存失效。只有目标、订阅、缓存、generation 与 1 秒 TTL 同时满足时复用；语义动作前主动标脏。

## 3. 执行通道

- `background_semantic` 使用 Invoke、Value、SelectionItem、Scroll、Focus、ExpandCollapse pattern，不激活其他应用；不支持或无效果返回稳定错误。
- `foreground_input` 使用 SendInput，仅在目标 HWND/PID/身份仍一致且不处于 secure desktop 时执行。真实用户输入与 Host 注入事件通过 injected flag 分离。
- 用户点击目标窗口立即触发 takeover；其他应用输入只延后前台动作。拖拽、组合键和 UTF-16 文本输入在每步检查 cancel/takeover/目标身份，释放守卫确保失败时补发 mouse/key up。
- lane 与动作类型在 TypeScript Zod 和 Rust strict decoder 双端校验；旧 envelope 可按动作安全推导，显式不匹配拒绝。

## 4. 生命周期与恢复

- Electron Host Supervisor 负责验证、启动、握手、5 秒心跳、连续 3 次失败和会话内最多一次自动重启；重启后必须重新绑定并观察，不续执行旧动作。
- stale frame/tree、窗口移动与短暂断连只允许一次本地重观察/重连；非幂等动作不透明重放。
- cancel、目标变化、flag 回退与进程退出都会释放 WGC、UIA handler、输入状态和 COM 资源。
- Host stderr 只允许有界清洗诊断，不包含截图、UIA 正文、用户输入、绝对路径或密钥。

## 5. 验证与发布门槛

- Rust 23 项测试覆盖 framing、strict protocol、取消、输入策略、UIA tree/diff/cache/脱敏、签名父进程和安全桌面边界。
- x64/arm64 MSVC clippy 均为零 warning；TypeScript Client/Backend 覆盖握手、摘要、二进制邻接、超时、重连、持久捕获和动作后观察。
- 发布前必须在最终 NSIS、Windows 10/11、普通用户、Defender/SmartScreen 默认、非 ASCII/含空格用户名、多 DPI/多显示器和 UAC 边界执行安装、升级、卸载与黄金任务 100 次。
- 真实桌面需证明 observe/动作 SLO、后台焦点干扰为零、takeover P99 小于 300 ms；没有这些数据不得把发布签收写为通过。
