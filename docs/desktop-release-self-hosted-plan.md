# 桌面端自建发布与版本治理方案

> 状态: 实施中 | 最后核对: 2026-06-28

把桌面端的发布、分发、自动更新从 GitHub Releases 迁移到「**MinIO 公网桶 + edu-server 元数据 + edu-admin 治理**」三件套，CI 与 admin 手动上传双通道写入，下载链路完全绕开 edu-server，保证国内网络下载速度。

---

## 1. 背景与动机

### 1.1 现状

- **官网**：[apps/website/src/lib/links.ts:2](apps/website/src/lib/links.ts:2) 所有下载链接硬编码为 `https://github.com/alexanderizh/spark-agent/releases`，[apps/website/src/content/downloads.ts](apps/website/src/content/downloads.ts) 四个平台条目都指向同一个 `RELEASES_URL`，没有具体到安装包。
- **CI**：[.github/workflows/publish-desktop-release.yml](.github/workflows/publish-desktop-release.yml) 通过 `electron-builder --publish always` 把产物推到 GitHub Release。
- **桌面端自动更新**：[apps/desktop/electron-builder.yml](apps/desktop/electron-builder.yml) 配置 GitHub provider，[UpdateService.ts](apps/desktop/src/main/services/UpdateService.ts) 直接读 GitHub Release 资产。
- **edu-server**：已有 `service/storage/minio.adapter.ts`、`storage/storage.service.ts`、`upload.controller.ts`，可复用存储抽象。
- **edu-admin**：标准 React 后台，按页面目录组织，新增「桌面版本管理」一页成本低。

### 1.2 痛点

1. **强依赖 GitHub**：海外站点国内访问不稳定，企业网络可能完全屏蔽；
2. **GitHub Actions 出向受限**：CI runner 不一定能稳定连到内网 MinIO，但可以稳定访问公网 edu-server；
3. **下载速度差**：经 edu-server 转发会成为单点带宽瓶颈；
4. **版本治理弱**：没有灰度、回滚、release notes 富文本编辑、强制升级下限等运营能力；
5. **官网链接不准**：手动更新易遗漏，无法跟随版本迭代。

### 1.3 目标

- 桌面端安装包**完全公网直链下载**，不经过 edu-server，无带宽瓶颈；
- **CI 自动发布 + admin 手动上传** 双通道，互为兜底，GitHub 不可达时仍能发版；
- 版本治理（草稿/灰度/上下线/回滚/notes 编辑）集中在 edu-admin；
- 官网下载链接**自动同步**到最新 stable 版本；
- **GitHub Release 作为长期镜像保留**：CI 永久双写 GitHub + MinIO，桌面端 electron-updater 继续走 GitHub 路径不变；自建 MinIO + edu-server 给国内官网下载、admin 治理、灰度提供独立数据源。

### 1.4 非目标

- 不实现自建身份系统/付费墙；
- 不替换 electron-updater（GitHub 路径保留），自建 yml 仅供未来切换/紧急兜底使用；
- 不在桌面端去掉对 GitHub 的跳转（源码、社区 issues、releases 历史均保留 GitHub 链接）。

---

## 2. 总体架构

```
┌───────────────────────────┐
│  GitHub Actions (CI)      │  打包 / 签名 / 公证（沿用现状）
│  electron-builder         │
└────────────┬──────────────┘
             │ mc cp (直传)
             ▼
┌───────────────────────────┐        ┌──────────────────────────────┐
│  MinIO  bucket:           │◀───────┤  edu-admin                   │
│  spark-desktop            │  直传   │  「桌面版本管理」页           │
│  (anonymous read)         │         │   - 拖拽上传                  │
│  ├ stable/<v>/*.dmg/exe   │         │   - 草稿/发布/回滚            │
│  ├ stable/latest-mac.yml  │         │   - release notes Markdown   │
│  └ stable/latest.yml      │         └─────────────┬────────────────┘
└──────────┬────────────────┘                       │
           │ HTTPS 公网直链 / CDN                    │ REST + JWT
           │                                         ▼
           │                              ┌──────────────────────────┐
           │                              │  edu-server              │
           │                              │  desktop-release 模块     │
           │                              │   - 元数据 CRUD          │
           │                              │   - 预签名上传 token     │
           │                              │   - latest*.yml 生成     │
           │                              │   - CI register endpoint │
           │                              └─────────────┬────────────┘
           │                                            │ REST
           ▼                                            ▼
┌──────────────────────┐                ┌──────────────────────────────┐
│  桌面端              │                │  官网                         │
│  electron-updater    │                │  HeroDownloadButton           │
│  GET latest*.yml ────┼── 拿 URL ─────▶│  DownloadPanel                │
│  GET 安装包          │                │  /api/desktop/releases/latest │
└──────────────────────┘                └──────────────────────────────┘
```

