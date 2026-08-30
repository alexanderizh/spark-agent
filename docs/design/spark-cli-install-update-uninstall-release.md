# Spark CLI 安装、更新、卸载与发布生命周期设计

> 状态: 已落地 | 最后核对: 2026-08-26

## 1. 概述

Spark CLI 的完整生命周期闭环：远程一键安装、显式更新检查与安全升级、精确卸载、自建 MinIO 制品发布与发布后公网验证。核心不变式是：**任何失败都不得把不完整版本暴露为「最新版本」**——发布先写不可变版本制品并通过双通道回读校验，`latest.json` 永远最后发布。

## 2. 发布基址（单一事实源）

正式发布基址为自建 MinIO 域名：

```
https://minio.yiqibyte.com/spark-desktop/spark-cli/v1
```

取值以 `src/cli/release.ts` 的 `DEFAULT_RELEASE_BASE` 为 TS 侧源头；`.mjs` 工具链从 `scripts/release-contract.mjs` 导入；两个安装器因运行时无法 import JS，各自持有字面量拷贝。四处一致性由 `test/unit/release-manifest.test.ts` 的契约测试强制。

## 3. 安装（curl | sh / irm | iex）

入口：`install.sh`（POSIX sh）、`install.ps1`（PowerShell，`install.cmd` 为 cmd 包装）。契约：

- 先诊断 Node `>=22.14 <23` 与 npm 依赖，缺失时明确报错退出（不宣称免依赖）；
- 下载版本化 tarball 并对 `latest.json`（或钉版时的 `.sha256` sidecar）做 SHA-256 校验；
- `npm install -g` 安装；npm 全局 bin 不在 PATH 时回退执行 `spark install` 链接 `~/.spark/bin` 启动器；
- Windows 上 npm 全局 bin 即 prefix 本身（无 `/bin` 子目录），安装器据此定位；
- `--tarball`/`SPARK_INSTALL_TARBALL` 支持离线本地安装（桌面端内嵌安装的挂点）。

## 4. 更新（spark update）

事务顺序：下载+校验和 → tarball 内嵌 package.json 身份/版本/engines 三重验证 → 全局树内 staging 安装 → 运行 `--version` 与 `doctor --json` 健康探测 → 快照切换（rename 原子替换）→ bin 启动器重链。任一步失败恢复快照，旧版本始终可运行。

关键机制：

- **跨进程锁** `~/.spark/update.lock`：新鲜外部锁被尊重；超过 15 分钟判定过期并回收一次（防崩溃更新器永久卡死）；owner pid 仅作诊断记录。
- **中断恢复**：阶段目录 `.spark-agent-backup-*` 在下一次 update 时自动恢复或清理。
- **网络边界**（`src/cli/net.ts`）：仅 https（回环 http 仅供测试）、拒绝凭据内嵌、同源重定向限量、响应体大小上限与整体 deadline。
- **通道来源优先级**：flag > env(`SPARK_RELEASE_BASE`/`SPARK_INSTALL_BASE`) > 全局 `[update] base_url` > 内置默认。项目级 `.spark/config.toml` **只能**开关每日通知，不能改写更新通道（防仓库劫持，见 `resolveUpdateSource`/`readUpdateSettings`）。
- **退出码**：0 有可用/已应用；1 已最新/远端更旧/prerelease 未放行；2 用法错误；3 失败；4 锁冲突。
- 每日通知（TUI 场景）：最多一天一次，4 秒硬预算竞速，绝不阻塞启动。

## 5. 卸载（spark uninstall --package）

只删除可证明归属 spark 的内容：npm 全局树的 `@spark/agent` 包、其 bin shim（symlink/脚本内容双重证明）、`~/.spark/bin` 启动器。macOS `/var ↔ /private/var` 别名通过 realpath 身份集合归一。外来 `spark` 条目只报告不删除；`~/.spark` 配置/会话/缓存永不触碰。

启动器归属判定集中在 `isSparkOwnedLauncher`：Unix 校验 symlink 目标解析后落在包目录且包名匹配；Windows 校验 cmd shim 内容标记与嵌入 entry，再读目标包的 `package.json` 名称确认。

## 6. 发布流水线

工具链（全部依赖 Node 内置模块，spark-engine 保持零新增依赖）：

| 步骤 | 工具                                   | 关键行为                                                                                                                                                  |
| ---- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 制备 | `scripts/prepare-release.mjs`          | npm pack + sha256 sidecar + latest.json + 安装器拷贝；安装器缺失 fail-closed；产物自检通过共享 schema                                                     |
| 发布 | `scripts/publish-release-to-minio.mjs` | 内置 SigV4（node:crypto，已通过 AWS 官方签名向量回归）；两阶段：不可变审计（冲突即中止、相同即跳过）→ 上传缺失 → 认证+公网双读回校验 → `latest.json` 最后 |
| 验证 | `scripts/verify-release.mjs`           | 公网 HTTPS 后置条件检查：latest.json 严格 schema、tarball sha256、sidecar 一致性、安装器存在；可带本地目录做逐字节比对                                    |

配置全部来自环境变量（不入库、不入日志）：`MINIO_IP` / `MINIO_PORT_API` / `MINIO_ID` / `MINIO_PWD` / `MINIO_BUCKET` / `BUCKET_BASE_URL`。对象键 = 远端 base 在 bucket 内的相对路径；`--base` 必须落在 `BUCKET_BASE_URL` 之下。dry-run 纯本地校验，不需要任何凭据。

CI 入口：`.github/workflows/publish-spark-cli.yml`（push 于 `spark-engine/package.json` 版本变化触发，或手动 dispatch 含 dry-run 选项），执行 `npm run verify → prepare → publish → verify-release`。

## 7. 共享契约模块

`scripts/release-contract.mjs` 集中维护：默认基址常量、严格 SemVer 判定、`latest.json` schema 校验（键白名单、`@spark/agent` 身份、小写 hex64 摘要、确定性 tarball 文件名、ISO 8601 publishedAt）。三个 .mjs 工具一律 import 该模块，杜绝此前各副本（前导零版本可放行、publishedAt 缺失校验）之间的漂移；TS 侧对应 `parseReleaseManifest`，语义保持逐字段一致。

## 8. 测试矩阵

- 单元：manifest schema、URL 边界、SemVer 优先级、锁语义、分类器、SigV4 AWS 向量、发布器假 S3 e2e（含 latest-last 写序与篡改中止）、verify 脚本进程内全流程。
- 集成：`test/cli/install-script.test.ts`（真实 sh 执行安装器 + 本地静态服务器）、`test/cli/update.test.ts`（真实 npm prefix 下的升级/降级/校验失败回滚/锁竞争/卸载闭环）、`test/cli/install.test.ts`（launcher 生命周期）。
- 已知待办：真机 Windows PowerShell 安装与真实 MinIO 凭据下的首次端到端发布（发布动作由维护者执行后用 `verify-release.mjs` 收尾）。
