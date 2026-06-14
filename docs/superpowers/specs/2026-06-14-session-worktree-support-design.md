# 应用内会话的 Git Worktree 支持 — 设计文档

- 日期：2026-06-14
- 状态：已评审通过核心架构（方案 A），待 spec 评审
- 关联：参考 Claude Desktop 的 worktree 隔离机制

## 1. 目标

让用户在「应用内会话」中针对 git 项目工作时，可选择在一个**隔离的 git worktree**
里运行 Agent，使其改动不污染主工作区；并在右侧项目信息面板可视化展示所有 worktree、
当前 worktree、以及各 worktree 分支是否已合并回主分支。

### 用户决策（已确认）

| 维度 | 决策 |
| --- | --- |
| 绑定模型 | 会话自动创建 worktree（仿 Claude Desktop），会话与 worktree 一一绑定 |
| 触发方式 | **默认关闭**，新建会话时手动勾选启用；非 git 项目自动禁用 |
| 合并方式 | 面板提供「合并」按钮，点击后向当前会话 Agent 发送 merge 指令，由 Agent 完成合并（含冲突处理）；面板的「是否合并」用 git 判定分支是否已并入 base 分支 |
| 物理位置 | base repo 的 `.spark/worktrees/<branch-slug>`；会话删除/归档时提示是否一并清理 |

## 2. 核心架构：Worktree = 子 Workspace（方案 A）

worktree 目录注册成一个**独立的 workspace 行**，新增 `worktree_meta_json` 列记录其
来源仓库、分支、base 分支。会话的 `workspace_ids_json` 指向该 worktree-workspace，于是：

- Agent 的 cwd（= workspace `root_path`）天然落在 worktree 目录
- 文件树（`workspace:list-directory`）、文件监听（`FileWatcherService`）、
  分支显示（`workspace:list-branches`）、安全白名单（`SafeFileProtocol` 按 workspace root 放行）
  **全部零改动复用**

### 已否决的替代方案

- **方案 B**：独立 `worktrees` 表 + session 加 `worktree_id` + 运行时覆盖 cwd。领域建模更纯，
  但需改 agent 运行路径解析、文件树、文件监听等多处，改动面大。
- **方案 C**：纯 git CLI 实时读、不持久化。最轻，但记不住 base 分支（无法判定合并）、
  绑不了会话、刷新慢。

## 3. 组件设计

### 3.1 `GitWorktreeService`（新建，纯函数式）

位置：`packages/agent-runtime/src/services/git-worktree.service.ts`

封装 git 命令，输入 repo root，输出结构化数据。所有方法通过注入的 `execFile` 执行，
便于单测。

```
listWorktrees(repoRoot): Promise<RawWorktree[]>
  // 解析 `git worktree list --porcelain`
  // → { path, branch, head, isMain, isDetached, isLocked }[]

isMerged(repoRoot, branch, baseBranch): Promise<boolean>
  // `git branch --merged <baseBranch>` 是否包含 branch

addWorktree(repoRoot, { branch, targetPath, baseBranch }): Promise<void>
  // `git worktree add -b <branch> <targetPath> <baseBranch>`

removeWorktree(repoRoot, targetPath, { force }): Promise<void>
  // `git worktree remove [--force] <targetPath>`

resolveMainRepoRoot(anyWorktreePath): Promise<string>
  // `git rev-parse --path-format=absolute --git-common-dir` 推导主仓库根
  // 用于：当前 workspace 本身是 worktree 时，定位主仓库以列出全部 worktree

detectBaseBranch(repoRoot): Promise<string>
  // 优先取 origin/HEAD 指向的分支，回退到 main / master / 当前分支
```

错误处理：非 git 仓库时 `listWorktrees` 抛出可识别错误（上层捕获后返回空列表 +
`isGitRepo: false`）。

### 3.2 Workspace 模型扩展

- migration：`packages/storage/migrations/030_add_workspace_worktree_meta.sql`
  ```sql
  ALTER TABLE workspaces ADD COLUMN worktree_meta_json TEXT;
  ```
- `WorkspaceRow` 增 `worktree_meta_json: string | null`
- `WorkspaceRepository`：create/update 支持该字段的序列化；提供
  `findWorktreesByBaseRepo(baseRepoRoot)` 便于面板回填 `workspaceId / sessionTitle`
