# GitHub Release 自动发布与应用内更新

Spark Agent 桌面端现在使用 `electron-builder + GitHub Releases + 官网版本中心 + 自定义更新服务` 作为发布与更新源。

## 发布流程

1. 合并代码到 `master`
2. 只有 [apps/desktop/package.json](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/package.json) 被改动时，workflow 才会触发
3. Workflow 会对比本次 push 前后的 `version`，只有版本号真的变化才继续发布
4. Workflow 自动创建 `v<version>` tag（如果还不存在）
5. `electron-builder` 为 macOS Apple Silicon、macOS Intel、Windows 打包并上传到对应 GitHub Release
6. Release 发布后，CI 会优先把安装包元数据登记到官网版本中心；应用内更新服务先读取官网版本中心，失败或不可用时回退 GitHub Release

## 当前仓库配置

- 发布源配置在 [apps/desktop/electron-builder.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/electron-builder.yml)
- 自动发布 workflow 在 [publish-desktop-release.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/.github/workflows/publish-desktop-release.yml)
- 应用内更新服务在 [UpdateService.ts](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/src/main/services/UpdateService.ts)
- 开发环境更新配置在 [dev-app-update.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/dev-app-update.yml)
- Playwright 相关 JS 包不再走整包 `asarUnpack`，避免 pnpm 硬链接目录在 `electron-builder` 打包阶段触发重复 link 的 `EEXIST`
- macOS Release 直接发布 `arm64` / `x64` 两个 `dmg`，Windows Release 直接发布 `x64` `exe`
- 应用更新检查不再依赖 `latest-mac.yml` / `latest.yml` 去解析 zip，而是读取官网版本中心返回的平台安装包；回退 GitHub 时直接按平台筛选 Release 资产
- Release 构建在调用 `electron-builder` 前会强制执行 `pnpm run rebuild:native -- <arch>`，把 `better-sqlite3` / `keytar` / `node-pty` 重编译到 Electron ABI；同架构 runner 会继续用 Electron 运行 `native:verify`，防止 Node ABI 二进制被打进安装包后启动即退出
- macOS `x64` Release 固定走 Intel runner，`arm64` Release 走 Apple Silicon runner；不再发布 universal 单包，避免单个 `node_modules` 目录混入错误架构的原生模块
- macOS 公证由 [notarize.js](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/scripts/notarize.js) 直接调用 Apple `notarytool`。当 Apple 上传/等待阶段返回 `HTTP`、超时、`503/504` 等临时文本错误时会自动重试，避免 `@electron/notarize` 把非 JSON 错误吞成 `Unexpected token ... is not valid JSON`
- Windows Release 必须在 Windows runner 上构建；本地/CI 不再支持从 macOS 或 Linux 交叉打包 Windows 安装包，避免打入错误平台的原生 `.node` 文件

## 应用内更新策略

- 应用启动后延迟一次自动检查，避免影响首屏加载
- 固定间隔轮询已移除，避免无意义消耗 GitHub API 请求次数
- 窗口重新聚焦且距离上次检查较久时，会补做一次轻量检查
- 发现新版本后先进入“可更新”状态，由用户主动点击后再开始下载
- 下载完成后主进程会弹出安装提示
- macOS 会打开 `dmg` 安装镜像，用户将应用拖到 `Applications` 完成替换安装
- Windows 会启动 `exe` 安装器；若 `autoInstall=true`，退出应用时会自动启动安装器
- 更新状态通过 `stream:update:status` 同步到设置页，包含当前版本、可用版本、下载进度和上次检查时间
- 更新状态会显示实际检查来源和下载来源：官网版本中心或 GitHub Releases
- 侧边栏顶部折叠按钮旁提供全局更新入口：检查、下载、下载中状态、安装
- 发布 workflow 会在调用 `electron-builder` 前清理空的签名 secret，避免空 `CSC_LINK` / `WIN_CSC_LINK` 被解析成工作目录路径导致构建失败
- Windows Release 构建统一走 [build-win-release.sh](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/scripts/build-win-release.sh)，本地和 CI 都使用同一套 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 处理逻辑。正式 CI 会优先签名，但证书缺失、签名失败或复验不可信时允许降级为未签名安装包，保证 GitHub Release 与官网版本中心仍能收到 Windows 产物；本地默认保持严格行为，可显式设置 `ALLOW_UNSIGNED_WINDOWS_RELEASE=1` 启用相同降级策略

## 开发调试

- `pnpm dev` 下更新检查和下载链路同样可用；若存在 [dev-app-update.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/dev-app-update.yml)，会优先读取其中的仓库配置
- 这能用于调试“检查更新 / 下载状态 / 顶部按钮 / 设置页同步”等流程
- 若远端 release 本身缺少对应平台安装包，例如 macOS 没有 `dmg` 或 Windows 没有 `exe`，开发环境同样会收到对应错误
- 更新检查优先请求 `releasesApiBase` 的 `/api/v1/desktop/releases/latest`；默认 `releasesApiBase` 为 `https://spark.yiqibyte.com`，失败后回退 GitHub REST API。GitHub 未认证请求会受官方 rate limit 约束；如果开发调试时频繁点“检查更新”，建议等待 reset 时间后重试，或仅在本地 `dev-app-update.yml` 中配置一个只用于开发的 GitHub token

## Windows 签名构建

