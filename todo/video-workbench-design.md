# 画布视频处理工作台（Video Workbench）功能设计

> 状态: 实施中 | 最后核对: 2026-07-12

> 本文档是画布「视频处理工作台」新功能的全链路设计。基于对项目现有体系的 **3 轮深度调研**（minio 产物分发体系 + 技能市场链路 / 画布工作台范式 + 视频能力全景 + 附件系统 / 完整性检测体系 + Skill 封装机制 + 二进制下载范式）+ 全网开源方案比对（ffmpeg 场景检测 / fluent-ffmpeg 维护现状 / 跨平台二进制分发）+ 4 项架构决策确认后产出。本文是规划，不含最终实现代码，但所有设计决策都锚定到现有实现的精确文件与行号（见各节 `file_path:line_number`）。

---

## 0. 背景与边界

### 0.1 目标

为画布新增一个**纯本地、不经过大模型**的视频处理能力，核心场景：

- 上传视频后**自动/手动提取关键帧**，作为画布上的图像节点供后续 AI 消费（图生视频首帧、参考图等）。
- 提供**视频剪辑工作台**：裁剪、合并、分割、转码（含 GIF）、变速/反转/裁剪/水印/字幕烧录。
- 能力同时**封装为 Skill**，供 Agent 通过 Bash 工具自动化调用。

### 0.2 已确认的架构决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 提取引擎 | **纯 ffmpeg + 裸 `child_process.spawn` 薄封装** | [fluent-ffmpeg 已被官方归档](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324)（Issue #1324），2025 社区共识是裸 spawn + 自写薄封装；且有 fluent-ffmpeg 进程崩溃拖垮 Node 的可靠性报告。不引入第三方库，零维护风险。 |
| ffmpeg 二进制来源 | **优先系统 PATH，缺失则从自建 minio 仓库下载** | 不内置进安装包（避免 ~50MB/平台膨胀）；首次使用提醒下载；完整性面板提供检测与下载；作为 minio 市场的通用产物包。 |
| 分发机制 | **扩展通用产物下载（`type:'binary'`）** | 现有技能安装链路有 `type !== 'skill'` 硬检查（`skill-registry/index.ts:742`），不能直接复用。新增 `binary` 类型 + `installBinaryArtifact()` 方法 + 新 IPC，语义干净，不污染 skills 扫描。 |
| 二进制存放 | **userData 运行时下载** | 存 `{userData}/ffmpeg/{plat}-{arch}/`，不占安装包体积。检测优先级：userData/ffmpeg → 系统 PATH → 引导下载。 |
| 工作台形态 | **仿 stage3d 独立 Modal 工作台** | 新建 `canvas/videoWorkbench/` 子目录 + `director_video` 节点 subtype + 全屏 Modal。最贴合现有「独立工作台」范式。 |
| 第一期范围 | **关键帧提取 + 视频剪辑 + 转码 + 画面处理（四类全做）** | 用户明确要求。分阶段实施但终态覆盖全。 |
| Skill 发布 | **bundled + minio 精选推荐双路径** | 跟 app 走保证开箱可用；同时发布市场供单独安装。 |

### 0.3 不是什么

| 维度 | 不是 |
|------|------|
| 处理方式 | 不经过大模型/AI 推理（纯 ffmpeg 本地计算） |
| 编排对象 | 不是顶层 Agent 工作流（`workflows` 表），是画布内可视化工具 |
| 二进制打包 | 不打进 electron-builder extraResources（按需下载） |

---

## 1. 现状基线（调研结论）

### 1.1 可复用的核心资产

| 资产 | 位置 | 复用方式 |
|------|------|----------|
| minio 产物分发体系 | `/Users/zhangyang/spark_ai_project/minio/spark-desktop/artifact-repository/v1/index.json` | 已有 `runtime`/`python-wheelhouse` 非技能产物先例；schema 现成（id/type/name/version/platform/arch/url/sha256/size/archive/dependencies）。新增 `binary` 类型条目。 |
| 产物下载/校验/解压 | `packages/agent-runtime/src/services/skill-registry/tarball-installer.ts` | `downloadFromZipCandidates():403` + `verifyFileSha256():436` + `installFromZip():167` + 进度上报（每 256KB 节流）。照抄结构。 |
| 完整性检测模板 | `apps/desktop/src/main/services/PlaywrightIntegrityService.ts` | `installBrowser():307` 完整链路：检测→决策目录→下载→SHA256→进度→二次校验。`PlaywrightInstallProgress` 协议（state/percent）现成。 |
| 系统二进制检测 | `apps/desktop/src/main/services/ExternalToolService.ts` | `ToolDef`（L24）+ `cliExists():594`（which/where）+ mac/win 路径检测范式。 |
| 工作台挂载范式 | `apps/desktop/src/renderer/design/views/canvas/stage3d/` | `CanvasDirectorStage3DModal` + `director_stage_3d` subtype + 双击/工具栏进入 + 节点 Mini 预览。4 处对称改动。 |
| 画布工具注册 | `canvas.tools.ts`（`CanvasToolDescriptor` L143） | `canvas_insert_generated_image:1320` 是「invoke IPC → 拿路径 → 建节点」最佳范例。 |
| EDL 剪辑逻辑 | `canvasFilmTimeline.ts:6` | 注释明确"真正的视频拼接需后端 ffmpeg，本模块先产出时间线与清单"。本功能填这个坑。 |
| Skill 封装 | `apps/desktop/resources/skills/`（16 个 bundled 范例） | `SKILL.md`（frontmatter + systemPrompt）+ `manifest.json`（requiredTools/parameters）+ 可选 `scripts/`。 |
| 二进制下载脚本 | `apps/desktop/scripts/download-browser.js` | `downloadFile():174`（纯 Node HTTPS + 重定向跟随）+ `extractZip():208`。可作 ffmpeg 下载器参考。 |

### 1.2 关键缺口（本功能要填的坑）

| 缺口 | 证据 | 影响 |
|------|------|------|
| 视频资产无缩略图 | `canvas.api.ts:5256` 视频类型 `thumbnailUrl: null`；`:3307` 把视频 url 当 thumbnail（img 加载失败） | `CanvasAssetThumbnail.tsx` 只能显示 Play 占位图标 |
| 无视频时长/元数据探测 | 主进程 IPC 里无 `probe/ffprobe/video-duration` 通道 | 视频节点缺少 durationMs（除 AI 产物透传外） |
| 无 ffmpeg 执行能力 | 全仓 `ffmpeg` 仅 `canvasFilmTimeline.ts:6` 一处注释 | 任何视频本地处理都做不了 |
| EDL 拼接未落地 | `canvasFilmTimeline.ts` 只产出清单 | 剪辑工作流无法成片 |
| minio 无二进制产物下载实现 | `installCatalogArtifact():742` 硬检查 `type !== 'skill'` | ffmpeg 包无法走现有链路下载 |