**核心约束：edu-server 不出现在下载流量链路上**。它只接收元数据请求、签发预签名上传 URL、生成 `latest*.yml` 上传到 MinIO，下载、自动更新拉取 yml 全部走 MinIO 公网桶（建议前置 CDN）。

---

## 3. 功能需求

### 3.1 角色

| 角色 | 能力 |
|---|---|
| 匿名用户 | 通过官网下载安装包；桌面端通过 electron-updater 获取最新版本 |
| admin（edu-admin 登录） | 手动上传新版本、编辑 release notes、发布/下线、灰度比例、强制升级下限、查看下载统计 |
| CI runner（持 release token） | 注册新版本元数据，触发 latest.yml 重新生成 |

### 3.2 用户故事

#### US-01 普通下载
> 作为一个 Windows 用户，访问官网首页时，下载按钮自动显示「下载 for Windows x64」，点击后直接从 CDN 下载 `.exe`，无需任何跳转。

#### US-02 桌面端自动更新
> 作为已安装用户，桌面端每天检查一次更新；如果有新版且当前用户落在灰度范围内，提示我下载并安装。

#### US-03 CI 自动发布
> 作为开发者，我把 `apps/desktop/package.json` 的 version 改了并合并到 master，CI 自动打包、上传 MinIO、注册 edu-server 元数据并自动置为 latest，官网下载链接和桌面端自动更新源同步生效。

#### US-04 admin 手动发版
> 作为运营，GitHub Actions 挂了或我要发紧急 hotfix，进入 edu-admin →「桌面版本管理」→「新建版本」，拖拽本地打好的安装包上传，填 release notes，点「保存并发布」，官网和桌面端立刻能看到新版。

#### US-05 灰度发布
> 作为运营，我想 1.4.3 先放给 20% 用户。在 admin 把灰度比例设 20%，剩余 80% 的客户端检查更新时仍拿到 1.4.2。观察 24h 没问题后改为 100%。

#### US-06 紧急回滚
> 作为运营，1.4.3 上线后报严重 bug，进入 admin 点「下线 1.4.3」，系统自动把 latest 指针回到 1.4.2，重新生成 `latest*.yml` 推到 MinIO，新的 update check 立刻拿到 1.4.2。

#### US-07 强制升级
> 作为运营，1.4.4 修了一个安全漏洞，把它的「最低支持版本」设为 1.4.4，更老的版本检查更新时收到「必须升级」标记，客户端弹窗禁止跳过。

### 3.3 功能列表

| 编号 | 功能 | 优先级 |
|---|---|---|
| F-01 | MinIO 公网桶布局 + anonymous read policy | P0 |
| F-02 | edu-server `desktop_release` 表与 CRUD 接口 | P0 |
| F-03 | edu-server 预签名上传 token 接口 | P0 |
| F-04 | edu-server `latest*.yml` 生成与推送 | P0 |
| F-05 | CI 通道：mc 上传 + register-release.mjs 注册 | P0 |
| F-06 | admin 通道：列表 + 手动上传抽屉 + 发布/下线 | P0 |
| F-07 | 官网下载接口接入（构建期 + 运行时双拉） | P0 |
| F-08 | 桌面端 electron-builder publish 切 generic provider | P0 |
| F-09 | 桌面端 UpdateService 适配（从读 GitHub 资产改为读 latest.yml） | P0 |
| F-10 | 官网 deploy workflow 在 register-release 成功后自动触发 | P1 |
| F-11 | release notes Markdown 编辑 + 预览 | P1 |
| F-12 | 灰度发布（rollout_percent） | P1 |
| F-13 | 强制升级（min_supported） | P1 |
| F-14 | 下载量 / update check 统计看板 | P2 |
| F-15 | 多 channel 支持（beta / nightly） | P2 |

---

## 4. 数据模型

