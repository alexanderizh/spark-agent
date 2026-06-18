# GitHub Release 自动发布与应用内更新

Spark Agent 桌面端现在使用 `electron-builder + GitHub Releases + 自定义更新服务` 作为发布与更新源。

## 发布流程

1. 合并代码到 `master`
2. 只有 [apps/desktop/package.json](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/package.json) 被改动时，workflow 才会触发
3. Workflow 会对比本次 push 前后的 `version`，只有版本号真的变化才继续发布
4. Workflow 自动创建 `v<version>` tag（如果还不存在）
5. `electron-builder` 为 macOS Apple Silicon、macOS Intel、Windows 打包并上传到对应 GitHub Release
6. Release 发布后，应用内更新服务直接读取 GitHub Release 资产，按平台选择安装包并下载

## 当前仓库配置

- 发布源配置在 [apps/desktop/electron-builder.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/electron-builder.yml)
- 自动发布 workflow 在 [publish-desktop-release.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/.github/workflows/publish-desktop-release.yml)
- 应用内更新服务在 [UpdateService.ts](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/src/main/services/UpdateService.ts)
- 开发环境更新配置在 [dev-app-update.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/dev-app-update.yml)
- Playwright 相关 JS 包不再走整包 `asarUnpack`，避免 pnpm 硬链接目录在 `electron-builder` 打包阶段触发重复 link 的 `EEXIST`
- macOS Release 直接发布 `arm64` / `x64` 两个 `dmg`，Windows Release 直接发布 `x64` `exe`
- 应用更新检查不再依赖 `latest-mac.yml` / `latest.yml` 去解析 zip，而是直接按平台筛选 GitHub Release 资产

## 应用内更新策略

- 应用启动后延迟一次自动检查，避免影响首屏加载
- 固定间隔轮询已移除，避免无意义消耗 GitHub API 请求次数
- 窗口重新聚焦且距离上次检查较久时，会补做一次轻量检查
- 发现新版本后先进入“可更新”状态，由用户主动点击后再开始下载
- 下载完成后主进程会弹出安装提示
- macOS 会打开 `dmg` 安装镜像，用户将应用拖到 `Applications` 完成替换安装
- Windows 会启动 `exe` 安装器；若 `autoInstall=true`，退出应用时会自动启动安装器
- 更新状态通过 `stream:update:status` 同步到设置页，包含当前版本、可用版本、下载进度和上次检查时间
- 侧边栏顶部折叠按钮旁提供全局更新入口：检查、下载、下载中状态、安装
- 发布 workflow 会在调用 `electron-builder` 前清理空的签名 secret，避免空 `CSC_LINK` / `WIN_CSC_LINK` 被解析成工作目录路径导致构建失败
- Windows Release 构建统一走 [build-win-release.sh](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/scripts/build-win-release.sh)，本地和 CI 都使用同一套 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 处理逻辑；有证书时签名并在 Windows runner 上用 `Get-AuthenticodeSignature` 校验，没有证书时继续产出未签名安装包

## 开发调试

- `pnpm dev` 下更新检查和下载链路同样可用；若存在 [dev-app-update.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/dev-app-update.yml)，会优先读取其中的仓库配置
- 这能用于调试“检查更新 / 下载状态 / 顶部按钮 / 设置页同步”等流程
- 若远端 release 本身缺少对应平台安装包，例如 macOS 没有 `dmg` 或 Windows 没有 `exe`，开发环境同样会收到对应错误
- GitHub Release 检查当前走 GitHub REST API。未认证请求会受 GitHub 官方 rate limit 约束；如果开发调试时频繁点“检查更新”，建议等待 reset 时间后重试，或仅在本地 `dev-app-update.yml` 中配置一个只用于开发的 GitHub token

## Windows 签名构建

- CI 可配置 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD`。`WIN_CSC_LINK` 可以是 `.pfx` 文件的 base64 内容，也可以是 `https://` / `data:...;base64,...` 形式；workflow 会在 Windows runner 中解码并交给 `electron-builder` 签名。若这两个变量缺失，会继续构建未签名安装包
- 本地 Windows 构建使用同一入口；没有证书时直接产出未签名安装包：

```bash
cd apps/desktop
pnpm run build:win:release -- --publish never
```

- 根目录也提供了便捷入口：

```bash
bash build-sign-win.sh
```

或在 Windows cmd/PowerShell 中运行：

```bat
build-sign-win.bat
```

- 如果本地有 `.pfx`，可在运行前设置：

```bash
WIN_CSC_LINK=/path/to/cert.pfx \
WIN_CSC_KEY_PASSWORD=your-pfx-password \
pnpm run build:win:release -- --publish never
```

- 若本地不想把证书落盘，也可以把 `.pfx` base64 后传入 `WIN_CSC_LINK`。脚本会写入临时目录，构建结束自动删除
- 只有提供了 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 时，脚本才会要求最终 `.exe` 的 Authenticode 状态为 `Valid`

## 使用要求

- 每次希望发布新版本时，需要先更新 `apps/desktop/package.json` 里的 `version`
- GitHub Actions 需要仓库 `contents: write` 权限来创建 tag 和 release
- 若要用于正式分发，建议配置签名相关 secrets：
  - `CSC_LINK`：base64 编码的 macOS `.p12`，必须包含 `Developer ID Application` 证书和私钥；`Apple Development` 证书不能用于正式发布和公证
  - `CSC_KEY_PASSWORD`：上述 `.p12` 的导出密码
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`
  - `WIN_CSC_LINK`：Windows 代码签名 `.pfx` 的路径、URL、data URL，或 base64 内容；未配置时 Windows 产物不签名但仍会构建
  - `WIN_CSC_KEY_PASSWORD`：上述 `.pfx` 的导出密码
- macOS CI 会在导入证书后校验 `Developer ID Application` identity；如果 secret 误填成开发证书，会立即失败，避免后续公证阶段才报未签名或 adhoc 签名错误
- Windows CI 有证书时会校验 `.exe` 的 Authenticode 状态为 `Valid`；没有证书时跳过签名校验并保留安装包

## 更新通道

- `stable` 通道读取正式 release
- `beta` 通道允许读取 prerelease；如果后续要发 beta，只需要把发布流程改为 prerelease 即可
