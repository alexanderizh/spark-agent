> 状态: 实施中(语音资源已发布到 MinIO,2026-07-19)| 最后核对: 2026-07-19

# 语音包 MinIO 仓库接入规格

本文档说明如何把语音输入（离线 ASR：sherpa-onnx + Paraformer-streaming）所需的 native 运行时与模型文件接入 Spark 自建安装源（MinIO `artifact-repository/v1/index.json`）。

代码侧的完整性检测、按需下载、流式识别管线已在仓库实现（见 `apps/desktop/src/main/services/VoiceIntegrityService.ts`、`VoiceRecognitionService.ts`，渲染层 `design/voice/*`）。本文档是**部署侧**的最后一公里：准备资源文件 + 维护 manifest。

## 1. 资源清单

语音包由两类 artifact 构成：

| 类别 | id 前缀 | 平台相关 | 说明 |
|---|---|---|---|
| native 运行时 | `voice.native.` | 是（4 个平台组合） | sherpa-onnx-node 原生模块（JS wrapper + `.node` + onnxruntime 动态库） |
| 识别模型 | `voice.model.` | 否（跨平台单条） | Paraformer-streaming ONNX（encoder/decoder/tokens） |

代码侧约定（`VoiceIntegrityService.ts`）：
- native artifact `id` 必须以 `voice.native.` 开头，且带 `platform` + `arch`；安装后写入 `userData/voice/native/<version>-<platformKey>/`。
- model artifact `id` 必须以 `voice.model.` 开头；安装后写入 `userData/voice/model/<version>/`。
- 选包：同前缀下取 `version` 最大的（语义版本比较）。
- 平台键（`VoicePlatformKey`）：`darwin-arm64` / `darwin-x64` / `win32-x64` / `linux-x64`，其余平台视为不支持。

## 2. manifest 条目（追加到 `index.json` 的 `artifacts` 数组）

`sha256` 与 `size` 为占位符，打包后用实际值替换（见 §4）。`url` 相对 `baseUrl`（即 manifest 所在目录）解析。

```jsonc
// ── native 运行时（4 个平台）──
{
  "id": "voice.native.1.13.4.darwin-arm64",
  "type": "voice",
  "name": "sherpa-onnx native runtime (darwin-arm64)",
  "version": "1.13.4",
  "url": "voice/sherpa-onnx-node-1.13.4-darwin-arm64.tar.gz",
  "sha256": "<FILL_AFTER_PACKAGING>",
  "size": 0,
  "platform": "darwin",
  "arch": "arm64",
  "archive": { "format": "tar.gz" },
  "notes": "sherpa-onnx-node 1.13.4，Electron ABI；内含 package.json(main) + JS wrapper + .node + onnxruntime 动态库"
},
{
  "id": "voice.native.1.13.4.darwin-x64",
  "type": "voice",
  "name": "sherpa-onnx native runtime (darwin-x64)",
  "version": "1.13.4",
  "url": "voice/sherpa-onnx-node-1.13.4-darwin-x64.tar.gz",
  "sha256": "<FILL_AFTER_PACKAGING>",
  "size": 0,
  "platform": "darwin",
  "arch": "x64",
  "archive": { "format": "tar.gz" },
  "notes": "同上，x64"
},
{
  "id": "voice.native.1.13.4.win32-x64",
  "type": "voice",
  "name": "sherpa-onnx native runtime (win32-x64)",
  "version": "1.13.4",
  "url": "voice/sherpa-onnx-node-1.13.4-win32-x64.tar.gz",
  "sha256": "<FILL_AFTER_PACKAGING>",
  "size": 0,
  "platform": "win32",
  "arch": "x64",
  "archive": { "format": "tar.gz" },
  "notes": "Windows；.node + onnxruntime.dll"
},
{
  "id": "voice.native.1.13.4.linux-x64",
  "type": "voice",
  "name": "sherpa-onnx native runtime (linux-x64)",
  "version": "1.13.4",
  "url": "voice/sherpa-onnx-node-1.13.4-linux-x64.tar.gz",
  "sha256": "<FILL_AFTER_PACKAGING>",
  "size": 0,
  "platform": "linux",
  "arch": "x64",
  "archive": { "format": "tar.gz" },
  "notes": "Linux；.node + libonnxruntime.so"
},

// ── 识别模型（跨平台，单条）──
{
  "id": "voice.model.paraformer-streaming.1.0",
  "type": "voice",
  "name": "Paraformer streaming ASR model (trilingual)",
  "version": "1.0.0",
  "url": "voice/paraformer-streaming-trilingual-1.0.0.tar.gz",
  "sha256": "<FILL_AFTER_PACKAGING>",
  "size": 0,
  "archive": { "format": "tar.gz" },
  "notes": "sherpa-onnx 官方 streaming paraformer 三语（中粤英）ONNX 量化版；内含 model-package.json"
}
```