### 1.3 业界方案比对结论

| 方案 | 评价 | 采用? |
|------|------|-------|
| 纯 ffmpeg `select='gt(scene,0.3)'` | 原生支持场景突变检测 + I帧提取 + 均匀采样，无需 AI | ✅ 采用 |
| fluent-ffmpeg（Node 封装） | [2025 已归档](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324)，有可靠性问题 | ❌ 不用 |
| PySceneDetect（Python+OpenCV） | 更精确但引入 Python 依赖、慢，对 Electron 是负担 | ❌ 不用 |
| ffmpeg.wasm | WASM 性能差，用于浏览器场景，桌面应用用原生更优 | ❌ 不用 |
| node-av v3（原生 V8 绑定） | 新项目，生态不成熟 | ❌ 不用（观察） |
| npm ffmpeg-static / @ffmpeg-installer | 安装时拉二进制，universal 构建有 arch bug | ❌ 不打进 app；可作市场包构建工具 |

**关键 ffmpeg 滤镜速查**：

| 能力 | 滤镜/参数 |
|------|----------|
| 场景突变帧 | `select='gt(scene\,0.3)',showinfo`（阈值 0~1，0.3~0.4 通用） |
| I帧(关键帧) | `select='eq(pict_type\,I)'` |
| 均匀采样 | `fps=1/{interval}` 或 `thumbnail=300` |
| 无损快切 | `-ss S -i in -to E -c copy` |
| 精确切 | `-ss S -i in -to E -c:v libx264` |
| 合并 | `concat` demuxer（同源）/ `concat` filter（异源重编码） |
| 变速 | `setpts=1/{f}*PTS` + `atempo`（0.5~2 串接） |
| GIF 高质量 | `palettegen` + `paletteuse` 两 pass |

---

## 2. 总体架构

```
┌─ 渲染进程 (画布) ──────────────────────────────────────────────┐
│  视频节点 (subtype: 'director_video')                          │
│     │ 双击 / 底部工具栏「视频工作台」按钮                       │
│     ▼                                                           │
│  CanvasVideoWorkbenchModal (仿 stage3d 全屏 Modal)             │
│     ├─ 视频预览 + 时间线 (复用 canvasFilmTimeline)             │
│     ├─ 关键帧面板 (自动提取/手动标记/缩略图墙)                 │
│     ├─ 剪辑工具区 (裁剪/合并/分割/转码/画面处理)              │
│     └─ 产物区 → 回填为新画布节点                               │
│                                                                │
│  Agent 画布工具 (canvas.tools.ts):                            │
│     canvas_video_probe / canvas_extract_keyframes /           │
│     canvas_video_trim / canvas_video_concat /                 │
│     canvas_video_transcode / canvas_video_process             │
│     └─ window.spark.invoke('ffmpeg:xxx', ...) ────────┐       │
└──────────────────────────────────────────────────────────┼───────┘
                                                           │ IPC
┌─ 主进程 ──────────────────────────────────────────────────▼───────┐
│  FfmpegIntegrityService ── 检测/下载 ffmpeg 二进制               │
│     优先级: {userData}/ffmpeg → 系统 PATH → 引导下载            │
│                                                                  │
│  FfmpegRunner ── spawn 薄封装 (不依赖第三方库)                   │
│     ├─ 命令构造器 (probe/frames/trim/concat/transcode/effects)  │
│     ├─ stderr 进度解析 + 超时 + 并发上限                         │
│     └─ 产物落盘 {userData}/.spark-artifacts/media/              │
│                                                                  │
│  SkillRegistryService.installBinaryArtifact() (新增)            │
│     └─ 从 minio 拉 ffmpeg 包 → 解压到 {userData}/ffmpeg/        │
└──────────────────────────────────────────────────────────────────┘
        ▲
        │ HTTPS (SHA256 校验)
┌─ minio 仓库 ────────────────────────────────────────────────────┐
│  artifact-repository/v1/                                        │
│     ├─ index.json (新增 type:'binary' ffmpeg ×4 平台条目)       │
│     └─ binaries/ffmpeg/ffmpeg-7.x-{plat}-{arch}.zip            │
└──────────────────────────────────────────────────────────────────┘
```

**双路径覆盖**：
- **可视化路径**：用户在画布工作台手动操作（适合精细控制、交互式抽帧标记）。
- **Agent 自动化路径**：通过 Skill + 画布工具，Agent 自动完成视频处理（适合批量、流水线）。

---

## 3. ffmpeg 二进制管理子系统

### 3.1 跨平台二进制来源

