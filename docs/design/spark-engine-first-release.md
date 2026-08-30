# Spark Engine 0.1.0 首版集成说明

> 状态: 已落地 | 最后核对: 2026-08-26

## 本版范围

`spark-engine/` 以独立 npm 包 `@spark/agent` 交付，要求 Node.js `>=22.14.0 <23`，不依赖 SparkWork monorepo 内的 workspace 包。本版提供：

- `spark` CLI、Ink TUI 与可嵌入 TypeScript SDK；
- append-only 事件账本、Turn/Step 状态机、预算、取消、恢复与确定性事件投影；
- Anthropic Messages 和 OpenAI Responses 两种模型协议，以及输出开始前的重试/故障转移；
- `read`、`glob`、`grep`、`write`、`edit`、`bash` 工作区工具，包含路径边界、原子写入、revision 冲突检测、输出上限和进程组取消；
- `default`、`acceptEdits`、`plan`、`bypass` 权限模式及会话级授权记录；
- 全局/项目 TOML 配置、环境变量覆盖、安装/卸载/诊断命令和带 sha256 校验的发布制品流程。

## SparkWork 模型渠道桥接

Desktop 主进程启动一个仅监听 loopback 随机端口的 Provider bridge。每个桌面实例在 `~/.spark/hosts/sparkwork/` 写入独立描述文件，CLI 自动选择仍存活且启动时间最新的实例。

桥接边界如下：

- 描述文件包含随机 bearer token；Unix 下目录权限为 `0700`、文件权限为 `0600`；
- Provider 目录按请求实时读取，桌面端配置变化无需复制到 CLI 配置；
- CLI 只获得模型路由和本地代理地址，Provider API Key 仍由 SparkWork 的 Keychain/托管凭据恢复链路持有；
- 代理仅允许目录中启用且未被定时禁用的模型，并限制请求体、禁止上游重定向、流式转发响应；
- 多桌面实例各自持有描述文件，退出只清理自己的文件；后续启动仅回收可证明 PID 已退出的残留描述文件；
- bridge 启动失败只降级 CLI 渠道复用能力，不阻断 SparkWork 其他功能。

## 明确未包含

本版没有实现 App Server 宿主协议。`spark serve` 会明确返回不支持；版本化 JSON-RPC App Server、SparkWork 会话级第三引擎接入、MCP/插件宿主和多会话管理按后续里程碑交付。Desktop Provider bridge 只负责模型目录与请求代理，不等同于 App Server。

## 质量门

GitHub Actions 的 `Spark engine` 独立 job 在 `spark-engine/` 内执行 `npm ci` 和 `npm run verify`。该质量门依次覆盖：

1. monorepo 边界检查；
2. TypeScript strict typecheck；
3. ESLint 零警告检查；
4. 单元、CLI、TUI、不变量与安装脚本测试；
5. 生产构建与 npm 包安装烟测。

Desktop 侧由 `SparkCliBridgeService.test.ts` 覆盖鉴权、凭据不外泄、动态 Provider 刷新、多实例隔离和崩溃残留清理。
