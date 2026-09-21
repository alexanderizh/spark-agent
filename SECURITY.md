# 安全策略

## 报告安全问题

请不要在公开 Issue、Discussion、Wiki 或 PR 中披露可利用的漏洞、真实凭据、个人文件或完整攻击步骤。

请发送邮件至 [zhangyangupup@163.com](mailto:zhangyangupup@163.com)，主题包含 `SparkWork security report`，并尽量提供：

- 受影响的版本、平台和安装方式；
- 最小复现步骤或 PoC（请先脱敏）；
- 影响范围与触发条件；
- 你建议的缓解方式；
- 仅为复现所必需的附件。

维护者会确认收到报告，并在评估后通过邮件沟通修复、缓解或公开披露安排。请不要把生产 token、私有 endpoint 或用户数据放入报告附件。

## 开发时的安全边界

- API key 和登录凭据进入系统 keychain/加密凭据库，不进入 SQLite、日志或仓库。
- renderer 不直接访问 Node.js、文件系统、命令行或网络凭据。
- 新工具、MCP、插件和连接器必须经过权限、信任、审计和失败路径评估。
- 处理路径、压缩包、外部 URL、深链和 webview 时，优先复用现有 guard/policy。