### 4.1 `desktop_release`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | bigint pk auto | |
| `version` | varchar(32) | 语义化版本，例 `1.4.2` |
| `channel` | varchar(16) | `stable` / `beta` / `nightly`，默认 `stable` |
| `platform` | varchar(16) | `mac` / `win` / `linux` |
| `arch` | varchar(16) | `arm64` / `x64` / `universal` |
| `file_name` | varchar(255) | 上传到 MinIO 的文件名 |
| `file_size` | bigint | 字节 |
| `sha512` | varchar(128) | base64，electron-updater 校验 |
| `object_key` | varchar(512) | MinIO key，例 `stable/1.4.2/Spark-Agent-1.4.2-arm64.dmg` |
| `blockmap_key` | varchar(512) nullable | 对应 `.blockmap` 的 MinIO key |
| `public_url` | varchar(1024) | CDN/MinIO 完整 URL，官网/latest.yml 用 |
| `release_notes` | text | Markdown 源码 |
| `is_published` | boolean | 草稿 vs 已发布 |
| `is_latest` | boolean | 同 `(channel, platform, arch)` 内唯一为 true |
| `rollout_percent` | int (0-100) | 灰度百分比，默认 100 |
| `min_supported` | varchar(32) nullable | 强制升级下限，若客户端 < 此版本必须升 |
| `upload_source` | varchar(16) | `ci` / `manual` |
| `uploaded_by` | varchar(64) nullable | admin user id（manual 时填） |
| `published_at` | timestamp nullable | |
| `created_at` / `updated_at` | timestamp | |

**索引**：`(channel, platform, arch, is_latest)`、`(version, platform, arch)` 唯一约束（防止同版本重复注册同一架构）、`(is_published, channel)`。

### 4.2 `desktop_release_event`（P2，统计用）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | bigint pk | |
| `release_id` | bigint fk | |
| `event_type` | varchar(16) | `update_check` / `download_start` / `download_done` |
| `client_id` | varchar(64) nullable | 桌面端机器码 hash |
| `client_version` | varchar(32) nullable | |
| `client_platform` | varchar(16) nullable | |
| `client_arch` | varchar(16) nullable | |
| `client_ip` | varchar(64) nullable | 入网络日志 / IP 段统计 |
| `created_at` | timestamp | |

---

## 5. 接口设计

### 5.1 公共接口（无鉴权）

#### `GET /api/desktop/releases/latest`

官网渲染下载卡用。

Query：`channel=stable&platform=mac&arch=arm64`

Response 200：
```json
{
  "version": "1.4.2",
  "channel": "stable",
  "platform": "mac",
  "arch": "arm64",
  "fileName": "Spark-Agent-1.4.2-arm64.dmg",
  "fileSize": 187654321,
  "publicUrl": "https://dl.spark-agent.dev/stable/1.4.2/Spark-Agent-1.4.2-arm64.dmg",
  "releaseNotes": "## 1.4.2\n- ...",
  "publishedAt": "2026-06-28T10:00:00.000Z"
}
```

不传 `arch`：返回该平台默认架构（mac 默认 arm64，win 默认 x64）。
不传 `platform`：返回三平台数组。

#### `GET /api/desktop/releases`

公开列表（只返回 `is_published=true`），支持 `channel`、`platform`、分页。

#### `POST /api/desktop/event`（P2）

埋点写 `desktop_release_event`，限频率 + IP 限流。

### 5.2 CI 接口（`X-Release-Token` 鉴权）

#### `POST /api/desktop/releases/ci-register`

```json
{
  "version": "1.4.2",
  "channel": "stable",
  "files": [
    {
      "platform": "mac",
      "arch": "arm64",
      "fileName": "Spark-Agent-1.4.2-arm64.dmg",
      "fileSize": 187654321,
      "sha512": "...",
      "objectKey": "stable/1.4.2/Spark-Agent-1.4.2-arm64.dmg",
      "blockmapKey": "stable/1.4.2/Spark-Agent-1.4.2-arm64.dmg.blockmap"
    },
    { "...": "..." }
  ],
  "releaseNotes": "可选；不传则用默认模板或留空待 admin 编辑",
  "autoPublish": true
}
```

Behavior：
1. 对每个 file 创建 / upsert `desktop_release` 记录（按 `(version, channel, platform, arch)` 唯一）；
2. 若 `autoPublish=true`，立刻把这批记录 `is_published=true` + `is_latest=true`，并把同维度旧记录的 `is_latest` 改为 false；
3. 触发生成 `latest*.yml` 并上传到 MinIO；
4. 返回每条记录的 id 和 `publicUrl`。

#### `POST /api/desktop/releases/refresh-latest-yml`

幂等地重新生成并上传 `latest-mac.yml` / `latest.yml` / `latest-linux.yml`。**所有发布/下线动作完成后都要调用一次**（service 内部直接调，不需要外部触发）。

