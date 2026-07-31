# Computer Use V2 Phase 2.2 持久视觉捕获审查

> 日期: 2026-08-01 | 阶段: Phase 2.2 持久视觉切片 | 结论: 自主代码完成，事件树与真机性能待后续签收

## 交付范围

- `observe` wire 增加可选 `persistentCapture`，默认不发送并兼容旧 Host；统一 flag/rollback 动态决定每次请求。
- macOS 按 app/window/PID/代码签名身份复用一个 SCStream；Windows 按 HWND/进程/可执行身份复用一个 WGC session。
- 两平台队列均有界，只接受本次 observe 请求起点之后的新帧；目标变化、cancel、flag 关闭后的下一次 observe 或 stream failure 都释放会话。
- 2 秒取不到新帧时仅允许一次既有单帧 API 回退；回退仍执行前后目标身份复核，不伪装为持续捕获成功。

## 三遍审查

1. **兼容性**：可选字段只在 flag 开启时发送；Swift/Rust strict decoder 同时接受旧形状和布尔扩展，非布尔/未知字段仍拒绝。默认 flag 关闭，基线路径不变。
2. **陈旧帧/身份安全**：缓存绑定包含稳定目标身份，observe 前后继续复核目标。动作后 observe 丢弃动作前帧，以 monotonic timestamp 证明帧产生于当前请求之后；不能只靠“帧年龄较小”复用旧证据。
3. **资源与回退**：macOS queueDepth=2、Windows sync_channel=2，持续输出最小间隔 100ms。后台不做 PNG 压缩：macOS 仅保留最新 CGImage，Windows 仅复制最多 64MiB BGRA 帧，observe 时才编码一次。cancel/rollback/目标切换 stop；启动/线程/取帧错误清空会话后只做一次 one-shot，不无界重启。

## 验证

- macOS `swift test`：42 项通过，Swift 6 并发检查通过。
- Windows `cargo test`：22 项通过；x64/arm64 MSVC target `cargo clippy -- -D warnings` 通过。
- desktop Backend/Client：33 项通过；protocol native-wire：7 项通过，protocol typecheck exit 0。
- 完整 desktop Computer Use/打包回归：44 文件、310 项通过（7 项回环 HTTP 在允许监听环境重跑）；desktop/protocol/agent-runtime typecheck 与完整 desktop build 通过。
- 安全策略、approval、evidence 与 Broker 执行代码未修改。

## 明确未完成

- AXObserver/UI Automation event handler 增量缓存尚未落地，当前树仍按 observe 请求遍历后由已有 tree state 生成 full/diff。
- SCContentSharingPicker 尚未成为绑定入口，当前继续使用产品窗口 picker 与严格 app/window identity。
- 真实签名 macOS/Windows 的 idle CPU、capture CPU/内存、观察 P50/P95/P99 和 crash/permission/rebind 矩阵须发布真机执行。

因此本提交只标记“持久视觉捕获代码完成”，不把 Phase 2 全部或真机 SLO 宣称为完成；下一切片继续实现可访问性事件缓存。