- `worktree_meta_json` 反序列化结构：
  ```ts
  interface WorktreeMeta {
    baseRepoRoot: string   // 主仓库根（绝对路径）
    branch: string         // worktree 分支名
    baseBranch: string     // 创建时所基于的 base 分支
  }
  ```
- `WorkspaceService`：
  ```
  createWorktreeWorkspace({ baseWorkspaceId, branch, baseBranch? }): Promise<WorkspaceRow>
    // 1. 读 baseWorkspace.root_path → resolveMainRepoRoot
    // 2. baseBranch 缺省时 detectBaseBranch
    // 3. 计算 targetPath = <mainRepoRoot>/.spark/worktrees/<slug(branch)>
    // 4. 确保 .spark/worktrees/ 已被 .gitignore（缺则追加一行）
    // 5. GitWorktreeService.addWorktree
    // 6. repo.create 注册新 workspace（projectKind 复用 base 检测结果），写 worktree_meta_json
  removeWorktreeWorkspace(workspaceId, { force }): Promise<void>
    // GitWorktreeService.removeWorktree + repo.delete
  ```

### 3.3 IPC 通道

协议：`packages/protocol/src/ipc/index.ts`；处理器：`apps/desktop/src/main/ipc/index.ts`。

| 通道 | 请求 | 响应 |
| --- | --- | --- |
| `workspace:list-worktrees` | `{ workspaceId }` | `{ isGitRepo, baseBranch, worktrees: WorktreeInfo[] }` |
| `workspace:create-worktree` | `{ baseWorkspaceId, branch, baseBranch? }` | `{ workspace: WorkspaceInfo }` |
| `workspace:remove-worktree` | `{ workspaceId, force? }` | `{ removed: boolean }` |

合并**不开新通道**，复用 `session:send-turn`。

`WorktreeInfo` 类型（protocol 导出）：
```ts
interface WorktreeInfo {
  path: string          // worktree 绝对路径
  branch: string | null // 分支名（detached 时为 null）
  head: string          // HEAD 短 hash
  isMain: boolean       // 是否主工作树
  isCurrent: boolean    // 是否当前会话所在 worktree
  isMerged: boolean     // 分支是否已并入 baseBranch
  workspaceId?: string  // 若该 worktree 已注册为 workspace
  sessionTitle?: string // 关联会话标题（便于识别）
}
```

`list-worktrees` 处理流程：解析 workspace root → `resolveMainRepoRoot` →
`listWorktrees` + 对每个分支 `isMerged` → 用 `findWorktreesByBaseRepo` 回填
`workspaceId`，再用 `SessionRepository` 回填 `sessionTitle` → 标记 `isCurrent`
（path === 当前 workspace root）。

### 3.4 客户端 UI 操作入口（重点，勿漏）

#### (a) 新建会话开关 —「为本会话创建隔离 worktree」

- 位置：会话 Composer 的新建会话态（hero / 空会话）。会话是**懒创建**的——
  `onCreateSession(options)` 在用户首次发送时被调用，因此开关状态需作为本地 state
  存在于 Composer，并在 `onCreateSession` 时透传。
- 交互：一个 toggle/checkbox +（展开后）分支名输入框，默认分支名
  `spark/<会话名 slug 或 yyyyMMdd-HHmm>`。
- 禁用态：当前 workspace 非 git 项目时，开关置灰并提示「当前项目不是 git 仓库」。
  （通过 `workspace:list-worktrees` 的 `isGitRepo` 判定，或一个轻量
  `workspace:is-git-repo` 探测；本设计复用 `list-worktrees` 结果缓存。）
- 数据流：
  1. Composer 透传 `options.createWorktree = true` / `options.worktreeBranch = '<branch>'`
  2. `ChatView` 的 `onCreateSession` → `sessionCtx.handleNewSession(activeWorkspaceId, options)`
  3. `handleNewSession`：若 `options.createWorktree`，先调 `workspace:create-worktree`
     （baseWorkspaceId = activeWorkspaceId），拿返回 `workspace.id` 作为本会话的 wsId，
     并 `setActiveWorkspaceId(worktreeWsId)`；失败则 toast 并中止建会话。
- `onCreateSession` 的 options 类型需新增 `createWorktree?: boolean; worktreeBranch?: string`。

#### (b) 右侧 `WorktreePanel`（ChatInspector 内新分区）