> `baseUrl` 在 manifest 顶层维护（已有其他 artifact 使用）。若现有 manifest 无 `baseUrl`，`resolveArtifactUrlString` 会回落到 manifest URL 所在目录，相对路径仍可解析。

## 3. 打包结构（tarball 内部布局）

安装流程：`installBinaryArchive` 解压 tarball 到 staging 目录 → 整目录 rename 到目标目录。因此**归档根目录即为最终目录内容**。

### 3.1 native 运行时 tarball

```
sherpa-onnx-node-1.13.4-darwin-arm64.tar.gz
└── <root>/
    ├── package.json          # 必须有 "main" 字段，指向 JS wrapper 入口
    ├── index.js              # JS wrapper（require 真正的 .node）
    ├── build/Release/
    │   └── sherpa_onnx.node  # 编译产物（Electron ABI）
    └── onnxruntime.*         # 动态库：macOS=.dylib / linux=.so / win=.dll
```

`package.json` 示例（`main` 是关键，`VoiceIntegrityService.resolveVoiceModelPaths` 据此定位 native 入口）：

```json
{
  "name": "sherpa-onnx-node",
  "version": "1.13.4",
  "main": "index.js",
  "description": "sherpa-onnx Node binding (Electron build, darwin-arm64)"
}
```

`index.js`（JS wrapper）需用 `createRequire` 相对加载同包内的 `.node`，保证搬运到 `userData` 后路径仍正确：

```js
const { createRequire } = require('module')
const path = require('path')
const require2 = createRequire(__filename)
module.exports = require2(path.join(__dirname, 'build/Release/sherpa_onnx.node'))
```

> **ABI 关键**：`.node` 必须匹配 Electron 的 Node ABI（而非系统 Node）。复用仓库 `better-sqlite3` 的 `vendor/prebuilds` + `scripts/sqlite-abi.sh` 套路（见记忆 `storage-tests-better-sqlite3-abi`）。最稳妥是直接拿 sherpa-onnx 官方针对 electron 的 prebuilt，或在本机用 `electron-rebuild` 重编。

### 3.2 模型 tarball

```
paraformer-streaming-trilingual-1.0.0.tar.gz
└── <root>/
    ├── model-package.json    # 必须：version / encoder / decoder / tokens
    ├── encoder.int8.onnx     # 或官方对应文件名
    ├── decoder.int8.onnx
    └── tokens.txt
```

`model-package.json` 示例（字段名与 `VoiceRecognitionService.readModelDescriptor` 对齐）：

```json
{
  "version": "1.0.0",
  "encoder": "encoder.int8.onnx",
  "decoder": "decoder.int8.onnx",
  "tokens": "tokens.txt"
}
```

模型来源：sherpa-onnx 官方 `sherpa-onnx-streaming-paraformer-trilingual` 预导出 ONNX（HuggingFace `k2-fsa/sherpa-onnx-streaming-paraformer-trilingual`）。下载后按上面结构重命名 + 加 `model-package.json` 重新打包。

## 4. 上传与校验

1. 打包出 5 个 tarball（4 native + 1 model）。
2. 计算每个文件的 sha256 与字节数：
   ```bash
   shasum -a 256 voice/sherpa-onnx-node-1.13.4-darwin-arm64.tar.gz
   stat -f%z voice/sherpa-onnx-node-1.13.4-darwin-arm64.tar.gz   # macOS 字节数
   ```
