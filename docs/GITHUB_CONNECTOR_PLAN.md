# GitHub 连接器 & Board 同步方案（审阅修订版）

> 状态: 实施中 | 最后核对: 2026-06-29
>
> 分支：`feat/team-mode` | 原方案日期：2026-06-12

2026-06-29 进展更新：GitHub 连接器底座已开始落地，桌面端现已具备 `PAT -> 主进程验证 -> 系统 keystore 持久化 -> SQLite 连接元数据 -> spark_platform MCP 工具暴露` 的完整链路。当前已能在授权范围内提供 repo / issue / PR 读写工具；Board 同步仍处于后续阶段，尚未接入。

---

## 当前落地边界（2026-06-29）

已落地：

- GitHub PAT 验证从 renderer 迁移到主进程，避免 CSP 导致的 `fetch failed`
- GitHub 连接元数据持久化到 SQLite，PAT 明文存入系统 keystore
- 连接器设置页通过 IPC 读取/保存连接状态，应用重启后仍可继续使用
- `spark_platform` MCP 已暴露 GitHub 仓库、Issue、Pull Request 的实际操作工具
- 通过 `selectedRepos` 与 `allowWrites` 对 agent 的仓库范围和写权限做硬性约束

未落地：

- OAuth / Device Flow / GitHub App 安装流
- Board 任务与 GitHub Issue 的同步索引、cursor、增量同步
- GitHub Projects v2
- 自动定时同步与冲突解决
- Board 侧来源态与写回策略

---

## 一、审阅结论

原方案的大方向是对的：可以复用现有 `Provider` / `RemoteConnection` / IPC / keystore / SQLite 模式，为桌面端补一套 GitHub 连接器能力。

但原稿里有几处会在真正落地时出问题，已经在本文档中修正：

1. **范围过大**：第一版同时写 Issues / PR / Projects / MCP / 写回，会把复杂度拉得过高。建议收敛为“**PAT + Issues + 手动单向同步**”先上线。
2. **数据边界不清**：`Board` 现在是 `~/.spark-agent/board-tasks.json`，而且主进程 IPC 与 agent runtime 各自维护了一套读写逻辑；如果不先收敛，会放大并发写和类型漂移问题。
3. **类型路径与文件影响范围不准确**：当前 `BoardTask` 类型不在 `packages/shared/src/types/board.ts`，而是分散在：
   - `packages/protocol/src/ipc/index.ts`
   - `apps/desktop/src/renderer/design/views/BoardView.tsx`
   - `apps/desktop/src/main/ipc/index.ts`
   - `packages/agent-runtime/src/services/platform-bridge.service.ts`
4. **同步游标设计过粗**：`last_sync_at` 只挂在连接级别不够，多个 repo 同步时必须有**按仓库维度**的 cursor / error / ETag。
5. **唯一键不稳定**：`owner/repo#123` 适合作展示，不适合作稳定主键；应优先存 GitHub `node_id` 或 `repository_id + number`。
6. **第一版冲突策略缺失**：必须先明确“哪些字段 GitHub 拥有、哪些字段 Board 拥有、哪些字段只读”，否则一上来就会出现覆盖用户本地编辑的问题。
7. **UI 落点不准确**：当前一级导航定义在 `apps/desktop/src/renderer/App.tsx`，不是 `design/App.tsx` / `Sidebar.tsx`。

结论：**建议继续做，但要改成“先补底座，再做只读导入”的两段式方案。**

---

## 二、现状对齐

