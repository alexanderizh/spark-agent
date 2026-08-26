# Spark CLI 安装、更新、卸载与发布闭环任务状态

> 状态: 实施中 | 最后核对: 2026-08-26

## 目标

完成 Spark CLI 的远程一键安装、显式更新检查与安全升级、精确卸载、自建 MinIO 制品发布和发布后验证闭环。发布必须先写入不可变版本制品并完成下载校验，最后发布 `latest.json`；任何失败都不得把不完整版本暴露为最新版本。

## 当前进度

- [x] 核对现有安装器、CLI 安装命令和本地 release 生成脚本。
- [x] 确认 CLI 生命周期入口影响风险为 LOW，且不需修改桌面端业务代码。
- [x] 完成 `spark update --check`、`spark update` 与稳定退出码（0/1/2/3/4，README 与 --help 已同步）。
- [x] 完成升级失败保留旧版本、包身份/版本/哈希三重验证（快照回滚 + 中断恢复 + 跨进程过期锁）。
- [x] 完成 MinIO 发布脚本、dry-run、远端 verify 和 `latest.json` 最后发布
      （`scripts/publish-release-to-minio.mjs` / `verify-release.mjs` / 共享契约 `release-contract.mjs`）。
- [x] 完成 POSIX / PowerShell 安装与卸载契约核对（含 Windows 全局 bin 定位修复）。
- [x] 补齐生命周期设计文档、README 和 CI 发布入口
      （docs/design/spark-cli-install-update-uninstall-release.md、.github/workflows/publish-spark-cli.yml）。
- [x] 通过完整测试、构建质量门（npm run verify 全绿：boundary/typecheck/lint/test/build/package-smoke）。
- [ ] 维护者执行首次真实 MinIO 发布并用 verify-release 收尾；真机 Windows 安装验证。

## 后续观察项

- DEFAULT_RELEASE_BASE 四处字面量拷贝（TS/contract/install.sh/install.ps1）由契约测试锁定，改动基址时必须同步。
- 项目级 `.spark/config.toml` 仅可开关更新通知，不可改写通道（防劫持）；如需放开须同步设计文档第 4 节。

## 已确认决策

- 唯一正式发布基址使用 Spark 自建制品域名，不使用虚构的 GitHub Release 地址。
- MinIO 凭据仅从现有 `MINIO_*` 环境变量读取，不写入源码、制品或日志。
- 版本化 tarball、sha256 sidecar 和安装脚本先发布并下载回读校验，`latest.json` 最后发布。
- 当前远程安装明确依赖 Node.js `>=22.14 <23` 与 npm；安装器必须先诊断并准确提示，不宣称免依赖。
- 更新采用可恢复事务：下载和校验先于安装，安装失败必须恢复原版本或明确返回恢复失败。

## 下一步

1. ~~完成源码与测试审计，列出确定性缺陷~~（已修复：SemVer BigInt 断言、stale 锁回收顺序、同源重定向用例、双 bucket 前缀、sendSigned 请求收尾、fileURLToPath 导入、Windows 全局 bin、共享契约去重）。
2. ~~实现 CLI 生命周期与发布器~~（publish/verify/contract 三脚本 + CI workflow 已落地）。
3. ~~运行聚焦测试和五轴审查，再运行完整质量门~~（npm run verify 全绿）。
4. 维护者：配置 MINIO\_\* secrets 后执行首次真实发布并运行 `release:verify`；真机 Windows 安装验证。
