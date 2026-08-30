# Codex Runtime 兼容矩阵

> 状态: 已落地 | 最后核对: 2026-08-22

Spark 使用官方 Codex App Server 作为产品内嵌 Harness，并只维护自身实际消费的协议子集。
应用升级不会要求用户同步升级已经安装且仍兼容的 native runtime；runtime 更新默认由用户选择。

| Runtime   | 支持级别     | 说明                                                                                       |
| --------- | ------------ | ------------------------------------------------------------------------------------------ |
| `0.144.5` | 最低兼容版本 | 官方协议包含所需字段；隔离双 turn 冒烟复用单进程和 loaded thread，完整安装可继续使用。     |
| `0.149.0` | 当前锁定版本 | Desktop 与 agent-runtime 的 SDK 版本；双 turn 冒烟通过，CI 用官方 CLI 生成协议并检查漂移。 |

兼容边界：

- 运行旧版本仍需通过平台、语义版本、可执行文件和包清单完整性校验。
- 下载新 runtime 时仍要求云端 artifact 明确匹配当前 SDK，并验证 SHA-256 和归档结构。
- CI 只阻断 Spark 已消费方法或字段的删除、改名；上游新增尚未使用的能力不会误报。
- Provider、Team、Goal、MCP、权限、队列和 Spark 事件库仍由 Spark 产品层负责，不因上游升级被替换。

本地或 CI 校验命令：

```bash
pnpm run check:codex-protocol
```

校验源定义在 `scripts/codex-app-server-compatibility.json`。升级 SDK 或最低 runtime 版本时，必须同步更新矩阵、重新生成官方协议并运行 Codex 回归测试。