| 模块 | 当前现状 |
|------|------|
| **Board 存储** | `~/.spark-agent/board-tasks.json`，主进程 IPC 与 agent runtime platform-bridge 都会直接读写 |
| **Board 持久化结构** | JSON 文件中保留 `commentsJson` / `attachmentsJson` 这类序列化字段，renderer / main / runtime 各自做 normalize |
| **Board 状态枚举** | `todo / in-progress / bug-fix / done / accepted / closed` |
| **Board 类型定义** | 目前未完全收敛到单一 shared type，分散在 protocol / renderer / main / runtime |
| **桌面端 GitHub 能力** | 仓库内无现成 connector 抽象；只有 release 检查、server 侧 GitHub OAuth 登录 |
| **可复用模式** | `ProviderProfileRepository + keystore + IPC + Drawer`、`RemoteConnectionService + SettingsService`、平台管理 MCP bridge |
| **UI 约束** | 必须使用 Arco Design；下拉统一 `SparkSelect` / `SparkMultiSelect`，复选统一 `SparkCheckbox` |

---

## 三、产品范围建议

### 3.1 当前阶段范围

当前阶段已经开始实现的能力：

- GitHub **PAT 认证**
- GitHub 连接 **持久化**
- 面向 agent 的 GitHub **repo / issue / PR MCP 工具**
- 基于 `selectedRepos` 的仓库范围控制
- 基于 `allowWrites` 的写操作闸门

当前阶段**仍未做**：

- GitHub OAuth
- GitHub Projects v2
- 自动定时双向同步
- Board 任务一键写回 GitHub
- Board 与 GitHub Issue 的同步索引与冲突策略

### 3.2 为什么要这样收敛

1. GitHub `issues.listForRepo` 本身就会混入 PR，需要额外过滤 `pull_request` 字段。
2. Projects v2 依赖 GraphQL、自定义字段、状态字段映射，复杂度远高于 Issues。
3. 写回一旦上线，就必须同时解决冲突检测、字段所有权、失败回滚、权限不足等问题。
4. 当前 Board 还是文件存储，先做“可靠导入”比“功能面铺开”更重要。

---

## 四、核心设计决策

### 决策 1：保留 Connector 抽象，但第一版只落 GitHub

- **建议**：保留 `ConnectorType = 'github' | 'gitlab' | 'jira' | 'linear'` 这层抽象。
- **但第一版只实现 `github`**，不要为了“未来扩展”把当前实现做成过度通用的框架。

原因：抽象层是值得有的，但第一版应该是“面向一个真实连接器打透”，不是空转的插件系统。

### 决策 2：Board 任务保留 `externalSource`，SQLite 只做同步索引

建议同时保留两层数据：

1. **Board JSON 中的 `externalSource`**
   - 用于 UI 展示、来源识别、导出时保留来源信息
   - 这是任务本体的一部分
2. **SQLite 中的同步索引表**
   - 用于 cursor、同步状态、payload 快照、去重与增量同步
   - 这是同步引擎的内部状态

这样可以避免“UI 不知道任务从哪来”和“同步引擎没有高效索引”两个问题。

### 决策 3：第一版采用“远端拥有业务字段，本地拥有协作字段”

为避免冲突，先定义字段所有权：

| 字段 | 所有权 | 第一版策略 |
|------|------|------|
| `title` | GitHub | 同步覆盖 |
| `description` | GitHub | 同步覆盖 |
| `status` | GitHub | `open/closed + label 映射` 生成 |
| `tags` | GitHub | 由 labels 映射 |
| `assignee` | GitHub | 同步覆盖 |
| `project` | GitHub | milestone 映射 |
| `createdAt` / `updatedAt` | 本地任务字段 | 保留本地字段，同时单独存 remote 时间戳 |
| `processingAgent` | Board | 本地保留，不被同步覆盖 |
| `acceptanceCriteria` | Board | 本地保留 |
| `testAgent` | Board | 本地保留 |
| `comments` | Board | 第一版不映射 GitHub comments |
| `attachments` | Board | 第一版不映射 GitHub attachments |
| `sortOrder` | Board | 本地保留 |

这意味着第一版导入的 GitHub 任务不是“完全只读”，而是“**GitHub 拥有业务字段，Board 保留本地协作字段**”。

### 决策 4：同步游标必须按 repo 维护

原方案的 `connector_connections.last_sync_at` 不够。

应改成：

