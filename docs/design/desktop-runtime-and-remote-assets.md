# 桌面端按需 Runtime 与远程静态资源设计

> 状态: 已落地 | 最后核对: 2026-07-30

## 目标

- Claude Agent SDK 继续随桌面端安装包内置，保持开箱即用。
- Codex 保留 JS SDK，将平台原生 runtime 改为从 Spark MinIO artifact 源按需安装。
- 设置「完整性」继续统一展示 SDK 与 Codex runtime 的版本、可用性和升级状态。
- APIMart 超大图片不再依赖本地 Skia 压缩；本地文件上传后使用公开 URL。
- onboarding 与 Canvas prompt 示例图片从远程资源加载，支持预加载、过渡动画、失败占位和重试。
- Geist、Geist Mono 与 HarmonyOS Sans SC 不再打进 renderer，安装后后台下载，外观设置可手动重试。
- Electron 仅保留英文、简体中文和繁体中文 locale。

## Runtime 版本与升级

JS SDK 版本和平台原生 runtime 版本必须在 manifest 中成对声明。Codex/Claude runtime artifact 按平台、架构和版本拆分，下载到用户目录的版本隔离目录，完成 SHA256 校验和健康检查后原子切换。

设置页完整性检测同时读取：

1. 应用内置 JS SDK 版本；
2. managed runtime 当前激活版本；
3. MinIO manifest 中匹配当前平台/架构的最新版本。

Claude 只允许检查和升级，不能因为本次体积优化变成首次启动下载。Codex 在配置或首次对话前可提示按需安装；完整性页的「安装/更新」使用同一套 managed runtime 安装流程。

当前实现约定：Codex native runtime 落在
`{userData}/agent-runtimes/codex/<version>/<target-triple>/`，激活版本记录在
`active.json`。基础安装包只保留 `@openai/codex-sdk` JS 包，并在 Electron Builder
中排除 `@openai/codex-*/vendor/**`；生产进程找不到 managed runtime 时会在首次 Codex
对话返回专属的 `CODEX_RUNTIME_NOT_INSTALLED` 错误卡片。卡片可直接调用与完整性页相同的
`sdk:integrity-install` 流程下载安装，展示安装中、成功和失败状态；安装成功后可立即重试
当前消息，不要求重启应用。卡片同时保留「前往完整性」入口，跳转到统一的安装与升级页面。
Claude JS SDK 和各平台 native runtime 仍随应用安装包保留。

安装服务通过 `stream:sdk:install-progress` 同步准备、下载、校验解压、激活、完成和失败阶段。
下载阶段展示百分比以及已下载/总字节；服务端没有返回 `Content-Length` 时使用 manifest 的
`size` 作为总大小，仍不可得时显示不确定进度。会话卡片与完整性页订阅同一事件，不各自维护
另一套下载器。

升级分两层：应用版本升级负责 Codex JS SDK；完整性页查询 MinIO manifest 中与当前
平台/架构匹配且声明了 `@openai/codex-sdk@<version>` 的 runtime，下载到临时目录后
校验 SHA256、可执行文件和 `codex-package.json`，再原子切换 `active.json`。因此用户
本地完整性页仍然有用：它既能安装缺失 runtime，也能升级云端发布的新 runtime；云端
维护者只需上传新归档并追加 manifest artifact，旧版本仍可保留用于失败回滚。

MinIO manifest 当前已发布 Codex `0.144.5` 的六个平台包：macOS / Linux / Windows
的 x64 与 arm64。每个平台 artifact 都声明 target triple、SDK 兼容版本、SHA256、体积和
归档内容根，完整性服务只会选择与当前 `process.platform` / `process.arch` 同时匹配的条目。

点击「检查版本更新」时只比较与应用内 Codex JS SDK 兼容、且与当前平台完全匹配的 runtime。
发现新版后「更新」仍走 staging 下载、SHA256 校验和 `active.json` 原子切换；失败不会覆盖
当前激活版本。runtime 位于 Electron `userData` 而不是 `.app`、Program Files 或安装包资源目录，
因此正常覆盖安装或应用自动更新不会删除它。若新版应用升级了 Codex JS SDK，旧 runtime 的
`sdkPackage` 不再匹配时会被判为不可用，并提示下载匹配新版 SDK 的 runtime。

升级提醒采用分级策略：缺失或因应用升级导致不兼容时，在选择 Codex 和首次对话时主动提醒；
同一 JS SDK 下的可选 runtime 小版本更新只在完整性页「检查版本更新」后显示徽标，不做频繁
全局弹窗。若后续 runtime 发布安全修复，可在 manifest 增加强制升级级别后再接入一次性提醒。

## 失败与回滚

- 下载先落到临时目录，失败时清理半成品。
- 通过 SHA256、平台/架构和 runtime 健康检查后才激活。
- 新版本激活失败保留旧版本并回滚。
- 下载失败不阻塞应用启动；对话或 provider 配置页提供重试、切换 provider 和查看详情。

## 图片资源

远程图片使用版本化 asset manifest，资源 URL 只允许来自 Spark 资源域。图片组件在加载时显示骨架/过渡层，失败时显示统一占位和重试按钮。非关键资源失败不得阻塞应用启动、聊天或 Canvas 操作。

当前已上传到
`https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/assets/desktop/`：
onboarding posters 与 Canvas prompt examples 共 204 个 PNG（约 38.8 MiB）。渲染端
只保留稳定 URL 映射，不再通过 `import.meta.glob` 把这些 PNG 纳入 renderer bundle。

## 字体资源