### 5.3 admin 接口（JWT + admin role）

#### `POST /api/desktop/releases/upload-token`

```json
{ "channel": "stable", "version": "1.4.2",
  "platform": "win", "arch": "x64", "fileName": "Spark-Agent-1.4.2-x64.exe" }
```

Response：
```json
{
  "objectKey": "stable/1.4.2/Spark-Agent-1.4.2-x64.exe",
  "uploadUrl": "https://minio.../spark-desktop/stable/1.4.2/...?X-Amz-Signature=...",
  "method": "PUT",
  "expiresIn": 3600,
  "headers": { "Content-Type": "application/octet-stream" },
  "publicUrl": "https://dl.spark-agent.dev/stable/1.4.2/Spark-Agent-1.4.2-x64.exe"
}
```

> 大文件分片：v1 用单 PUT（electron-builder 产物通常 100-300MB，浏览器 PUT 没问题）；v2 再考虑 MinIO multipart presigned。

#### `POST /api/desktop/releases`

admin 上传完后注册元数据（结构与 ci-register 类似，但 `upload_source=manual`、`uploaded_by` 填当前 admin）。默认 `is_published=false`（草稿）。

#### `PATCH /api/desktop/releases/:id`

更新 `release_notes`、`rollout_percent`、`min_supported`。

#### `POST /api/desktop/releases/:id/publish`

把记录置 `is_published=true` + `is_latest=true`，同维度旧记录 `is_latest=false`，触发 `latest*.yml` 重生。

#### `POST /api/desktop/releases/:id/unpublish`

`is_published=false` + `is_latest=false`；若该记录原本是 latest，把同维度上一条 `is_published=true` 的最新版本置为 latest（按 published_at desc 取第一条），重生 yml。

#### `DELETE /api/desktop/releases/:id`

仅允许删除 `is_published=false` 的草稿；同时清理 MinIO 上的对象（可选硬删 / 软删）。

#### `GET /api/desktop/releases?all=true`

admin 全量列表，包括草稿和已下线。

### 5.4 兼容 electron-updater 的静态文件

**不是接口**，是 MinIO 上的静态文件：

- `spark-desktop/stable/latest-mac.yml`
- `spark-desktop/stable/latest.yml`（Windows）
- `spark-desktop/stable/latest-linux.yml`（v2）

由 edu-server 的 `refresh-latest-yml` 服务生成后通过 minio SDK PUT 到桶里。格式遵循 electron-builder：

```yaml
version: 1.4.2
files:
  - url: Spark-Agent-1.4.2-arm64.dmg
    sha512: <base64>
    size: 187654321
  - url: Spark-Agent-1.4.2-arm64.zip
    sha512: <base64>
    size: 186543210
path: Spark-Agent-1.4.2-arm64.dmg
sha512: <base64>
releaseDate: '2026-06-28T10:11:22.000Z'
```

> 注意 mac 一个 channel 下 arm64 / x64 共用一个 `latest-mac.yml` 时，electron-builder 默认按当前运行架构选 file。本方案延续 electron-builder 现有行为，不自定义客户端架构判断。

---

## 6. MinIO 配置

### 6.1 Bucket