- 连接级别：只存最近一次整体同步时间、最近一次错误摘要
- 仓库级别：存每个 repo 的 `lastSyncAt / lastSuccessAt / lastError / etag / lastSeenRemoteUpdatedAt`

否则一个 connector 配多个 repo 时，任何单 repo 失败都会让全局游标变得不可信。

### 决策 5：第一版只支持 PAT，不做 OAuth

建议第一版 UI 里只出现：

- `authMethod: 'pat'`
- `token`
- `selectedRepos`
- `syncIssues`

不要在第一版类型里提前放 `oauth` 分支并实现半套空壳逻辑。

PAT 推荐说明：

- Fine-grained PAT 优先
- 权限至少需要：
  - Repository metadata: read
  - Issues: read
- 如果后续要读 private repo，则用户自行在 PAT 授权范围中勾选对应仓库

---

## 五、建议的数据模型

### 5.1 Board 任务上的来源字段

```ts
export interface ExternalSource {
  provider: 'github'
  objectType: 'issue'
  connectorId: string
  remoteId: string           // 推荐存 GitHub node_id
  displayId: string          // 例如 owner/repo#123
  owner: string
  repo: string
  number: number
  htmlUrl: string
  syncedAt: number
  lastRemoteUpdateAt: string
  syncState?: 'synced' | 'stale' | 'error' | 'detached'
  externalMeta?: {
    labels?: string[]
    milestone?: string | null
    assignees?: string[]
    state?: 'open' | 'closed'
  }
}
```

Board 任务对象新增：

```ts
externalSource?: ExternalSource
```

### 5.2 SQLite 表设计

#### `connector_connections`

```sql
CREATE TABLE connector_connections (
  id              TEXT PRIMARY KEY,
  connector_type  TEXT NOT NULL,      -- 'github'
  name            TEXT NOT NULL,
  config_json     TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  keystore_ref    TEXT,
  last_sync_at    TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
```

#### `connector_repo_cursors`

```sql
CREATE TABLE connector_repo_cursors (
  id                    TEXT PRIMARY KEY,
  connector_id          TEXT NOT NULL REFERENCES connector_connections(id),
  repo_full_name        TEXT NOT NULL,        -- owner/repo
  repo_remote_id        TEXT,                 -- GitHub repository id / node_id
  last_sync_at          TEXT,
  last_success_at       TEXT,
  last_remote_updated_at TEXT,
  last_error            TEXT,
  etag                  TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE(connector_id, repo_full_name)
);
```

#### `connector_external_links`

```sql
CREATE TABLE connector_external_links (
  id                TEXT PRIMARY KEY,
  connector_id      TEXT NOT NULL REFERENCES connector_connections(id),
  external_type     TEXT NOT NULL,      -- 'issue'
  remote_id         TEXT NOT NULL,      -- GitHub node_id
  display_id        TEXT NOT NULL,      -- owner/repo#123
  local_task_id     TEXT NOT NULL,
  remote_updated_at TEXT NOT NULL,
  sync_state        TEXT NOT NULL DEFAULT 'synced',
  payload_json      TEXT,
  last_sync_at      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(connector_id, external_type, remote_id)
);
```

### 5.3 类型放置建议

不要把 connector 类型散落到 renderer 私有文件。

建议新增：

- `packages/protocol/src/connectors.ts`
  - `ConnectorConnection`
  - `GitHubConnectorConfig`
  - `ExternalSource`
  - `ConnectorSyncState`

然后在 `packages/protocol/src/ipc/index.ts` 里导出 IPC request/response 类型。

这样比放在 `packages/shared/src/types/connector.ts` 更贴近当前项目结构。

---

## 六、落地实施方案

### Phase 0：先补底座，再碰 GitHub（1-2 天）

#### 0.1 收敛 Board 文件读写逻辑

这是第一优先级，否则后面同步一进来就会把隐患放大。

建议新增一个纯 TS 的共享 store/helper，例如：

`packages/shared/src/board/board-file-store.ts`

职责：

- `readTasks()`
- `writeTasks()`
- `normalizeTaskRecord()`
- `serializeComments/attachments`
- 统一 `externalSource` 读写