基础包只声明系统字体 fallback，不再静态导入 `@lobehub/webfont-geist`、
`@lobehub/webfont-geist-mono` 和 `@lobehub/webfont-harmony-sans-sc`。应用启动 2 秒后在后台
查询 MinIO manifest 的 `archive.desktop-fonts`，下载并校验 SHA256 后安装到
`{userData}/assets/fonts/<version>-<sha>-<install-id>/`，再原子更新 `active.json`。

渲染进程通过白名单 `safe-file://` 协议和 `FontFace` API 预加载激活版本。下载或加载期间
继续使用系统字体，不阻塞首屏；成功后自动切换。设置「外观 → 字体」展示未下载、下载中、
已安装和失败状态，并提供立即下载、重新下载或重试按钮。升级检查失败时保留并继续使用旧版本。

当前云端字体归档版本为 `1.0.0`，包含 12 个文件，压缩包约 18.0 MiB；归档与 SHA256
记录在 `artifact-repository/v1/index.json`。

## APIMart 图片输入

HTTP(S) 输入直接传 URL；小型 data URL 可以直接传递；超过 3 MiB 或本地文件先通过 Spark 公开文件上传服务上传，拿到公开 URL 后再提交给 APIMart。移除 `@napi-rs/canvas` 及其 Skia 原生依赖。

上传服务复用 `AuthService.uploadFile()`，上传结果的 `aiUrl` 作为 APIMart 的
`image_urls`；未登录或上传失败时明确提示登录/重试，不再在桌面端解码、缩放或重新编码图片。

## 依赖收敛

`@react-three/drei`、`@react-three/fiber`、`three`、`exceljs` 和 `mammoth` 已移到
renderer 的 `devDependencies`。它们仍会被 Vite 打入 renderer（3D、docx、xlsx 功能不变），
但不会再被 electron-builder 当作 main 进程生产依赖收集。`npm`、Playwright、SQLite、keytar、
node-pty 和 Claude/Codex JS SDK 保留在生产依赖闭包中；npm 仍用于 npm/npx 类 Skill 和环境检测。

Playwright managed MCP 与 `spark_browser` 都由独立 Node runtime 执行，不能把 Electron
能够访问的 `app.asar` 虚拟路径直接交给普通 Node。发布包因此把 `@playwright/mcp` 及其匹配的
`playwright-core` 复制到 `Resources/playwright-mcp/node_modules/`，把内置浏览器桥脚本复制到
`Resources/tools/`；packaged 模式的路径解析只允许命中这两个真实目录。应用启动时自动注册并
启用 Playwright MCP，本地会话每轮默认注入 `spark_browser`，设置页的安装操作仅用于修复损坏
或补装浏览器，不再是首次安装后的必经步骤。

## Electron 语言包与 FFmpeg

macOS 的 electron-builder 24 只会按 `electronLanguages` 清理应用层 `Contents/Resources`，
不会清理 `Electron Framework.framework` 中的第二份 locale。构建流程因此增加签名前
`afterPack` 钩子，在 macOS 框架中只保留 `en.lproj`、`zh_CN.lproj`、`zh_TW.lproj`；
Windows/Linux 使用 `en-US`、`zh-CN`、`zh-TW`。钩子会校验三种目录确实存在，避免静默回归。

业务 FFmpeg CLI 已通过 `FfmpegIntegrityService` 和 MinIO artifact 按需安装。Electron 框架内
仍有约 2 MiB 的 `libffmpeg.dylib`，它属于 Chromium 的媒体解码运行库，供 `<audio>`、`<video>`
和媒体预览使用，不是业务 `ffmpeg`/`ffprobe` 命令行程序，不能用云端下载包替代。

## 验证结果

- macOS arm64 `.app` 从改造前约 1.0 GiB 降到 561 MiB；本轮字体与 locale 改造前为 615 MiB。
- renderer 产物约 70 MiB，HarmonyOS / Geist 字体文件为 0；原四组 HarmonyOS 字体约 17.6 MiB 已移出基础包。
- Electron Framework 从约 223 MiB 降到 186 MiB，框架 locale 从 55 个降到 3 个，语言资源合计约 1.3 MiB。
- Chromium `libffmpeg.dylib` 保留且约 2 MiB；包内不包含业务 FFmpeg CLI。
- 最终包内 Codex vendor 文件为 0；Claude native runtime 文件仍存在。
- 最终包内 `@napi-rs/canvas` 文件为 0；远程化的 onboarding / Canvas prompt 图片为 0。
- renderer-only 的 `three` / React Three Fiber / Drei / ExcelJS / Mammoth 在 `app.asar` 中均为 0 份，功能仍由 Vite bundle 提供。
- managed MCP 使用 `@playwright/mcp@0.0.78` 自带的 Playwright 依赖闭包，应用测试工具使用
  `playwright@1.62.0`；外置运行时避免了安装包中“配置存在但子进程无法读取 ASAR”的断连。
- agent-runtime / protocol / desktop typecheck、字体与 locale 针对性测试、Vite production build 和 Electron unpacked pack 均通过。

## 构建内存与 CI

renderer 当前需要转换约 1.6 万个模块，Node 22 默认约 4 GiB 的 V8 heap 会在 Rollup
渲染 chunk 时触发 `Ineffective mark-compacts near heap limit`。所有桌面构建入口现在统一通过
`scripts/run-electron-vite-build.js` 启动 electron-vite：保留已有 `NODE_OPTIONS`，并保证
`--max-old-space-size` 至少为 8192 MiB。该包装器使用 Node 子进程，不依赖 Unix 环境变量语法，
因此本地 macOS/Linux、Windows Git Bash/PowerShell 间行为一致。

发布 workflow 同样显式设置 8192 MiB，日志会打印最终配置。该数值是堆上限而非启动时预分配；
`pnpm build`、`build:prod`、`build:mac*`、`build:win` 和 `build:linux` 最终都复用同一安全入口。