- Windows Authenticode 签名不要求 Microsoft 开发者账户。免费的自签名证书可以证明安装包未被签名后篡改，但无法让未导入该证书的公网用户自动信任发布者；微软将自签名证书的首次 SmartScreen 体验归类为与未签名应用相同
- Windows 构建固定使用 SHA-256 和 DigiCert 的免费 RFC 3161 时间戳服务。时间戳能让已发布版本在签名证书到期后继续验证，但不能把自签名证书升级为受信任证书
- 正式 CI 建议配置 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD`。`WIN_CSC_LINK` 可以是 `.pfx` 文件的 base64 内容，也可以是 `https://` / `data:...;base64,...` 形式；workflow 会在 Windows runner 中解码并交给 `electron-builder` 签名。CI 设置了 `ALLOW_UNSIGNED_WINDOWS_RELEASE=1`：证书缺失或签名失败时会清理签名尝试产生的 Windows 文件并重新打包一次未签名安装包；若无签名重试也失败，构建仍会终止
- 在自己的 Windows 电脑上用 PowerShell 生成长期使用的 RSA-4096、SHA-256、Code Signing EKU 自签名证书：

```powershell
cd apps\desktop
pnpm run cert:win:self-signed
```

- 脚本默认把以下文件写到桌面的 `spark-agent-signing` 目录：
  - `spark-foundation-code-signing.pfx`：包含私钥，只用于备份或本地签名，严禁分发
  - `spark-foundation-code-signing.pfx.base64.txt`：把完整内容配置到 GitHub Actions secret `WIN_CSC_LINK`，同样严禁分发
  - `spark-foundation-code-signing.cer`：仅包含公钥，可用于受控电脑手动建立信任
  - `spark-foundation-code-signing.info.txt`：记录证书指纹、有效期和文件 SHA-256
- 把生成 PFX 时输入的密码配置到 GitHub Actions secret `WIN_CSC_KEY_PASSWORD`。PFX、base64 文件和密码必须离线备份；以后所有 Windows 版本都使用同一个 PFX，重新生成证书会丢失原证书积累的发布者信誉
- 本地 Windows 构建使用同一入口；没有证书时直接产出未签名安装包：

```bash
cd apps/desktop
pnpm run build:win:release -- --publish never
```

- 若不在 `apps/desktop` 目录，也可从仓库根目录调用：

```bash
bash apps/desktop/scripts/build-win-release.sh x64 --publish never
```

- 如果本地有 `.pfx`，可在运行前设置：

```bash
WIN_CSC_LINK=/path/to/cert.pfx \
WIN_CSC_KEY_PASSWORD=your-pfx-password \
pnpm run build:win:release -- --publish never
```

- 若本地不想把证书落盘，也可以把 `.pfx` base64 后传入 `WIN_CSC_LINK`。脚本会写入临时目录，构建结束自动删除
- 只有提供了 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 且未开启 unsigned fallback 时，脚本才会要求最终 `.exe` 的 Authenticode 状态为 `Valid` 且存在 RFC 3161 时间戳。若开启 `ALLOW_UNSIGNED_WINDOWS_RELEASE=1`，自签名证书在干净 runner 上不受信任时只记录警告，不再向 CurrentUser Root 证书库写入临时信任，从而避免无人值守 CI 被 Windows 根证书确认卡住

### 免费方案能减少哪些警告

- 公网普通用户：无法消除首次 SmartScreen“Windows 已保护你的电脑”提示。应长期使用同一证书、同一 HTTPS 下载域名，并把同一份构建产物同步到 GitHub 和官网，避免对相同版本反复重打包造成不同文件哈希
- 自己的电脑、团队电脑或学校机房：管理员可以先核对 `.cer` 的 SHA-256/Thumbprint，然后手动把公钥证书导入 `本地计算机 -> 受信任的根证书颁发机构` 和 `受信任的发布者`。导入后，同一证书签名的后续版本可在这些受控电脑上被信任
- 不应让 NSIS 安装器静默导入根证书。安装器本身尚未受信任，静默提升一个根证书会制造更严重的安全风险，也通常需要管理员权限
- 对公网用户，真正减少或消除警告的可靠方式只有受信任的 OV/EV/云签名证书，或由 Microsoft Store 重新签名分发；这些方式均需要身份验证，不能由自签名配置替代

在受控电脑上导入前，先通过安全渠道核对 `spark-foundation-code-signing.info.txt` 中的指纹。确认无误后，以管理员 PowerShell 执行：

```powershell
$cer = "C:\path\to\spark-foundation-code-signing.cer"
Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\Root
Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
```

## 使用要求

- 每次希望发布新版本时，需要先更新 `apps/desktop/package.json` 里的 `version`
- GitHub Actions 需要仓库 `contents: write` 权限来创建 tag 和 release
- 若要用于正式分发，建议配置签名相关 secrets：
  - `CSC_LINK`：base64 编码的 macOS `.p12`，必须包含 `Developer ID Application` 证书和私钥；`Apple Development` 证书不能用于正式发布和公证
  - `CSC_KEY_PASSWORD`：上述 `.p12` 的导出密码
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`
  - `WIN_CSC_LINK`：Windows 代码签名 `.pfx` 的路径、URL、data URL，或 base64 内容；正式 CI 建议配置，缺失时会发布未签名安装包
  - `WIN_CSC_KEY_PASSWORD`：上述 `.pfx` 的导出密码
- macOS CI 会在导入证书后校验 `Developer ID Application` identity；如果 secret 误填成开发证书，会立即失败，避免后续公证阶段才报未签名或 adhoc 签名错误
- `NOTARIZE_MAX_ATTEMPTS` 可覆盖 macOS 公证上传重试次数，默认 3 次；正式 CI 通常无需设置
- Windows CI 会检查 `.exe` 的 Authenticode 状态与时间戳；检查失败会产生警告但不阻断发布。签名打包本身失败时会自动重试一次未签名打包，确保官网上传链路优先获得可安装产物

## 更新通道

- `stable` 通道读取正式 release
- `beta` 通道允许读取 prerelease；如果后续要发 beta，只需要把发布流程改为 prerelease 即可