然后让这几处复用同一套逻辑：

- `apps/desktop/src/main/ipc/index.ts`
- `packages/agent-runtime/src/services/platform-bridge.service.ts`
- `apps/desktop/src/renderer/design/views/BoardView.tsx` 的 normalize 部分

#### 0.2 Board 文件写入必须原子化

当前 `writeFileSync(JSON.stringify(tasks))` 风险太高。

建议：

- 先写入 `board-tasks.json.tmp`
- 再 `rename` 覆盖正式文件
- 增加进程内串行写队列 / mutex

如果不做，手动编辑、拖拽改状态、GitHub 同步并发写时都可能把 JSON 写坏。

#### 0.3 新增 SQLite migration + repository

迁移文件位置应与现有项目一致：

- `packages/storage/migrations/027_connector_connections.sql`
- 或合并成一个 `027_github_connector.sql`

同时新增 repository，而不是直接在 service 里写裸 SQL：

- `packages/storage/src/repositories/connector-connection.repository.ts`
- `packages/storage/src/repositories/connector-repo-cursor.repository.ts`
- `packages/storage/src/repositories/connector-external-link.repository.ts`

并记得在以下位置导出：

- `packages/storage/src/repositories/index.ts`
- `packages/storage/src/index.ts`

### Phase 1：GitHub Issues 单向同步（3-5 天）

#### 1.1 依赖

```bash
pnpm add octokit
```

#### 1.2 服务层建议

建议目录：

```text
apps/desktop/src/main/services/connectors/
├── ConnectorService.ts
├── GitHubConnector.ts
├── connector-mapper.ts
└── types.ts
```

原因：

- 这是桌面主进程能力，和现有 `RemoteConnectionService.ts` 更同构
- 不建议把“GitHub 网络同步逻辑”塞进 `packages/storage`
- `packages/storage` 应保留为“存储访问层”

#### 1.3 同步流程

```text
用户点击“立即同步”
  -> connector:sync IPC
  -> ConnectorService.sync(connectorId)
  -> 逐个 repo 读取 cursor
  -> octokit.rest.issues.listForRepo({ owner, repo, since, per_page })
  -> 显式过滤 pull_request != null 的条目
  -> issue 映射为 Board task
  -> 更新 / 新建 external link
  -> 更新 repo cursor
  -> 汇总返回 sync summary
```

#### 1.4 Issues 映射规则

| GitHub Issue 字段 | Board 字段 | 说明 |
|---|---|---|
| `title` | `title` | 直接映射 |
| `body` | `description` | markdown 直接存 |
| `state` | `status` | `open -> todo`, `closed -> closed` |
| `labels[].name` | `tags` | label 名称列表 |
| `assignees[0].login` | `assignee` | 先取第一个 |
| `milestone.title` | `project` | 无则空 |
| `updated_at` | `externalSource.lastRemoteUpdateAt` | 不直接覆盖本地 `updatedAt` 语义 |
| `html_url` | `externalSource.htmlUrl` | 外链 |
| `number` | `externalSource.number` | 展示编号 |
| `node_id` | `externalSource.remoteId` | 稳定主键 |

#### 1.5 第一版不同步 GitHub comments

原因：

- comments 要额外请求，明显增加 API 压力
- 当前 Board `comments` 更像本地协作评论，不等于 GitHub 讨论串
- 一旦混写，后续写回和归属会更复杂

建议第一版完全不映射 comments，后续如果要做，单独定义“远端评论镜像区”。

### Phase 2：前端配置页与 Board 展示（2-4 天）

#### 2.1 导航入口

当前一级导航定义在：

- `apps/desktop/src/renderer/App.tsx`

建议新增 view id：

- `connectors`

并补齐：

- `apps/desktop/src/renderer/design/AppContext.tsx` 的 `ViewId`
- `apps/desktop/src/renderer/App.tsx` 的 `NAV_ITEMS`
- `apps/desktop/src/renderer/App.tsx` 的 `switch (t.view)`