- 文件：`apps/desktop/src/renderer/design/components/WorktreePanel.tsx`
  + 同目录 `WorktreePanel.less`（**遵守约定：不在 views.css 加样式**）
- 挂载点：`ChatInspector` 内，紧邻现有分支显示区。
- 展示：
  - 标题行「Worktree」+ 刷新按钮
  - 非 git 项目：占位提示「当前项目不是 git 仓库」
  - worktree 列表项：分支名（主工作树标 `main` 徽标）/ HEAD 短 hash / 相对路径，
    关联会话标题（若有）
  - **当前 worktree 高亮**（`isCurrent`）
  - **合并状态 badge**：已合并（绿）/ 未合并（灰）
  - 每项操作（仅非主工作树）：
    - **合并**：点击 → `session:send-turn` 发送 merge 指令 prompt（模板见 §4），
      仅当该 worktree == 当前会话 worktree 且会话空闲时可用
    - **在文件管理器打开**：复用现有 `workspace:reveal`/`shell.showItemInFolder` 入口
    - **删除/清理**：`workspace:remove-worktree`（带二次确认）
- 数据：组件挂载/激活会话变化时调 `workspace:list-worktrees`；操作后刷新。

#### (c) 会话生命周期清理

- 会话删除/归档时（`session:delete` 调用方，`SessionSidebarContext`），若该会话
  workspace 带 `worktree_meta_json`，弹 `ConfirmDialog`：「是否一并删除该 worktree
  及其分支？」。确认 → `workspace:remove-worktree`。

## 4. 合并指令 Prompt 模板

「合并」按钮通过 `session:send-turn` 发送给当前会话 Agent：

```
请将当前 worktree 分支 `<branch>` 合并回 `<baseBranch>` 分支：
1. 切到主仓库的 <baseBranch> 分支
2. 合并 <branch>
3. 如有冲突，逐一解决并说明你的处理
4. 完成后报告合并结果
```

实际分支名/ base 分支由前端从 `WorktreeInfo` 填充。合并由 Agent 在其工具权限内执行，
冲突交给 Agent 处理。

## 5. 路径与安全

- worktree 落在 `<mainRepoRoot>/.spark/worktrees/<branch-slug>`
- `createWorktreeWorkspace` 确保 `.spark/worktrees/` 在主仓库 `.gitignore`（缺则追加）
- `SafeFileProtocol` 按已登记 workspace root 放行；worktree 作为独立 workspace 自动覆盖，
  无需改白名单逻辑

## 6. 测试策略

- `GitWorktreeService` 单测：临时 git repo（init → 提交 → add/list/merge/remove），
  覆盖 porcelain 解析、merged 判定、非 git 仓库报错
- `WorkspaceService.createWorktreeWorkspace / removeWorktreeWorkspace` 单测
- IPC handler 测试：沿用现有 `apps/desktop/src/main/ipc/__tests__` 模式
- 前端：`handleNewSession` worktree 分支的逻辑单测（mock IPC）

## 7. 错误处理

| 场景 | 行为 |
| --- | --- |
| 非 git 仓库 | 开关禁用 + 面板占位提示；`list-worktrees` 返回 `isGitRepo:false` |
| 分支已存在 / 目录冲突 | `create-worktree` 抛错 → toast，会话不创建 |
| worktree 有未提交改动时删除 | `remove-worktree` 默认非 force，失败提示需 force 或先提交 |
| 合并冲突 | 不在 UI 处理，交给 Agent |

## 8. 改动文件清单

新增：
- `packages/agent-runtime/src/services/git-worktree.service.ts`（+ 测试）
- `packages/storage/migrations/030_add_workspace_worktree_meta.sql`
- `apps/desktop/src/renderer/design/components/WorktreePanel.tsx` / `.less`

修改：
- `packages/storage/src/repositories/workspace.repository.ts`（字段 + 查询）
- `packages/agent-runtime/src/services/workspace.service.ts`（create/remove worktree workspace）
- `packages/protocol/src/ipc/index.ts`（3 个通道 + `WorktreeInfo` 类型）
- `apps/desktop/src/main/ipc/index.ts`（3 个 handler）
- `apps/desktop/src/renderer/design/SessionSidebarContext.tsx`（`handleNewSession` worktree 分支 + 删除清理）
- `apps/desktop/src/renderer/design/views/ChatView.tsx`（Composer 开关 UI + `onCreateSession` options + ChatInspector 挂载 WorktreePanel）
