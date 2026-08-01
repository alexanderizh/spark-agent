# Office 与本地深度可选能力交付审查

## 结论

离线 Office Viewer 与本地深度处理已经完成代码、资源发布、正式 MinIO 清单更新、干净目录安装、真实功能验收和 macOS arm64 产物审查。Computer Use 按本轮要求完全跳过，既未制品化，也未改变其代码和打包方式。

## 正式制品

正式清单：`https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json`，发布后共 67 项制品，仓库全量审计通过。

| 能力 | Artifact ID | 下载大小 | SHA-256 | 安装后大小 |
| --- | --- | ---: | --- | ---: |
| Office Viewer | `archive.optional-office-viewer-2.2.3-1` | 56,272,983 B | `2fffb459e1b1919ac903f31dca5a6a481f7ee29f77df2549743875481d41e147` | 146,330,723 B |
| Depth Runtime / darwin-arm64 | `runtime.optional-depth-transformers-4.2.0-onnx-1.24.3-1-darwin-arm64` | 21,033,096 B | `c03d5699fe2d6411cf2c93ce4317a3c387284afe2769517d02446b2291f4b386` | 与模型合计 94,473,021 B |
| Depth Anything V2 Small INT8 | `model.depth-anything-v2-small-int8-1.0.0` | 21,231,211 B | 由正式清单约束 | 计入上项合计 |

发布严格执行本地 size/SHA 校验、正式清单备份、对象上传、HEAD、公网完整 GET 复算 SHA、staging 清单、全仓审计、正式清单替换和再次公网回读。备份对象为 `artifact-repository/v1/backups/index-2026-08-01T19-12-57-047Z.json`，staging 对象为 `artifact-repository/v1/staging/index-optional-1785611647738.json`。凭据未写入仓库、文档、测试快照或命令输出。

## 流程验收

- 全新 userData `/private/tmp/spark-optional-clean-userdata-final-20260802` 从公网正式清单安装成功：Office 为 `ready 2.2.3-1`，本地深度为 `ready 4.2.0-1.24.3-1+1.0.0`。
- Office 使用真实 DOCX、XLSX、PPTX 在 Chromium 中加载最终安装目录资产：文档文字、工作表 `Smoke`（2 行 × 2 列）和演示文稿标题均实际渲染，控制台 0 error、0 warning。
- 深度使用已安装 Runtime 与模型完成 8×8 RGB 单帧推理，得到 64 个有限深度值，范围 1.7148596—3.6034017。
- 深度短视频贯通解码、估深、编码三阶段，H.264 32×24、2 fps、1 秒输入输出均为 2 帧。
- 管理器覆盖缺失、队列、下载、校验、解压、激活、取消、更新、修复、卸载、旧版本保留和损坏识别；`active.json` 同时锚定包 manifest SHA 和逐文件 SHA，篡改会进入 damaged 而不是继续使用。
- URL 只接受 HTTPS，能力目录做 lexical/realpath 边界检查，归档拒绝路径穿越和符号链接逃逸；日志包含 capability、stage、errorCode 并对 URL query 脱敏，客户端返回可重试、可理解的中文错误。

## 最终 macOS arm64 产物

本地验收产物位于 `/private/tmp/spark-optional-capabilities-delivery-final-20260802`：

| 项目 | 最终值 |
| --- | ---: |
| `.app` | 801,329,152 B |
| `app.asar` | 125,395,338 B |
| `app.asar.unpacked` | 303,521,792 B |
| DMG | 270,872,320 B |
| DMG SHA-256 | `4e4ed1b32bf0aeaf6832e461d180c511fc1edcdcb83a84701f417b160b51d927` |
| ASAR entries | 3,530 |

对比原始 398,417,355 B DMG，减少 127,545,035 B，约 32.0%。ASAR 已全量成功解包；路径与内容扫描确认不含 `out/renderer/file-viewer`、`@huggingface/transformers`、`onnxruntime-node`、`onnxruntime-web`，也不含 Vite 哈希生成的 `pptx.worker`、`ppt-native.wasm` 或 `ppt-font-cjk.otf`。ONNX absent 模式校验、Electron native ABI 校验和 `codesign --deep --strict` 均通过。

产物使用 Developer ID 签名；当前环境未配置 Apple 公证凭据，因此 DMG 未公证，只适合本地验收。正式对外发布前仍需在发布环境完成 notarization。当前只发布了本机可真实验证的 darwin-arm64 深度 Runtime；darwin-x64/Windows 必须由对应可信 runner 生成，设置页在此之前会显示 unavailable，不会伪造制品。

## 测试与静态检查

- Desktop 可选能力、Office、深度、IPC、构建钩子最终统一回归 15 个测试文件、93 项全部通过；真实短视频 acceptance 另计 1 项通过。较早一次 94 项回归中的两项失败分别定位为 workflow 平台字符串误匹配和验收环境错误选中 Homebrew FFmpeg，修复/改用受管 FFmpeg 后均通过。
- 新增激活完整性回归：管理器 14 项通过；可选能力设置/进度 UI 3 项通过；Office 外部资源构建闭锁 3 项通过。
- Protocol schema 35 项、agent-runtime manifest/tarball 2 项、制品生成与 MinIO publisher 7 项全部通过。
- Protocol 与 agent-runtime TypeScript 检查通过；相关生产代码 ESLint 和 `git diff --check` 通过。
- Desktop 全量 renderer typecheck 仍有 2 个与本功能无关的既存 chat 测试类型错误（`chat-turn-summary-order.test.ts` 的 `"markdown"`）；node typecheck 仍有 2 个被本轮明确排除的 Computer Use 类型错误（`NativeHostComputerUseBackend.ts` 的 `targetProcessId` exact optional）。本轮没有修改或掩盖这些文件。

## 五轴代码审查

- 正确性：检查了安装状态机、并发去重、取消/卸载协同、任务与共享安装生命周期、worker 早期 fatal race、旧版本回滚和真实解码/推理/编码流程；发现项均已修复并加入回归。
- 可读性：能力协议、管理器、状态存储、定义、IPC、UI 和构建/发布脚本分层；没有继续扩张大型设置页。
- 架构：renderer 不持有仓库凭据或文件系统权限；Office 走只读自定义协议，深度 worker 只接收已激活绝对入口；Computer Use 没有被混入定义。
- 安全性：检查了 HTTPS、平台/架构、artifact 类型、SHA、manifest 锚定、路径边界、日志脱敏、原子激活和失败保留旧版本。
- 性能：清单使用 24 小时磁盘缓存且列表不触发网络；Office 资源哈希使用完整性缓存；Transformers Runtime 单次加载；基础包去除重复 Office Worker/WASM/字体和深度运行时。

GitNexus MCP 本轮未暴露，按仓库降级规则使用 `rg`、调用点阅读、定向测试、真实产物、`git diff` 完成影响与变更核对；CLI 索引已更新到 55,530 nodes、98,745 edges、1,470 clusters、300 flows。索引器仅报告既存 `CanvasOperationWorkbench.test.tsx` scope 提取警告，整体索引成功。