#### 2.2 页面建议

```text
apps/desktop/src/renderer/design/views/
├── ConnectorsView.tsx
├── ConnectorsView.less
├── ConnectorEditDrawer.tsx
└── ConnectorSyncHistoryPanel.tsx
```

#### 2.3 UI 约束

- 表单控件全部使用 Arco
- 下拉使用 `SparkSelect` / `SparkMultiSelect`
- 开关使用 Arco `Switch`
- 布尔选项使用 `SparkCheckbox`
- 编辑面板优先 Arco `Drawer`

#### 2.4 配置项建议

第一版只提供这些字段：

- 连接名称
- PAT
- 同步仓库多选
- 是否启用
- 仅同步 Issues（固定开启即可，不必给 PR / Projects 开关）

不要在第一版 UI 放：

- OAuth 模式切换
- PR 开关
- Projects 开关
- 写回开关

#### 2.5 Board 展示增强

建议在 `BoardView.tsx` 增加：

- GitHub 来源徽标（GitHub 图标 + `#123`）
- 点击跳转 `htmlUrl`
- 来源筛选：`全部 / 本地 / GitHub`
- 同步状态 tag：`已同步 / 需关注 / 失联`

### Phase 3：自动同步（后续）

这一步建议在第一版稳定之后再做。

实现建议：

- 同步频率配置存 `app_settings`
- 类似 `RemoteConnectionService` 的 runtime 管理方式
- 应避免裸 `setInterval` 无状态轮询

建议配置：

- `manual`
- `15min`
- `30min`
- `1h`

并加上：

- 上次同步结果
- 正在同步状态
- 最近错误消息

### Phase 4：写回 GitHub（后续）

只有在以下问题都定义清楚后再做：

- 本地修改与远端修改的冲突规则
- 哪些字段允许写回
- 写回失败时的回滚策略
- 权限不足 / 403 / 404 / repo 转移 / issue 已关闭的处理

建议第一版之后再设计：

- `Push to GitHub`
- `Create issue from local task`
- `Update linked issue`

### Phase 5：GitHub Projects v2（远期）

单独 phase，原因：

- GraphQL API
- 自定义字段
- 状态字段不是统一枚举
- Board 列状态和 Project 单选字段很难天然一一对应

不要和 Issues 同步混在同一期做。

---

## 七、IPC 与 MCP 设计建议

### 7.1 IPC 通道

建议新增：

```ts
'connector:list'
'connector:get'
'connector:create'
'connector:update'
'connector:delete'
'connector:test-connection'
'connector:sync'
'connector:sync-status'
'connector:list-repos'
```

其中 `connector:list-repos` 用于 PAT 校验成功后拉用户可见仓库列表。

### 7.2 MCP 不建议第一版直接做成 `mcp__github__*`

当前项目已有平台管理 MCP server，命名体系是：

- `mcp__spark_platform__*`

如果未来要让 agent 管理连接器，建议沿用现有平台命名：

- `mcp__spark_platform__connectors_list`
- `mcp__spark_platform__connectors_create`
- `mcp__spark_platform__connectors_sync`

而不是第一版直接引入一套新的 `mcp__github__*`。

原因：

- 当前项目更像“平台统一管理工具”，而不是“GitHub 官方 MCP server 宿主”
- 直接暴露 GitHub issue CRUD，会把范围从“Board 同步”扩大成“完整 GitHub 操作面”

---

## 八、风险与对应优化

### 8.1 Board 文件并发写

风险最高。

优化：

- 抽共享 `BoardFileStore`
- 原子写
- 串行写队列

### 8.2 类型漂移

当前 Board 类型有多处定义。

优化：

- 把 `ExternalSource` 与 connector 相关类型收敛到 `@spark/protocol`
- renderer / main / runtime 全部复用

### 8.3 GitHub API 限流

优化：

- repo 维度 cursor
- `since`
- 分页
- 可选 ETag
- comments/PR/Projects 暂缓