3. 上传到 MinIO（环境变量 `BUCKET_BASE_URL` / `REPOSITORY_JSON` 已配置）：
   - 对象前缀：`spark-desktop/artifact-repository/v1/voice/`
   - 即公网访问 `https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/voice/<file>`。
4. 把 §2 的 JSON 条目（替换真实 `sha256`/`size`）追加进 `spark-desktop/artifact-repository/v1/index.json` 的 `artifacts` 数组，刷新顶层 `updatedAt`。
5. 在应用内「设置 → 完整性」点「语音包」检查项的安装，或直接在对话输入框点麦克风按钮触发首次按需下载，验证全链路。

## 5. 验收要点

- [ ] `voice:check-integrity` 在未安装时返回 `ready:false`，组件状态 `missing`。
- [ ] 触发 `voice:install` 后，`stream:voice:install-progress` 按 preparing→downloading→verifying→activating→done 推送，sha256 校验通过。
- [ ] 安装完成后 `resolveVoiceModelPaths()` 返回非空，`voice:start` 能创建会话并返回 sessionId。
- [ ] 渲染层麦克风采集 → `voice:feed-audio` chunk → `stream:voice:recognition` 推 partial/final，文本回填到输入框。
- [ ] 平台不支持（如 linux-arm64）时 `supported:false`，麦克风按钮禁用并提示。

## 6. 后续可选增强

- 双模型：流式 Paraformer 出实时草稿 + 句尾用 SenseVoice-Small 重转定稿（精度更高，代价是多一次推理 + 多一个 model artifact，前缀仍 `voice.model.`，version 区分）。
- 云端 ASR provider：复用现有多媒体 provider 架构，把火山/阿里/OpenAI 作为可选云端语音 provider，本地 sherpa-onnx 作为默认 provider。
- 模型版本升级：manifest 内提高 `voice.model.*` 的 `version`，`checkVoiceIntegrity(checkLatest:true)` 会识别新版，UI 提示更新。

## 7. 实际产物（2026-07-19 已上传 MinIO）

对象前缀：`spark-desktop/artifact-repository/v1/voice/`（公网 baseUrl `https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1`）。完整 sha256 已写入线上 `index.json`，artifacts 总数 53→58，updatedAt=2026-07-19。

| id | url | size |
|---|---|---|
| voice.native.1.13.4.darwin-arm64 | voice/sherpa-onnx-node-1.13.4-darwin-arm64.tar.gz | 17,100,997 |
| voice.native.1.13.4.darwin-x64 | voice/sherpa-onnx-node-1.13.4-darwin-x64.tar.gz | 19,510,906 |
| voice.native.1.13.4.linux-x64 | voice/sherpa-onnx-node-1.13.4-linux-x64.tar.gz | 10,627,287 |
| voice.native.1.13.4.win32-x64 | voice/sherpa-onnx-node-1.13.4-win32-x64.tar.gz | 8,503,852 |
| voice.model.paraformer-streaming.1.0 | voice/paraformer-streaming-trilingual-1.0.0.tar.gz | 218,673,757 |

- **native 实际结构（已修正）**：每个 native tarball 解压后根目录含 `sherpa-onnx-node` 主包的全部 JS wrapper（`sherpa-onnx.js`/`addon.js`/`streaming-asr.js`/`types.js` 等，`package.json.main = sherpa-onnx.js`）+ 对应平台的 `sherpa-onnx.node` + onnxruntime 动态库，三者同目录。`addon.js` 的 `possible_paths` 末项 `./sherpa-onnx.node` 命中加载，无需改代码、无需 `DYLD_LIBRARY_PATH`。require 后得到 `OnlineRecognizer` 类式 API（`new OnlineRecognizer(config)`/`createStream()`/`acceptWaveform()`），已实测通过。
- native 来源：`npm pack sherpa-onnx-node@1.13.4`（JS wrapper）+ `npm pack sherpa-onnx-{darwin-arm64,darwin-x64,win-x64,linux-x64}@1.13.4`（N-API 二进制）合并。N-API ABI 稳定，Electron 可直接加载，无需 electron-rebuild。
- 模型来源：HuggingFace `csukuangfj/sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en` int8 量化版，补 `model-package.json` 后重新打包。