| 平台/架构 | 推荐源 | 产物 | 备注 |
|-----------|--------|------|------|
| darwin-arm64 | [evermeet.cx](https://evermeet.cx/ffmpeg/) | ffmpeg + ffprobe | M1/M2/M3，需 arm64 原生构建 |
| darwin-x64 | evermeet.cx | ffmpeg + ffprobe | Intel Mac + universal 构建兜底 |
| win32-x64 | [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) `ffmpeg-release-essentials.zip` | ffmpeg.exe + ffprobe.exe | 含 DLL，zip 内有 `bin/` 子目录需规整 |
| linux-x64 | [johnvansickle.com](https://johnvansickle.com/ffmpeg/) `ffmpeg-release-amd64-static.tar.xz` | ffmpeg + ffprobe | 静态构建，无依赖 |

**关键细节**：
- 必须打包 **ffprobe**（探时长/元数据/关键帧时间戳要用），不能只 ffmpeg。
- Windows gyan.dev essentials 包含 ffprobe，但 zip 内有 `bin/` 子目录，解压时要处理路径规整（复用 `resolveArtifactRoot` 逻辑）。
- universal Mac 构建有 [已知 arch bug](https://github.com/electron/universal/issues/106)，本方案按需下载对应架构，规避此问题。
- 每个包做 SHA256（写入 index.json），下载后强制校验（复用 `tarball-installer.ts:436 verifyFileSha256`）。

### 3.2 存储与检测（三级回退，仿 PlaywrightEnvironment）

```
检测优先级 (resolveFfmpegPath):
  1. {userData}/ffmpeg/{plat}-{arch}/ffmpeg(.exe)   ← 我们下载的 (source: 'managed')
  2. 系统 PATH (which/where ffmpeg)                 ← 用户自己装的 (source: 'system')
  3. → 返回 null，触发"引导下载"                      (source: 'none')

存储约定 (dev & prod 统一):
  {userData}/ffmpeg/{plat}-{arch}/
    ├─ ffmpeg | ffmpeg.exe
    └─ ffprobe | ffprobe.exe

注: 不打包进 electron-builder extraResources，不占安装包体积。
    dev/prod 行为一致，便于开发调试。
```

**平台/arch 判定**（仿 `ExternalToolService.ts:19-20` + `UpdateService.ts:277-295`）：
```typescript
const platform = process.platform;  // 'darwin' | 'win32' | 'linux'
const arch = process.arch;          // 'arm64' | 'x64'
const isWin = platform === 'win32';
const exeName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
```

### 3.3 主进程服务：`FfmpegIntegrityService.ts`

**新建** `apps/desktop/src/main/services/FfmpegIntegrityService.ts`，照搬 `PlaywrightIntegrityService.ts`（376 行）结构：

```typescript
// ═══ 状态契约 (仿 PlaywrightIntegrityState L34-42) ═══
interface FfmpegIntegrityState {
  ffmpegReady: boolean;
  ffmpegSource: 'managed' | 'system' | 'none';
  ffmpegVersion: string | null;     // 从 `ffmpeg -version` 首行解析
  ffprobeReady: boolean;
  binaryPath: string | null;        // ffmpeg 可执行文件绝对路径
  lastError: string | null;
}

// 模块级缓存 (仿 PlaywrightIntegrityService L44 cachedState)
let cachedState: FfmpegIntegrityState | null = null;

// ═══ 检测: detectIntegrity() ═══
//   1. resolveManagedPath() → existsSync({userData}/ffmpeg/{plat}-{arch}/ffmpeg) → 读版本
//   2. detectSystemFfmpeg() → which('ffmpeg') + `ffmpeg -version` 解析版本
//   3. 组合状态，缓存结果

// 版本解析正则 (参考 ShellEnvironmentService.ts versionRegex 模式):
//   `ffmpeg version 7.0.2 ...` → /^ffmpeg version (\S+)/

// ═══ 下载: installFfmpeg(onProgress) ═══
//   1. 定位当前 platform/arch
//   2. artifactId = `binary.ffmpeg-${version}.${platform}-${arch}`
//   3. 调 SkillRegistryService.installBinaryArtifact(artifactId, {onProgress})
//      (走 minio，复用 downloadFromZipCandidates + verifyFileSha256 + 进度)
//   4. 解压到 {userData}/ffmpeg/{plat}-{arch}/
//   5. chmod +x (mac/linux，仿 installBinaryArtifact 落盘后处理)
//   6. 二次校验 detectIntegrity() → 确认 ffmpegSource === 'managed'
```

**对外导出**（仿 `PlaywrightIntegrityService` 的导出风格）：
- `detectFfmpegIntegrity(): Promise<FfmpegIntegrityState>`
- `installFfmpeg(onProgress): Promise<{success: boolean; message?: string}>`
- `getFfmpegStatus(): FfmpegIntegrityState | null`
- `resolveFfmpegBin(): Promise<{ffmpeg: string; ffprobe: string} | null>`（供 FfmpegRunner 用）

### 3.4 启动自检接入

在 `apps/desktop/src/main/index.ts` 三段延迟自检（L702 SDK 5s / L712 env 3s / L721 playwright 6s）后加第四段（仿 L702-710）：

```typescript
// L752 附近新增
setTimeout(async () => {
  try {
    const result = await detectFfmpegIntegrity();
    sendToMainWindow('stream:ffmpeg:status', result);
  } catch (err) {
    // 静默失败，不阻塞启动
  }
}, 8_000);  // 排在 playwright 6s 之后
```

---

## 4. minio 仓库扩展（type: 'binary'）

### 4.1 index.json 新增条目（4 条，每平台一条）

```json
{
  "id": "binary.ffmpeg-7.0.2.darwin-arm64",
  "type": "binary",
  "name": "FFmpeg 7.0.2 (macOS Apple Silicon)",
  "version": "7.0.2",
  "platform": "darwin",
  "arch": "arm64",
  "url": "binaries/ffmpeg/ffmpeg-7.0.2-darwin-arm64.zip",
  "sha256": "<下载后计算填入>",
  "size": <字节数>,
  "archive": { "format": "zip" },
  "notes": "含 ffmpeg 与 ffprobe，用于画布视频处理工作台"
}
```

四个 id：`binary.ffmpeg-7.0.2.{darwin-arm64, darwin-x64, win32-x64, linux-x64}`。

URL 物理路径：`/Users/zhangyang/spark_ai_project/minio/spark-desktop/artifact-repository/v1/binaries/ffmpeg/`。

### 4.2 代码侧扩展（3 处改动）

**① 扩展 artifact type 联合类型**

文件：`packages/agent-runtime/src/services/skill-registry/artifact-manifest.ts:12`

```typescript
// 现有: type: 'skill' | 'runtime' | 'python-wheelhouse' | 'npm-store' | 'archive'
// 改为: type: 'skill' | 'runtime' | 'python-wheelhouse' | 'npm-store' | 'archive' | 'binary'
```

**② 新增 `installBinaryArtifact()` 方法**

文件：`packages/agent-runtime/src/services/skill-registry/index.ts`（仿现有 `installCatalogArtifact():733`，但去掉 `type !== 'skill'` 硬检查）

```typescript
async installBinaryArtifact(
  artifactId: string,
  opts: { onProgress?: (p: { downloaded: number; total: number }) => void }
): Promise<{ success: boolean; path: string; message?: string }> {
  const manifest = await this.fetchManifest();
  const artifact = manifest.artifacts.find(a => a.id === artifactId);
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
  if (artifact.type !== 'binary') {
    throw new Error(`Not a binary artifact: ${artifactId}`);
  }

  // 落盘到 {userData}/bin/<name>/ 而非 skills/（避免被技能扫描）
  const destDir = path.join(this.binaryDir, artifact.name);
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });

  // 复用现有下载 + SHA256 校验 + 解压
  await this.installer.installFromZip(
    resolveArtifactUrl(manifest, artifact),
    destDir,
    {
      onProgress: opts.onProgress,
      expectedSha256: artifact.sha256,  // 复用 verifyFileSha256
    }
  );

  // 二进制赋可执行权限 (mac/linux)
  if (process.platform !== 'win32') {
    for (const bin of ['ffmpeg', 'ffprobe']) {
      const p = path.join(destDir, bin);
      if (await pathExists(p)) await fs.chmod(p, 0o755);
    }
  }

  return { success: true, path: destDir };
}
```

新增成员 `binaryDir`：构造时设为 `{userData}/bin/`（与 `userSkillsDir` 同级，仿其传入方式 `ipc/index.ts:1414`）。

**③ 新增 IPC 通道**

仿 `skill:install-catalog:5505`，在 `apps/desktop/src/main/ipc/index.ts` 注册：

- `binary:install` → `installBinaryArtifact(artifactId)` + 进度推送 `stream:binary:install-progress`
- `binary:list` → 列出可用 binary artifacts（过滤 type==='binary'）

### 4.3 minio 物理操作（开发者准备，用户上传）

**开发者（我）做**：
1. 下载四平台 ffmpeg 二进制
2. 规整 zip 结构（确保解压后根目录直接是 ffmpeg/ffprobe，或 archive 指定子目录）
3. 计算每个 zip 的 SHA256
4. 放到 `/Users/zhangyang/spark_ai_project/minio/spark-desktop/artifact-repository/v1/binaries/ffmpeg/`
5. 更新 `index.json` 加 4 条记录

**用户（你）做**：把 minio 目录同步到线上服务器。

---

## 5. 主进程 ffmpeg 执行层：`FfmpegRunner.ts`

**新建** `apps/desktop/src/main/services/FfmpegRunner.ts`。纯裸 spawn 薄封装，不依赖任何第三方库（fluent-ffmpeg 已归档）。

### 5.1 核心执行器

```typescript
interface RunOpts {
  timeoutMs?: number;       // 默认 180_000 (3分钟)
  onProgress?: (p: FfmpegProgress) => void;
  signal?: AbortSignal;     // 支持取消
}
interface FfmpegProgress {
  percent: number;          // 0~100
  frame: number;
  fps: number;
  currentTimeSec: number;
}
interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

class FfmpegRunner {
  constructor(private resolveBin: () => Promise<{ffmpeg: string; ffprobe: string}>)

  // 基础执行器 (所有命令复用)
  private async exec(args: string[], opts: RunOpts): Promise<RunResult> {
    const bin = await this.resolveBin();
    // spawn(bin.ffmpeg, args, { shell:false, windowsHide:true, env:{...process.env} })
    //   ├─ stderr 聚合 → 正则解析 progress:
    //   │     /frame=\s*(\d+).*fps=\s*([\d.]+).*time=\s*([\d:.]+)/
    //   │     结合 probe 的总时长算 percent
    //   ├─ opts.onProgress({percent, frame, fps, currentTimeSec})
    //   ├─ 超时/取消: SIGTERM → 3s grace → SIGKILL (防僵尸进程)
    //   └─ 并发信号量 (上限 2，防 5 进程硬限导致的资源争抢)
  }
}
```

**关键设计点**：
- `shell: false`：参数走数组传递避免命令注入。现有项目 spawn 用 `shell:true` 是因为跑 pnpm/npm（需要 .cmd 解析）；ffmpeg 直接执行更安全。
- `windowsHide: true`：Windows 下不弹黑窗。
- **超时与取消**：`SIGTERM` 优雅终止 → 3s 宽限期 → `SIGKILL` 强杀（参考社区[僵尸进程问题](https://stackoverflow.com/questions/14204174)）。
- **并发上限 2**：社区报告 Node 有约 5 并发 ffmpeg 硬限，留余量。

### 5.2 命令封装（四类功能）

```typescript
// ════════════════════════════════════════════════════════════
// 1. 关键帧提取 (核心)
// ════════════════════════════════════════════════════════════
interface ExtractKeyframesOpts {
  strategy: 'scene' | 'iframe' | 'uniform';
  threshold?: number;      // scene 模式默认 0.3 (0~1)
  intervalSec?: number;    // uniform 模式用，如 10 表示每10秒一帧
  maxFrames?: number;      // 上限保护，超过退化均匀采样 (默认 20)
  outputDir: string;
  format?: 'jpg' | 'png';  // 默认 jpg
  quality?: number;        // -q:v 2~31，默认 2 (高质量)
}
interface ExtractedKeyframe {
  path: string;            // 产物绝对路径
  timestampSec: number;    // 在视频中的时间戳
  index: number;           // 序号
}
async extractKeyframes(input: string, opts: ExtractKeyframesOpts): Promise<{ frames: ExtractedKeyframe[] }>

// 三种策略的 filter 表达式:
//   scene:  -vf "select='gt(scene\,0.3)',showinfo" -vsync vfr
//   iframe: -vf "select='eq(pict_type\,I)',showinfo" -vsync vfr
//   uniform:-vf "fps=1/{interval}"
//
// 时间戳解析: stderr 里 showinfo 输出 "pts_time:12.345"
//   正则: /pts_time:(\d+\.?\d*)/g
//
// 上限保护逻辑:
//   先 probe 总时长 → 按 strategy 抽帧 → 若结果数 > maxFrames
//   → 退化均匀采样: intervalSec = duration / maxFrames，重跑 uniform

// ════════════════════════════════════════════════════════════
// 2. 视频剪辑
// ════════════════════════════════════════════════════════════
async trim(input: string, opts: { startSec: number; endSec: number; copy?: boolean; outputPath: string }): Promise<{ path: string }>
//   copy=true (默认, 无损快切):
//     ffmpeg -ss {start} -i {input} -to {end} -c copy {output}
//     注意: -ss 在 -i 前是 seek 模式(快但不精确)，copy 模式推荐如此
//   copy=false (精确切, 重编码):
//     ffmpeg -ss {start} -i {input} -to {end} -c:v libx264 -c:a aac {output}

async concat(inputs: string[], outputPath: string): Promise<{ path: string }>
//   先 probe 各段编码是否一致:
//     一致 → concat demuxer (无损快):
//       ffmpeg -f concat -safe 0 -i list.txt -c copy {output}
//       (list.txt 内容: "file '/abs/path/seg1.mp4'\nfile '/abs/path/seg2.mp4'")
//     不一致 → concat filter (重编码):
//       ffmpeg -i seg1 -i seg2 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1" {output}

async segment(input: string, opts: { segmentSec: number; outputPattern: string }): Promise<{ paths: string[] }>
//   ffmpeg -i {input} -f segment -segment_time {N} -reset_timestamps 1 {outputPattern}
//   outputPattern 如 "seg_%03d.mp4"

// ════════════════════════════════════════════════════════════
// 3. 转码与格式转换
// ════════════════════════════════════════════════════════════
interface TranscodeOpts {
  format?: 'mp4' | 'webm' | 'mov' | 'gif';
  videoCodec?: 'libx264' | 'libx265' | 'libvpx-vp9' | 'copy';
  audioCodec?: 'aac' | 'libopus' | 'copy' | 'none';
  resolution?: { w: number; h: number };
  bitrate?: string;        // 如 '2M'
  crf?: number;            // 18~28，越小质量越高
  fps?: number;
}
async transcode(input: string, opts: TranscodeOpts, outputPath: string): Promise<{ path: string }>

// GIF 特殊处理 (质量优先，两 pass):
//   pass1: ffmpeg -i {input} -vf "fps=15,scale=480:-1,palettegen" palette.png
//   pass2: ffmpeg -i {input} -i palette.png -filter_complex "fps=15,scale=480:-1[x];[x][1:v]paletteuse" {output}.gif

// ════════════════════════════════════════════════════════════
// 4. 画面处理
// ════════════════════════════════════════════════════════════
async adjustSpeed(input: string, factor: number, outputPath: string): Promise<{ path: string }>
//   视频: -filter:v "setpts={1/factor}*PTS"
//   音频: atempo={factor} (范围 0.5~2，超出则串接: atempo=2,atempo=1.5 表示 3x)
//   组合: -filter_complex "[0:v]setpts={1/factor}*PTS[v];[0:a]atempo={chain}[a]"

async reverse(input: string, opts: { audio?: boolean }, outputPath: string): Promise<{ path: string }>
//   -vf reverse (视频倒放)
//   -af areverse (音频倒放，若 opts.audio 且音频短)

async crop(input: string, opts: { w: number; h: number; x: number; y: number }, outputPath: string): Promise<{ path: string }>
//   -filter:v "crop={w}:{h}:{x}:{y}"

async watermark(input: string, logoPath: string, opts: {
  position: 'top-left'|'top-right'|'bottom-left'|'bottom-right'|'center';
  scale?: number;          // 水印相对宽度的比例，如 0.2
}, outputPath: string): Promise<{ path: string }>
//   先处理 logo scale: -i logo -vf "scale=iw*{scale}"
//   overlay 9 宫格:
//     top-left:     10:10
//     top-right:    W-w-10:10
//     bottom-left:  10:H-h-10
//     bottom-right: W-w-10:H-h-10
//     center:       (W-w)/2:(H-h)/2

async burnSubtitle(input: string, srtPath: string, outputPath: string): Promise<{ path: string }>
//   -vf "subtitles='{srtPath}'"  (硬烧字幕)
//   注意: srtPath 在 Windows 需转义反斜杠和冒号

// ════════════════════════════════════════════════════════════
// 基础: 探测
// ════════════════════════════════════════════════════════════
interface VideoProbeInfo {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  bitrate: number;
  hasAudio: boolean;
  fileSize: number;
}
async probe(input: string): Promise<VideoProbeInfo>
//   ffprobe -v quiet -print_format json -show_format -show_streams {input}
//   解析 JSON: format.duration / streams[0].width,height,r_frame_rate,codec_name
//             format.bit_rate / format.size
```

### 5.3 产物存储

所有产物落盘到 `{userData}/.spark-artifacts/media/video-workbench/`（复用现有 `ipc/index.ts:342` 的 `.spark-artifacts/media` 约定路径），文件名 `{uuid}-{timestamp}.{ext}`，避免冲突。产物路径通过 IPC 回渲染端，渲染端用 `safe-file://` 协议（`canvas-safe-file.ts:25 encodeToSafeFileUrl`）编码后建画布节点。

---

## 6. 画布视频工作台（仿 stage3d）

### 6.1 目录结构

```
apps/desktop/src/renderer/design/views/canvas/videoWorkbench/
├─ CanvasVideoWorkbenchModal.tsx     ← 入口全屏 Modal (仿 CanvasDirectorStage3DModal)
├─ VideoWorkbenchTimeline.tsx        ← 时间线 (复用 canvasFilmTimeline 逻辑)
├─ VideoWorkbenchFramePanel.tsx      ← 关键帧面板 (缩略图墙 + 时间戳 + 手动标记)
├─ VideoWorkbenchToolsPanel.tsx      ← 剪辑/转码/画面处理工具区
├─ VideoWorkbenchOutputPanel.tsx     ← 产物预览区
├─ videoWorkbench.types.ts           ← 类型定义
├─ videoWorkbenchState.ts            ← reducer 状态 (仿 canvasOperationWorkbenchState)
└─ videoWorkbench.less
```

> 遵循 AGENTS.md「单文件不超过 3000 行」规范：每个面板组件独立文件，命令构造逻辑放主进程 Runner，渲染端只管 UI 和状态。

### 6.2 节点与挂载（4 处对称改动，完全照 stage3d 范式）

| 改动点 | 文件:行号参考 | 做什么 |
|--------|--------------|--------|
| 节点 subtype + data 类型 | `canvas.types.ts` | 加 `subtype: 'director_video'`，节点 data 加 `videoWorkbench?: VideoWorkbenchData`（仿 stage3d 的 `data.stage3d`） |
| UI state + add/handleEdit 分流 + Modal 挂载 | `CanvasWorkspaceView.tsx` | 仿 `:1814 directorStage3DNodeId`、`:3326 addDirectorStage3D`、`:2969 handleEditNode`、`:7085 Modal 挂载` |
| 工具栏按钮 | `CanvasBottomDock.tsx:160` | 仿「3D 导演台」按钮，加「视频工作台」 |
| 节点 Mini 预览 | `CanvasNode.tsx:151` | 仿 `Stage3DMini`，加 `VideoWorkbenchMini`（视频缩略图 + "双击进入视频工作台"提示） |

### 6.3 工作台数据模型

```typescript
// videoWorkbench.types.ts
interface VideoWorkbenchData {
  sourceVideoAssetId: string;          // 源视频画布资产 ID
  sourceVideoPath: string;             // 源视频绝对路径 (safe-file 解码后)
  probeInfo: VideoProbeInfo;           // ffprobe 结果缓存 (首次打开时探测)
  keyframes: ExtractedKeyframeNode[];  // 已提取的关键帧 (作为画布节点引用)
  extractConfig: KeyframeExtractConfig;
  timeline: FilmTimeline;              // 复用 canvasFilmTimeline 的 EDL 结构
  outputs: WorkbenchOutput[];          // 处理产物列表
  activeTab: 'frames' | 'edit' | 'transcode' | 'effects' | 'output';
}

interface ExtractedKeyframeNode {
  keyframe: ExtractedKeyframe;         // Runner 产物
  canvasNodeId?: string;               // 已回填为画布节点的 ID
}

interface KeyframeExtractConfig {
  strategy: 'scene' | 'iframe' | 'uniform';
  threshold: number;                   // scene 模式
  intervalSec: number;                 // uniform 模式
  maxFrames: number;
}

interface WorkbenchOutput {
  id: string;
  type: 'keyframes' | 'trim' | 'concat' | 'transcode' | 'effect';
  outputPath: string;
  canvasNodeId?: string;               // 回填画布后的节点 ID
  createdAt: number;
  meta?: Record<string, unknown>;      // 各类型的额外信息
}
```

### 6.4 关键交互流程

**流程 A：打开视频工作台并自动提取关键帧**
```
用户拖入/选择视频 → 建 director_video 节点
  → 双击节点 → handleEditNode 分流 → 打开 CanvasVideoWorkbenchModal
  → Modal 打开时:
      1. IPC ffmpeg:probe → 填 probeInfo
      2. 若 keyframes 为空 → 自动用 'scene' 策略提取 (默认 threshold 0.3, maxFrames 20)
      3. 提取完成 → 缩略图墙展示 → 用户可点"回填画布"生成图像节点
```

**流程 B：手动标记时间点提取**
```
时间线上播放/拖动 → 用户在特定时间点点击"标记"
  → 标记点加入待提取列表
  → 点"批量提取" → IPC ffmpeg:extract-frames-at-times
  → 产物加入 keyframes
```

**流程 C：剪辑后回填画布**
```
剪辑工具区: 设置起止时间 → 点"裁剪"
  → IPC ffmpeg:trim → 产物落盘
  → 加入 outputs → 用户点"加入画布" → 建视频节点 + 连线(源→产物)
```

### 6.5 顺手修复视频缩略图缺口

视频上传/生成后，主进程自动用 ffprobe + 单帧提取生成缩略图，回填 `asset.thumbnailUrl`：

- **修复点 1**：`canvas.api.ts:5256`（AI 产物视频）—— 不再赋 null，改为调 IPC 生成缩略图
- **修复点 2**：`canvas.api.ts:3307`（拖入视频）—— 不再把视频 url 当 thumbnail
- **生成方式**：`ffmpeg -ss 1 -i {input} -frames:v 1 -q:v 2 {thumbPath}`（取第 1 秒一帧）
- **兜底**：`CanvasAssetThumbnail.tsx:60` 的 Play 占位图标保留（ffmpeg 未就绪时回退）

---

## 7. IPC 协议层

### 7.1 新增类型（仿 Playwright L3572-3639）

文件：`packages/protocol/src/ipc/index.ts`

```typescript
// L3572 附近新增 FFmpeg 类型块
interface FfmpegStatusRequest {}
interface FfmpegStatusResponse {
  ffmpegReady: boolean;
  ffmpegSource: 'managed' | 'system' | 'none';
  ffmpegVersion: string | null;
  ffprobeReady: boolean;
  binaryPath: string | null;
  lastError: string | null;
}
interface FfmpegInstallRequest {
  artifactId?: string;  // 可选，默认按当前平台选
}
interface FfmpegInstallResponse {
  success: boolean;
  message?: string;
}
interface FfmpegInstallProgress {
  state: 'starting' | 'downloading' | 'installing' | 'verifying' | 'done' | 'error';
  percent: number;      // 0~100
  logLine?: string;
}

// 视频处理操作 (通用 invoke + stream 进度)
interface VideoProcessRequest {
  operation: 'probe' | 'extractKeyframes' | 'trim' | 'concat' | 'segment'
           | 'transcode' | 'adjustSpeed' | 'reverse' | 'crop' | 'watermark' | 'burnSubtitle';
  input: string;        // 源视频路径
  params: Record<string, unknown>;  // 各操作的参数
  requestId: string;
}
interface VideoProcessResponse {
  success: boolean;
  result?: unknown;     // 各操作的结果 (probe 信息 / 帧列表 / 产物路径)
  error?: string;
}
interface VideoProcessProgress {
  requestId: string;
  percent: number;
  stage: string;
}
```

### 7.2 新增 IPC 通道

| 通道 | 方向 | 用途 |
|------|------|------|
| `ffmpeg:status` | invoke | 查询 ffmpeg 检测状态 |
| `ffmpeg:install` | invoke | 触发下载安装 |
| `stream:ffmpeg:status` | push | 启动自检结果推送 |
| `stream:ffmpeg:install-progress` | push | 下载进度 |
| `video:probe` | invoke | 探测视频元数据 |
| `video:process` | invoke | 执行视频处理操作 |
| `stream:video:process-progress` | push | 处理进度 |
| `binary:install` | invoke | 通用二进制产物安装 |
| `stream:binary:install-progress` | push | 通用二进制下载进度 |

注册位置仿现有：
- 类型：`packages/protocol/src/ipc/index.ts` L5262/5372/5613 附近
- handler：`apps/desktop/src/main/ipc/index.ts` L7125 附近（紧跟 playwright handler）
- schema：`packages/protocol/src/schemas/index.ts` L823 附近

---

## 8. Agent 画布工具注册

文件：`apps/desktop/src/renderer/design/views/canvas/canvas.tools.ts`

命名遵循现有 `canvas_<verb>_<noun>` 约定，handler 调主进程 IPC。参考最接近的范例 `canvas_insert_generated_image:1320`（invoke IPC → 拿路径 → 建节点）。

| 工具名 | 参数 | 用途 | 只读? |
|--------|------|------|-------|
| `canvas_video_probe` | `{assetId}` | 探测视频元数据，返回时长/分辨率/编码 | ✅ 只读 |
| `canvas_extract_keyframes` | `{assetId, strategy, threshold?, maxFrames?, intervalSec?}` | 提取关键帧，生成图像节点回填画布 | ❌ 写（建节点） |
| `canvas_video_trim` | `{assetId, startSec, endSec, copy?}` | 裁剪片段，生成视频节点 | ❌ 写 |
| `canvas_video_concat` | `{assetIds[]}` | 合并多视频 | ❌ 写 |
| `canvas_video_transcode` | `{assetId, format, codec?, resolution?}` | 转码/转 GIF | ❌ 写 |
| `canvas_video_process` | `{assetId, effect, params}` | 画面处理(变速/反转/裁剪/水印/字幕) | ❌ 写 |

只读工具（`canvas_video_probe`）加进 `canvas-tool-host.ts:29` 的 `READONLY_TOOL_NAMES`，可并行执行；写工具按 projectId 串行排队。

---

## 9. Skill 封装：video-workflow

### 9.1 bundled skill（跟 app 走）

目录：`apps/desktop/resources/skills/video-workflow/`

```
video-workflow/
├─ SKILL.md          ← 触发词 + ffmpeg 命令模板 + 工作流指引
├─ manifest.json     ← requiredTools:["Bash"], parameters:[ffmpegPath]
└─ references/
   └─ ffmpeg-cookbook.md   ← 常用命令速查 (供 agent 渐进式披露)
```

**SKILL.md frontmatter**（参考 `commit/SKILL.md:1-8`，解析器 `local-skill-importer.ts:251-264`，简单 KV 不支持嵌套）：
```yaml
---
name: video-workflow
description: "视频处理工作流：调用 ffmpeg 完成转码、剪辑、提取帧、合并、变速、加水印、烧字幕等任务。当用户提到视频处理、转码、剪辑、抽帧、合并、变速、加水印、烧字幕、提取关键帧时加载本技能。"
version: 1.0.0
author: Spark AI
category: utility
tags: [video, ffmpeg, 转码, 剪辑, 抽帧, multimedia]
---
```

**manifest.json**（参考 `commit/manifest.json`，类型 `local-skill-importer.ts:178-192`）：
```json
{
  "id": "builtin:video-workflow",
  "category": "utility",
  "requiredTools": ["Bash"],
  "parameters": [
    {
      "name": "ffmpegPath",
      "type": "string",
      "label": "FFmpeg 路径",
      "description": "ffmpeg 可执行文件路径，留空则用系统 PATH 或 Spark 管理的 ffmpeg",
      "required": false
    }
  ]
}
```

**systemPrompt 正文要点**：
- 触发场景说明（何时用画布工具 vs 何时直接 ffmpeg 命令）
- ffmpeg 可用性前置检查（`ffmpeg -version`，若不可用提示用户在「设置-完整性」下载）
- 各类操作的命令模板（抽帧/裁剪/合并/转码/变速/水印/字幕）
- `{{ffmpegPath}}` 参数替换（`types.ts:80-98` 的占位符机制）
- 输出规范（产物路径、回填画布的方式）

### 9.2 minio 市场发布（可选，双路径）

同时作为 `skill.video-workflow` 发布到 minio 精选推荐，让未随 app 安装的用户也能从技能市场装。打包为 zip（`archive: {format:'zip', skillRoot:'.'}`），加入 index.json artifacts[]。

---

## 10. 完整性检测接入

### 10.1 协议层新增

仿 Playwright 协议（`packages/protocol/src/ipc/index.ts` L3572-3639 类型、L5372 通道、L5617/5619 流）：
- `FFmpegStatusRequest/Response`、`FFmpegInstallRequest/Response`、`FFmpegInstallProgress`
- 通道：`ffmpeg:status` / `ffmpeg:install`
- 流：`stream:ffmpeg:status` / `stream:ffmpeg:install-progress`

### 10.2 主进程 handler

仿 `apps/desktop/src/main/ipc/index.ts:7127-7209` Playwright handler 块：
- `ffmpeg:status` → `detectFfmpegIntegrity()`
- `ffmpeg:install` → `installFfmpeg(onProgress)`，进度解析 + 推送 `stream:ffmpeg:install-progress`

### 10.3 设置页 UI

在 `SettingsView.tsx` 的 `IntegritySection`（L5162-5503）新增 ffmpeg 卡片，结构仿现有 Playwright 卡片（独立组件 `PlaywrightStatusCard.tsx` 341 行）：

**新建** `apps/desktop/src/renderer/design/views/FfmpegStatusCard.tsx`：
- 状态徽章：✅ 就绪 (managed/system) / ⚠️ 未安装
- 「下载 FFmpeg」按钮 → `invoke('ffmpeg:install')`
- 进度条订阅 `stream:ffmpeg:install-progress`
- 显示版本号和来源（managed/system）
- 缺失时显示醒目提示

在 IntegritySection 渲染处（L5374 附近）插入 `<FfmpegStatusCard />`。

---

## 11. 实施阶段拆分

每期可独立验证、独立提交。

### P1 — 基础设施（ffmpeg 二进制管理 + Runner 核心）

| 任务 | 产出 | 验证 |
|------|------|------|
| 准备四平台 ffmpeg zip 放 minio + 更新 index.json | binaries/ffmpeg/*.zip + 4 条 artifact | SHA256 校验通过 |
| 扩展 artifact type 'binary' + installBinaryArtifact() | skill-registry 代码改动 | 单元测试：能从 minio 拉包解压 |
| FfmpegIntegrityService（检测 + 下载） | 新服务文件 | 检测能区分 managed/system/none |
| FfmpegRunner 核心（exec + probe + extractKeyframes） | 新服务文件 | 命令行手动测：能 probe + 抽帧 |
| IPC: ffmpeg:status/install + video:probe/process | 协议 + handler | 渲染端 invoke 能拿到结果 |
| 完整性卡片 UI | FfmpegStatusCard.tsx | 设置页能看状态 + 下载 |
| 启动自检接入 | main/index.ts | 启动后 stream:ffmpeg:status 推送 |

**P1 完成标志**：用户能在设置-完整性下载 ffmpeg，画布工具能 probe 视频和抽帧（通过 IPC 手动触发）。

### P2 — 画布集成（工作台 + 关键帧面板 + 缩略图修复）

| 任务 | 产出 | 验证 |
|------|------|------|
| 视频工作台 Modal + 状态机 | videoWorkbench/ 目录 | 双击视频节点能打开工作台 |
| 关键帧面板（自动 + 手动标记） | VideoWorkbenchFramePanel | 能抽帧 + 缩略图墙展示 + 回填画布 |
| 时间线（复用 canvasFilmTimeline） | VideoWorkbenchTimeline | 能播放/拖动/标记时间点 |
| 节点 subtype + 挂载 4 处改动 | canvas.types/WorkspaceView/BottomDock/Node | 工具栏有入口 + 节点 Mini 预览 |
| 视频缩略图缺口修复 | canvas.api.ts 改动 | 视频节点有缩略图（非 Play 占位） |
| 画布工具注册（probe + extractKeyframes） | canvas.tools.ts | Agent 能调用 |

**P2 完成标志**：完整的「上传视频→打开工作台→抽关键帧→回填画布」可视化闭环。

### P3 — 剪辑能力（裁剪/合并/分割/转码）

| 任务 | 产出 | 验证 |
|------|------|------|
| Runner 扩展 trim/concat/segment/transcode/GIF | FfmpegRunner 方法 | 命令行测各类操作 |
| 剪辑工具区 UI | VideoWorkbenchToolsPanel | 工作台能裁剪/合并/转码 |
| 对接 canvasFilmTimeline EDL（成片拼接落地） | timeline 逻辑 | EDL 清单能导出成片 |
| 画布工具注册（trim/concat/transcode） | canvas.tools.ts | Agent 能调用 |

**P3 完成标志**：完整视频剪辑工作台可用。

### P4 — 画面处理 + Skill 发布

| 任务 | 产出 | 验证 |
|------|------|------|
| Runner 扩展 adjustSpeed/reverse/crop/watermark/burnSubtitle | FfmpegRunner 方法 | 各滤镜命令测通 |
| 画面处理 UI | VideoWorkbenchToolsPanel effects tab | 工作台能变速/反转/裁剪/水印/字幕 |
| 画布工具注册（video_process） | canvas.tools.ts | Agent 能调用 |
| video-workflow Skill（bundled + minio） | resources/skills/video-workflow/ + index.json | Agent 命中触发词能加载 |

**P4 完成标志**：全功能 + Agent 自动化双路径覆盖。

---

## 12. 风险与对策

| 风险 | 对策 |
|------|------|
| ffmpeg 下载失败（网络） | minio 作为主源 + `fallbackUrls` 字段（可配 CDN 镜像）+ curl/powershell 兜底（复用 `tarball-installer.ts:327`） |
| Windows zip 路径结构不一致（bin/ 子目录） | 下载后探测结构，`resolveArtifactRoot` 兼容（已有逻辑） |
| 抽帧数量爆炸（长视频场景多） | `maxFrames` 上限保护，超过退化均匀采样 |
| 并发 ffmpeg 进程过多 | Runner 信号量上限 2 + 画布工具串行队列（写工具复用 `canvas-tool-host` 机制） |
| ffmpeg 执行超时/僵尸 | `SIGTERM → 3s → SIGKILL` + `timeoutMs` 默认 3 分钟 |
| 渲染端大视频内存占用 | 主进程处理，渲染端只拿产物路径（不 buffer 视频流） |
| 用户系统已有旧版 ffmpeg | managed 优先于 system，版本不匹配时提示但不强制 |

---

## 13. 关键文件清单（实施时参照）

**新建文件**：
- `apps/desktop/src/main/services/FfmpegIntegrityService.ts`（仿 PlaywrightIntegrityService）
- `apps/desktop/src/main/services/FfmpegRunner.ts`（spawn 薄封装 + 命令构造器）
- `apps/desktop/src/renderer/design/views/canvas/videoWorkbench/CanvasVideoWorkbenchModal.tsx`
- `apps/desktop/src/renderer/design/views/canvas/videoWorkbench/VideoWorkbenchFramePanel.tsx`
- `apps/desktop/src/renderer/design/views/canvas/videoWorkbench/VideoWorkbenchTimeline.tsx`
- `apps/desktop/src/renderer/design/views/canvas/videoWorkbench/VideoWorkbenchToolsPanel.tsx`
- `apps/desktop/src/renderer/design/views/canvas/videoWorkbench/VideoWorkbenchOutputPanel.tsx`
- `apps/desktop/src/renderer/design/views/canvas/videoWorkbench/videoWorkbench.types.ts`
- `apps/desktop/src/renderer/design/views/canvas/videoWorkbench/videoWorkbenchState.ts`
- `apps/desktop/src/renderer/design/views/canvas/videoWorkbench/videoWorkbench.less`
- `apps/desktop/src/renderer/design/views/FfmpegStatusCard.tsx`
- `apps/desktop/resources/skills/video-workflow/SKILL.md`
- `apps/desktop/resources/skills/video-workflow/manifest.json`
- `apps/desktop/resources/skills/video-workflow/references/ffmpeg-cookbook.md`

**修改文件**：
- `packages/agent-runtime/src/services/skill-registry/artifact-manifest.ts:12`（type 联合加 'binary'）
- `packages/agent-runtime/src/services/skill-registry/index.ts`（新增 installBinaryArtifact + binaryDir）
- `packages/protocol/src/ipc/index.ts`（类型 + 通道 + 流）
- `packages/protocol/src/schemas/index.ts`（zod schema）
- `apps/desktop/src/main/ipc/index.ts`（handler 注册）
- `apps/desktop/src/main/index.ts:752`（启动自检）
- `apps/desktop/src/renderer/design/views/canvas/canvas.types.ts`（subtype + data）
- `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`（4 处对称改动）
- `apps/desktop/src/renderer/design/views/canvas/CanvasBottomDock.tsx:160`（工具栏按钮）
- `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx:151`（Mini 预览）
- `apps/desktop/src/renderer/design/views/canvas/canvas.tools.ts`（6 个画布工具）
- `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts:5256,3307`（缩略图修复）
- `apps/desktop/src/renderer/design/views/SettingsView.tsx:5162`（插入 FfmpegStatusCard）

**minio 仓库**：
- `/Users/zhangyang/spark_ai_project/minio/spark-desktop/artifact-repository/v1/index.json`（+4 binary 条目）
- `/Users/zhangyang/spark_ai_project/minio/spark-desktop/artifact-repository/v1/binaries/ffmpeg/*.zip`（四平台包）

---

## 参考资源

**ffmpeg 技术资料**：
- [FFmpeg 官方 filters 文档](https://ffmpeg.org/ffmpeg-filters.html)
- [Extracting I-frames (Keyframes) – Medium](https://medium.com/@publiciscommerce/extracting-i-frames-keyframes-from-a-video-using-ffmpeg-cb7f2ae3add1)
- [bogotobogo: I-frames & Scene Change](https://www.bogotobogo.com/FFMpeg/ffmpeg_thumbnails_select_scene_iframe.php)
- [Scene Change Detection with timecode – StackOverflow](https://stackoverflow.com/questions/35675529/using-ffmpeg-how-to-do-a-scene-change-detection-with-timecode)
- [How to Extract Key Frames – jdhao](https://jdhao.github.io/2021/12/25/ffmpeg-extract-key-frame-video/)

**Node.js 集成**：
- [fluent-ffmpeg 归档公告 Issue #1324](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324)
- [Transloadit: 流式视频处理](https://transloadit.com/devtips/stream-video-processing-with-node-js-and-ffmpeg/)
- [David Walsh: child_process 错误处理](https://davidwalsh.name/catching-fatal-errors-nodejs-childprocess)
- [Node.js 并发进程限制讨论](https://groups.google.com/g/nodejs/c/XPjrWIAsOgE)

**二进制源**：
- [evermeet FFmpeg (macOS)](https://evermeet.cx/ffmpeg/)
- [gyan.dev FFmpeg builds (Windows)](https://www.gyan.dev/ffmpeg/builds/)
- [johnvansickle FFmpeg static (Linux)](https://johnvansickle.com/ffmpeg/)
- [FFmpeg 官方下载](https://www.ffmpeg.org/download.html)

**Electron 集成参考**：
- [electron/universal arch bug #106](https://github.com/electron/universal/issues/106)
- [How to bundle ffmpeg in Electron – StackOverflow](https://stackoverflow.com/questions/47848621/how-can-i-bundle-ffmpeg-in-an-electron-application)