- 名称：`spark-desktop`
- Versioning：开启（防误覆盖）
- Anonymous policy（`s3:GetObject` only）：
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::spark-desktop/*"]
    }]
  }
  ```

### 6.2 服务账号

新建专用 service account：`spark-desktop-writer`，policy 仅允许对 `spark-desktop/*` 的 `PutObject` / `DeleteObject` / `GetObject` / `ListBucket`。
- access/secret 写入 edu-server 配置（不进客户端、不进 CI 仓库 secrets 重复值）；
- CI 用的 access/secret 是另一对，policy 相同但单独可吊销。

### 6.3 CDN / 公网域名

- 推荐挂自有 CDN：`dl.spark-agent.dev` → 回源 MinIO；
- 缓存策略：
  - 安装包（`.dmg/.exe/.blockmap` 等带版本号）：`Cache-Control: public, max-age=31536000, immutable`
  - `latest*.yml`：`Cache-Control: public, max-age=60, must-revalidate`（或 no-cache）

### 6.4 目录布局

```
spark-desktop/
  stable/
    latest-mac.yml
    latest.yml
    latest-linux.yml
    1.4.2/
      Spark-Agent-1.4.2-arm64.dmg
      Spark-Agent-1.4.2-arm64.dmg.blockmap
      Spark-Agent-1.4.2-arm64.zip
      Spark-Agent-1.4.2-x64.dmg
      Spark-Agent-1.4.2-x64.dmg.blockmap
      Spark-Agent-1.4.2-x64.zip
      Spark-Agent-Setup-1.4.2.exe
      Spark-Agent-Setup-1.4.2.exe.blockmap
  beta/
    ...
```

---

## 7. CI 改造

修改 [.github/workflows/publish-desktop-release.yml](.github/workflows/publish-desktop-release.yml)：

### 7.1 改动点

1. `electron-builder` 改 `--publish never`（不再推 GitHub Release，仅本地产物）；
2. 新增 step：用 `mc`（minio client）上传 `apps/desktop/dist/` 全部产物到 `spark-desktop/${CHANNEL}/${VERSION}/`；
3. 新增 step：调用 `node apps/desktop/scripts/register-release.mjs` 把元数据 POST 给 edu-server。

### 7.2 新增 secrets

| Secret | 值 |
|---|---|
| `RELEASE_API_BASE` | `https://api.xxx.com` |
| `RELEASE_API_TOKEN` | edu-server 颁发的长期 release token |
| `MINIO_ENDPOINT` | `https://minio.xxx.com`（或公网 endpoint） |
| `MINIO_ACCESS_KEY` | CI 专用 access key |
| `MINIO_SECRET_KEY` | CI 专用 secret key |
| `MINIO_BUCKET` | `spark-desktop` |
| `RELEASE_PUBLIC_BASE` | `https://dl.spark-agent.dev`（拼 publicUrl 用） |

### 7.3 register-release.mjs 职责

- 扫描 `apps/desktop/dist/` 找当前 matrix 平台/架构对应的安装包、blockmap、yml；
- 计算 sha512（electron-builder 已写在 `latest*.yml` 里可直接读，不需要重算）；
- 拼 publicUrl = `${RELEASE_PUBLIC_BASE}/${CHANNEL}/${VERSION}/${fileName}`；
- 调用 `POST /api/desktop/releases/ci-register`，`autoPublish=true`；
- 失败重试 3 次，最终失败 `exit 1` 让 CI 标红。

> CI 通道不上传 yml？**会上传**。CI 用 mc 把整个 dist 目录 cp 上去，包含 electron-builder 自己生成的 yml；之后 edu-server `refresh-latest-yml` 会基于元数据**重新生成并覆盖**，保证灰度/多版本场景下 yml 是 server 真实视图。

### 7.4 触发官网部署（F-10）

`register-release.mjs` 成功后追加一个 step：

```bash
gh workflow run website-deploy.yml --ref master
```

让官网 SSG 重跑，把最新版本号烤进静态产物（即便 CSR 拉接口失败也有兜底）。

---

## 8. edu-admin 改造

### 8.1 新增页面

`apps/edu-admin/src/pages/desktop-releases/`：

```
desktop-releases/
  index.tsx               // 列表 + 顶部新建按钮
  ReleaseListTable.tsx    // 表格
  UploadDrawer.tsx        // 新建/上传抽屉
  ReleaseDetailDrawer.tsx // 详情/编辑抽屉
  components/
    FileDropzone.tsx      // 拖拽 + sha512 计算 + 直传 MinIO
    Sha512Worker.ts       // Web Worker，分块算 sha512
    ReleaseStatusBadge.tsx
```

### 8.2 列表页字段

| 列 | 说明 |
|---|---|
| Version | `1.4.2` |
| Channel | tag (stable/beta) |
| Platform / Arch | `mac arm64` / `win x64` |
| Status | 草稿 / 已发布 / 已下线 |
| Latest? | 是 / 否 |
| Rollout | `100%` / `20%` |
| Source | CI / Manual |
| Size | `187 MB` |
| Published At | 时间 |
| 操作 | 详情 / 发布 / 下线 / 复制公网 URL |

筛选：channel、platform、status、上传方式、版本搜索。

### 8.3 上传抽屉流程（手动通道关键流程）

1. **Step 1 基本信息**：version（必填，校验 semver）、channel（select）、release notes（Markdown 编辑器，预留 GFM 渲染）；
2. **Step 2 文件**：按平台/架构呈现 6-8 个上传槽位（mac arm64 dmg + blockmap、mac x64 dmg + blockmap、win x64 exe + blockmap、可扩展 linux），每个槽位：
   - 拖入文件 → 立即调 `/upload-token` 拿 presigned URL
   - 浏览器 PUT MinIO，进度条
   - 同时 Web Worker 分块算 sha512（边传边算）
   - 完成后展示 ✓ + size + sha512 前 16 位
3. **Step 3 预览**：展示将生成的 `latest*.yml` 预览，校验 sha512 / size 是否齐全；
4. **Step 4 保存**：「保存为草稿」/「保存并发布」二选一。

### 8.4 详情抽屉

- 编辑 release notes、rollout_percent、min_supported；
- 文件列表（每行：file_name / size / sha512 / 复制 publicUrl 按钮 / 在 MinIO 中打开）；
- 危险区：下线 / 删除草稿。

### 8.5 权限

复用 edu-admin 现有 admin role。可选 P2 加一个 `release-manager` 子角色。

---

## 9. 官网改造

### 9.1 数据获取

把 [apps/website/src/content/downloads.ts](apps/website/src/content/downloads.ts) 改成 hook + 构建期注入：

```ts
// build-time: apps/website/scripts/fetch-downloads.mjs
//   fetch /api/desktop/releases/latest?channel=stable
//   写到 src/content/downloads.generated.json
//   构建失败时回退使用上一次成功结果

// runtime: useDownloads()
//   先用 downloads.generated.json
//   再 fetch /api/desktop/releases/latest 刷新一次
//   失败用 generated 兜底
```

### 9.2 组件改动

- [HeroDownloadButton.tsx](apps/website/src/components/HeroDownloadButton.tsx)：`recommended.href` 改为接口返回的 `publicUrl`；
- [DownloadPanel.tsx](apps/website/src/components/DownloadPanel.tsx)：每行 `href` 换成接口数据，加显示版本号 + 发布时间；
- 历史版本链接保留（指向新的 `/docs/releases` 页或 admin 公开列表），不再指 GitHub Releases。

### 9.3 [links.ts](apps/website/src/lib/links.ts) 改动

- 保留 `GITHUB_URL` 用于「查看源码」按钮；
- 删除/下架 `RELEASES_URL`；
- 新增 `RELEASES_API_BASE = 'https://api.xxx.com'`。

---

## 10. 桌面端改造

### 10.1 electron-builder 配置（保持不变）

[apps/desktop/electron-builder.yml](apps/desktop/electron-builder.yml) 继续：

```yaml
publish:
  - provider: github
    owner: alexanderizh
    repo: spark-agent
    releaseType: release
```

桌面端 electron-updater 仍走 GitHub API，**不切换** generic provider。MinIO 上的 `latest*.yml` 由 server 维护作为未来扩展（admin 提前演练/staging/紧急切换兜底），客户端暂不消费。

### 10.2 UpdateService 改动（保持不变）

[apps/desktop/src/main/services/UpdateService.ts](apps/desktop/src/main/services/UpdateService.ts) 完全不动，仍按现有 GitHub API 拉 release 资产逻辑跑。

桌面端 UI 跳转 GitHub 的入口也全部保留：
- [apps/desktop/src/renderer/App.tsx](apps/desktop/src/renderer/App.tsx) `REPOSITORY_URL`
- [apps/desktop/src/renderer/design/views/SettingsView.tsx](apps/desktop/src/renderer/design/views/SettingsView.tsx) `RELEASES_URL`

### 10.3 灰度 / 强制升级落地位置

由于桌面端不切 generic provider，server 生成的 `latest*.yml` 暂时只供官网下载链接逻辑参考。
- **灰度** rollout_percent：影响官网下载是否暴露最新版（P2 实现）；
- **强制升级** min_supported：通过 admin 推送通知 / 主进程版本号比较实现，不依赖 yml。

---

## 11. 开发任务拆解

### Phase 1 — 后端基建（约 3-4 天）

- [ ] `edu-server`：新增 `entity/desktop-release.entity.ts`、migration；
- [ ] `edu-server`：`service/desktop-release/` 目录：
  - `desktop-release.service.ts`（CRUD + 状态机）
  - `release-storage.service.ts`（封装 MinIO put / presigned URL）
  - `latest-yml.service.ts`（生成 + 上传 yml）
- [ ] `edu-server`：`controller/desktop-release.controller.ts` + `admin/` 子目录（admin 接口）；
- [ ] `edu-server`：`middleware/release-token.middleware.ts`（X-Release-Token 鉴权）；
- [ ] `edu-server`：单元测试 + 集成测试（重点测 `is_latest` 单一性、yml 生成正确）；
- [ ] MinIO：创建 bucket、配 policy、建两套 service account；
- [ ] 域名/CDN：申请 `dl.spark-agent.dev`，回源指向 MinIO endpoint。

**验收**：
- curl 用 CI token 调 `ci-register`，能创建记录、能生成 yml 并上传 MinIO；
- 浏览器直接访问 `https://dl.spark-agent.dev/stable/latest.yml` 能拿到正确 yml；
- electron-updater 在 dev 环境能识别这个 yml。

### Phase 2 — admin UI（约 3-4 天）

- [ ] `edu-admin`：新增页面骨架、路由、菜单项；
- [ ] `services/desktop-release.ts`（API client）；
- [ ] 列表页 + 筛选 + 分页；
- [ ] 上传抽屉：4 步流程 + 浏览器直传 + sha512 Web Worker；
- [ ] 详情抽屉：编辑 / 发布 / 下线 / 删除；
- [ ] e2e 自测：本地打一个安装包，从 admin 整套流程上传 → 发布 → 验证 latest.yml 更新。

**验收**：
- 不开 CI 的情况下，从本地打包 → admin 上传 → 桌面端能收到自动更新通知。

### Phase 3 — CI + 官网（约 2-3 天）

- [ ] `apps/desktop/scripts/register-release.mjs`；
- [ ] `.github/workflows/publish-desktop-release.yml` 改造（删 `--publish always`，加 mc 上传 + register step）；
- [ ] `apps/website/scripts/fetch-downloads.mjs`（构建期拉接口）；
- [ ] [HeroDownloadButton.tsx](apps/website/src/components/HeroDownloadButton.tsx) / [DownloadPanel.tsx](apps/website/src/components/DownloadPanel.tsx) / [downloads.ts](apps/website/src/content/downloads.ts) 改造；
- [ ] CI 触发官网 deploy；
- [ ] [github-release-auto-update.md](docs/github-release-auto-update.md) 标为 `已废弃`，新文档替代。

**验收**：
- 在测试分支改 version、合 master，全链路自动跑通：MinIO 有产物、edu-server 有记录、官网链接自动更新、桌面端能收到更新。

### Phase 4 — 治理增强（按需排期）

- [ ] release notes Markdown 编辑 + 预览（lobehub Markdown 组件）；
- [ ] 灰度 rollout_percent：server 在生成 yml 时基于 client_id hash 判定；
- [ ] 强制升级 min_supported：yml 增加自定义字段 + UpdateService 弹窗禁跳过；
- [ ] `desktop_release_event` 表 + 埋点 + 统计看板；
- [ ] 多 channel（beta / nightly）admin 切换 UI；
- [ ] GitHub Release 镜像可选保留：CI 双写 GitHub + MinIO 一段时间后下线 GitHub。

---

## 12. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| MinIO 公网桶被恶意刷流量 | 带宽成本 | 前置 CDN + 限速 + 异常流量告警 |
| `latest*.yml` 缓存过久 | 用户拿不到新版 | yml 短缓存 60s + 发布后主动调 CDN 刷新（如有） |
| admin 上传时 sha512 浏览器算错 | 自动更新校验失败 | server 收到注册请求后**异步校验一次**（HEAD MinIO + 流式 sha512），不一致则把 release 置为 `error` 状态拒绝发布 |
| CI register 接口宕机 | 包传到 MinIO 但元数据没注册 | register 失败重试 3 次；MinIO 上的孤儿包后续 admin 可手动「从 MinIO 已有对象创建记录」（P2 工具） |
| 同 version 重复上传不同 sha512 | 客户端校验失败 | DB 唯一约束 `(version, channel, platform, arch)`；admin 手动上传时校验已有记录强制确认覆盖 |
| edu-server 跟 GitHub 一样海外不通 | 国内访问元数据慢 | edu-server 本身已经在国内云上，符合现状；如未来海外用户多再加 edge cache |
| GitHub Action runner 不能访问 MinIO endpoint | CI 通道失效 | 兜底走 admin 手动；或在 CI 里把产物上传为 workflow artifact，运维下载后用 admin 上传 |
| electron-updater 协议变更 | 自动更新失效 | 锁定 electron-updater 版本，升级前在 staging channel 验证 |

---

## 13. 安全

- **MinIO bucket policy** 仅允许 `s3:GetObject`，无 list/put/delete；
- **service account 分离**：edu-server / CI / admin 上传各自一对 key，可单独吊销；
- **预签名 URL TTL ≤ 1h**，object key 由 server 决定，客户端不能改路径；
- **release token** 长期有效但只能调 ci-register / refresh-yml，不能改 admin 接口；
- **sha512 强制校验**：server 异步用 MinIO 对象重算一次，不一致拒绝发布；
- **release notes Markdown** 在前端渲染时走 sanitize（参考已有 Markdown 组件配置）；
- **admin 接口** 沿用 edu-admin JWT + role check；
- **审计**：所有发布/下线动作写 `audit-log.service.ts`，记录操作者 + 前后状态。

---

## 14. 兼容与迁移

### 14.1 GitHub Release 长期保留策略

- **不变**：electron-builder 配置 `provider: github`，CI 仍 `--publish always` 推 GitHub Release，桌面端 electron-updater 走 GitHub API 拉取 — 完全不动。
- **追加**：CI 在 GitHub 推送成功之后，**并行**执行 MinIO 上传 + edu-server 注册（任一 secret 缺失自动跳过，不影响主链路）。
- **去向**：
  - 官网下载卡 / 历史版本页 → 走 edu-server（国内快）
  - 桌面端 electron-updater → 走 GitHub（OS 级签名校验、海外稳定）
  - admin 灰度 / 撤回 / release notes 编辑 → 走 edu-server 自建一套
- 不需要 migration 脚本；自建侧从 1.4.X 起的新版本会持续累积，老版本若有需要 admin 手动补传一次即可。

### 14.2 文档更新

- [github-release-auto-update.md](docs/github-release-auto-update.md) 顶部加废弃标记，指向本文档；
- [apps/website/src/content/docs.ts](apps/website/src/content/docs.ts) 中相关跳转更新；
- CLAUDE.md / README 提及 GitHub Release 的地方同步刷新。

---

## 15. 配套配置示例

### 15.1 edu-server 环境变量新增

```
RELEASE_MINIO_BUCKET=spark-desktop
RELEASE_MINIO_ENDPOINT=https://minio.xxx.com
RELEASE_MINIO_ACCESS_KEY=xxx
RELEASE_MINIO_SECRET_KEY=xxx
RELEASE_PUBLIC_BASE=https://dl.spark-agent.dev
RELEASE_CI_TOKEN=<long random>
```

### 15.2 桌面端 `electron-builder.yml` diff

```diff
 publish:
-  - provider: github
-    owner: alexanderizh
-    repo: spark-agent
+  - provider: generic
+    url: https://dl.spark-agent.dev/stable
+    channel: latest
+    useMultipleRangeRequest: true
```

### 15.3 官网 `links.ts` diff

```diff
-export const RELEASES_URL = `${GITHUB_URL}/releases`
+export const RELEASES_API_BASE = import.meta.env.VITE_RELEASES_API_BASE
+  || 'https://api.spark-agent.dev'
+export const RELEASES_HISTORY_URL = '/releases'   // 自建历史版本页（v2）
```

---

## 16. 验收 Checklist（上线前过一遍）

- [ ] MinIO bucket policy 已是匿名只读，写权限仅 service account；
- [ ] CDN 缓存策略已配置（安装包长缓存 / yml 短缓存）；
- [ ] edu-server release token 已写入 GitHub secrets；
- [ ] 从 CI 发一个测试版本，端到端 MinIO + edu-server + 官网 + 桌面端自动更新都跑通；
- [ ] 从 admin 手动上传一个测试版本，同上；
- [ ] 删一次草稿确认 MinIO 对象正确清理；
- [ ] 模拟一次回滚，确认 latest 指针正确回退、yml 已更新；
- [ ] 旧 GitHub Release 仍可正常下载（兜底）；
- [ ] [github-release-auto-update.md](docs/github-release-auto-update.md) 已标废弃；
- [ ] 团队知会：发版流程文档 + admin 操作截图。

---

## 17. 参考

- electron-builder generic provider: https://www.electron.build/configuration/publish#genericserveroptions
- electron-updater latest.yml 规范: 见 electron-builder 源码 `packages/app-builder-lib/src/publish/`
- 现有 CI: [.github/workflows/publish-desktop-release.yml](.github/workflows/publish-desktop-release.yml)
- 现有 MinIO 适配: [edu-server/src/service/storage/minio.adapter.ts](../../spark-edugen/edu-server/src/service/storage/minio.adapter.ts)
- 现有上传 controller: [edu-server/src/controller/upload.controller.ts](../../spark-edugen/edu-server/src/controller/upload.controller.ts)