### 8.4 Repo 重命名 / 转移

优化：

- 用 `node_id` 作为稳定 remote key
- `owner/repo#123` 仅作 displayId

### 8.5 导入重复任务

优化：

- `connector_id + external_type + remote_id` 唯一约束
- 同步前先查 external link

### 8.6 同步失败后状态不可见

优化：

- 连接级别 + repo 级别错误都要保留
- UI 能看到“哪个 repo 失败、为什么失败”

---

## 九、文件影响范围（修订后）

### 新增文件

| 路径 | 说明 |
|------|------|
| `packages/storage/migrations/027_github_connector.sql` | SQLite 迁移 |
| `packages/storage/src/repositories/connector-connection.repository.ts` | 连接器配置仓储 |
| `packages/storage/src/repositories/connector-repo-cursor.repository.ts` | repo 同步游标仓储 |
| `packages/storage/src/repositories/connector-external-link.repository.ts` | 外链映射仓储 |
| `apps/desktop/src/main/services/connectors/GitHubConnector.ts` | GitHub 同步逻辑 |
| `apps/desktop/src/main/services/connectors/ConnectorService.ts` | 连接器服务聚合 |
| `apps/desktop/src/renderer/design/views/ConnectorsView.tsx` | 连接器页面 |
| `apps/desktop/src/renderer/design/views/ConnectorsView.less` | 页面样式 |
| `apps/desktop/src/renderer/design/views/ConnectorEditDrawer.tsx` | 编辑抽屉 |
| `packages/shared/src/board/board-file-store.ts` | Board 文件共享读写层 |
| `packages/protocol/src/connectors.ts` | Connector / ExternalSource 类型 |

### 修改文件

| 路径 | 说明 |
|------|------|
| `packages/protocol/src/ipc/index.ts` | 补 connector IPC 类型、补 BoardTask 的 `externalSource?` |
| `packages/storage/src/repositories/index.ts` | 导出新 repository |
| `packages/storage/src/index.ts` | 导出新 repository / type |
| `apps/desktop/src/main/ipc/index.ts` | 注册 connector IPC，接入统一 Board store |
| `packages/agent-runtime/src/services/platform-bridge.service.ts` | 复用统一 Board store / normalize |
| `apps/desktop/src/renderer/design/views/BoardView.tsx` | 展示来源标识与筛选项 |
| `apps/desktop/src/renderer/design/AppContext.tsx` | 新增 `connectors` view |
| `apps/desktop/src/renderer/App.tsx` | 新增一级导航与 view 渲染 |

---

## 十、测试与验收标准

### 10.1 必做测试

- migration 能正常执行
- repository CRUD 单测
- `GitHubConnector` 用 mocked octokit 做同步单测
- Board store 原子写 / 并发写单测
- renderer 侧来源展示与筛选逻辑测试

### 10.2 验收标准

满足以下条件才算第一版完成：

1. 用户可新增一个 GitHub PAT 连接器并通过连接测试。
2. 用户可拉取 PAT 可见仓库列表并选择同步仓库。
3. 点击“立即同步”后，GitHub issue 会稳定导入 Board。
4. 再次同步时，同一 issue 不会重复生成本地任务。
5. GitHub issue 更新后，Board 对应任务会被正确刷新。
6. Board 本地字段 `processingAgent / acceptanceCriteria / testAgent / sortOrder` 不会被远端同步覆盖。
7. Board 中能清晰看到 GitHub 来源与同步状态。
8. 同步失败时，UI 能看到错误信息，且不会破坏已有 Board 数据。

---

## 十一、最终建议

建议按下面顺序推进：

1. **先做 BoardFileStore 收敛与原子写**。
2. **再做 SQLite migration + repository**。
3. **然后只做 GitHub Issues 单向同步**。
4. **最后补 UI 展示与同步状态**。

如果按这个顺序做，第一版可以比较稳地落地；如果跳过底座直接上 GitHub 同步，后面大概率会在 Board 文件一致性、类型漂移和同步冲突上反复返工。
