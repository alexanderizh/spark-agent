# Computer Use V2 Phase 1 原生打包门禁审查

> 日期: 2026-08-01 | 阶段: Phase 1 | 结论: 自主发布门禁代码完成，最终安装/真机矩阵待外部签收

## 1. 交付结论

本阶段已把 Native Host 验证从“打包目录里看起来存在”推进为安装器生成前的硬门禁：统一版本与 build provenance、最终字节摘要、平台/架构、签名身份、公证/时间戳和最终 Electron App 父进程 handshake 必须同时通过。普通 Node verifier 不具备受信任父进程身份，因此 smoke 由应用主进程在创建窗口、托盘、IPC 与后台维护前执行，并使用隔离 user-data。

## 2. 三遍审查

1. **契约与供应链审查**：manifest 在所有 byte-changing 签名之后生成；验证器重新读取最终 regular non-symlink executable 并计算 SHA-256。`native-host-build.json` 与 wire/manifest 使用共享版本源，最终 handshake 再核对原生二进制实际返回的 Host/协议版本，版本漂移 fail-closed。
2. **平台安全审查**：macOS 校验单 slice、0755、App/Host codesign、identifier、Team ID、hardened runtime、Gatekeeper、stapled ticket，并从临时 Applications 副本再次握手。Windows 解析 App/Host PE machine，强制同 publisher SHA-256 与 RFC 3161 timestamp；local 模式只允许显式开发验证。
3. **发布时序审查**：独立验证器在 `afterSign` 执行，失败会阻止 DMG/NSIS 生成与 electron-builder 发布；release wrapper 在构建返回后再次运行。smoke 不创建窗口或分发动作，结束时释放 Computer Use services、关闭数据库并返回明确退出码。

## 3. 验证证据

- Phase 1 聚焦单测：35 项通过（smoke 5、独立 verifier 10、after-pack/afterSign 20）。
- Native wire：6 项通过。
- `packages/protocol` typecheck：exit 0。
- desktop node typecheck：exit 0。
- Node verifier 语法与 macOS/Windows release shell `bash -n`：exit 0。
- 完整 Computer Use 回归、desktop build/dev smoke 在阶段提交前再次执行并记录到进度总览。

## 4. 安全不变量

本阶段只读取产物、启动 capability handshake，不创建 Computer session、不 dispatch 动作、不改变 Broker policy/approval/evidence/handoff。签名、hash、协议、架构或报告不一致全部非零退出；Full Access、local trust 或发布参数不能绕过 signed release 的 `afterSign` 门禁。

## 5. 外部发布签收（不得伪造为已完成）

- 最终 DMG 挂载/拖入 Applications 后在 macOS arm64/x64 标准账户运行。
- 最终 NSIS 在干净 Windows 10/11 Sandbox/VM 静默安装、普通用户启动、升级、卸载并检查残留进程。
- Windows Defender/SmartScreen 默认、非 ASCII/含空格用户名、权限拒绝与恢复、Host 删除/隔离、manifest/bytes 篡改矩阵。
- 两平台签名证书与公证/时间戳真实凭据、黄金任务连续 100 次、安装成功率与冷启动 SLO 样本。

这些项目已有可执行验证器与签收清单，但必须由对应发布 CI、证书和真机产生证据；在证据生成前 Phase 1 保持“自主门禁完成、外部签收待完成”。
