# Session Git Worktree Support 实现计划

> 状态: 已落地（GitWorktreeService + WorktreePanel 已上线） | 最后核对: 2026-06-19
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让应用内会话可在隔离的 git worktree 中运行 Agent，并在右侧面板可视化展示所有 worktree、当前 worktree、合并状态，提供创建/合并/清理的 UI 操作入口。

**Architecture:** 方案 A —— worktree 目录注册为独立 workspace 行（新增 `worktree_meta_json` 列），会话指向该 workspace，从而复用现有文件树/监听/分支/白名单基础设施。git 操作封装进新的 `GitWorktreeService`，通过 3 个 IPC 通道暴露；合并复用 `session:send-turn` 把指令发给 Agent。

**Tech Stack:** TypeScript / Node.js / Electron / better-sqlite3 / React / Vitest / pnpm monorepo

---

## 文件结构

新增：
- `packages/agent-runtime/src/services/git-worktree.service.ts` — git worktree CLI 封装（纯函数式）
- `packages/agent-runtime/src/__tests__/services/git-worktree.service.test.ts` — 单测
- `packages/storage/migrations/030_add_workspace_worktree_meta.sql` — 加列
- `apps/desktop/src/renderer/design/components/WorktreePanel.tsx` — 右侧面板组件
- `apps/desktop/src/renderer/design/components/WorktreePanel.less` — 面板样式

修改：
- `packages/storage/src/repositories/workspace.repository.ts` — `worktree_meta_json` 字段 + 查询
- `packages/agent-runtime/src/services/workspace.service.ts` — create/remove worktree workspace
- `packages/protocol/src/ipc/index.ts` — 3 个通道 + 类型 + `WorkspaceInfo.worktreeMeta`
- `apps/desktop/src/main/ipc/index.ts` — 3 个 handler + `toWorkspaceInfo` 扩展
- `apps/desktop/src/renderer/design/SessionSidebarContext.tsx` — `handleNewSession` worktree 分支 + 删除清理
- `apps/desktop/src/renderer/design/views/ChatView.tsx` — Composer 开关 + `onCreateSession` options + 挂载 WorktreePanel

---

## Task 1: GitWorktreeService — 解析 worktree 列表

**Files:**
- Create: `packages/agent-runtime/src/services/git-worktree.service.ts`
- Test: `packages/agent-runtime/src/__tests__/services/git-worktree.service.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/agent-runtime/src/__tests__/services/git-worktree.service.test.ts`：

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GitWorktreeService } from '../../services/git-worktree.service.js'

const execFileAsync = promisify(execFile)

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'spark-wt-'))
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 't@t.dev'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(path.join(dir, 'README.md'), '# test\n')
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir })
  return dir
}

describe('GitWorktreeService.listWorktrees', () => {
  let repo: string
  const svc = new GitWorktreeService()

  beforeEach(async () => { repo = await initRepo() })
  afterEach(async () => { await rm(repo, { recursive: true, force: true }) })

  it('returns the main worktree', async () => {
    const list = await svc.listWorktrees(repo)
    expect(list).toHaveLength(1)
    expect(list[0]?.isMain).toBe(true)
    expect(list[0]?.branch).toBe('main')
    expect(list[0]?.head).toMatch(/^[0-9a-f]{7,}$/)
  })

  it('lists an added worktree', async () => {
    const wtPath = path.join(repo, '.spark', 'worktrees', 'feat-x')
    await execFileAsync('git', ['worktree', 'add', '-b', 'feat-x', wtPath], { cwd: repo })
    const list = await svc.listWorktrees(repo)
    const added = list.find((w) => w.branch === 'feat-x')
    expect(added).toBeDefined()
    expect(added?.isMain).toBe(false)
  })

  it('throws for a non-git directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'spark-nogit-'))
    await expect(svc.listWorktrees(dir)).rejects.toThrow()
    await rm(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/agent-runtime && pnpm vitest run src/__tests__/services/git-worktree.service.test.ts`
Expected: FAIL — `Cannot find module '../../services/git-worktree.service.js'`

- [ ] **Step 3: 实现 GitWorktreeService（含 listWorktrees）**

创建 `packages/agent-runtime/src/services/git-worktree.service.ts`：

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 单个 worktree 的原始信息（来自 git worktree list --porcelain） */
export interface RawWorktree {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  isDetached: boolean
  isLocked: boolean
}

export interface AddWorktreeParams {
  branch: string
  targetPath: string
  baseBranch: string
}

/**
 * Git worktree 命令封装。
 *
 * 所有方法以 repo 根目录为 cwd 执行 git。execFile 可注入以便测试。
 */
export class GitWorktreeService {
  constructor(private readonly exec: typeof execFileAsync = execFileAsync) {}

  /** 解析 `git worktree list --porcelain` */
  async listWorktrees(repoRoot: string): Promise<RawWorktree[]> {
    const { stdout } = await this.exec('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot })
    const blocks = stdout.split(/\r?\n\r?\n/).filter((b) => b.trim() !== '')
    const result: RawWorktree[] = []
    for (const [index, block] of blocks.entries()) {
      const lines = block.split(/\r?\n/)
      let wtPath = ''
      let head = ''
      let branch: string | null = null
      let isDetached = false
      let isLocked = false
      for (const line of lines) {
        if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length).trim()
        else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim().slice(0, 7)
        else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
        else if (line.trim() === 'detached') isDetached = true
        else if (line.startsWith('locked')) isLocked = true
      }
      if (wtPath === '') continue
      result.push({ path: wtPath, branch, head, isMain: index === 0, isDetached, isLocked })
    }
    return result
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/agent-runtime && pnpm vitest run src/__tests__/services/git-worktree.service.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/agent-runtime/src/services/git-worktree.service.ts packages/agent-runtime/src/__tests__/services/git-worktree.service.test.ts
git commit -m "feat(agent-runtime): add GitWorktreeService.listWorktrees"
```

---

## Task 2: GitWorktreeService — merged 判定 + base 分支 + 主仓库推导

**Files:**
- Modify: `packages/agent-runtime/src/services/git-worktree.service.ts`
- Test: `packages/agent-runtime/src/__tests__/services/git-worktree.service.test.ts`

- [ ] **Step 1: 追加失败测试**

在测试文件末尾追加：

```typescript
describe('GitWorktreeService merge & base helpers', () => {
  let repo: string
  const svc = new GitWorktreeService()
  beforeEach(async () => { repo = await initRepo() })
  afterEach(async () => { await rm(repo, { recursive: true, force: true }) })

  it('isMerged is false for branch with new commits, true after merge', async () => {
    const wtPath = path.join(repo, '.spark', 'worktrees', 'feat-y')
    await execFileAsync('git', ['worktree', 'add', '-b', 'feat-y', wtPath], { cwd: repo })
    await writeFile(path.join(wtPath, 'a.txt'), 'a\n')
    await execFileAsync('git', ['add', '.'], { cwd: wtPath })
    await execFileAsync('git', ['commit', '-m', 'feat'], { cwd: wtPath })

    expect(await svc.isMerged(repo, 'feat-y', 'main')).toBe(false)
    await execFileAsync('git', ['merge', 'feat-y'], { cwd: repo })
    expect(await svc.isMerged(repo, 'feat-y', 'main')).toBe(true)
  })

  it('detectBaseBranch falls back to current branch', async () => {
    expect(await svc.detectBaseBranch(repo)).toBe('main')
  })

  it('resolveMainRepoRoot returns repo root from inside a worktree', async () => {
    const wtPath = path.join(repo, '.spark', 'worktrees', 'feat-z')
    await execFileAsync('git', ['worktree', 'add', '-b', 'feat-z', wtPath], { cwd: repo })
    const resolved = await svc.resolveMainRepoRoot(wtPath)
    const realRepo = await svc.resolveMainRepoRoot(repo)
    expect(resolved).toBe(realRepo)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/agent-runtime && pnpm vitest run src/__tests__/services/git-worktree.service.test.ts`
Expected: FAIL — `svc.isMerged is not a function`

- [ ] **Step 3: 实现这些方法**

在 `GitWorktreeService` 类内（`listWorktrees` 之后）追加：

```typescript
  /** branch 是否已被 baseBranch 包含（已合并） */
  async isMerged(repoRoot: string, branch: string, baseBranch: string): Promise<boolean> {
    try {
      const { stdout } = await this.exec('git', ['branch', '--merged', baseBranch, '--format=%(refname:short)'], { cwd: repoRoot })
      return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).includes(branch)
    } catch {
      return false
    }
  }

  /** 推导 base 分支：优先 origin/HEAD，回退 main/master，再回退当前分支 */
  async detectBaseBranch(repoRoot: string): Promise<string> {
    try {
      const { stdout } = await this.exec('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repoRoot })
      const ref = stdout.trim().replace(/^origin\//, '')
      if (ref !== '') return ref
    } catch { /* no remote HEAD */ }
    for (const candidate of ['main', 'master']) {
      try {
        await this.exec('git', ['rev-parse', '--verify', candidate], { cwd: repoRoot })
        return candidate
      } catch { /* not present */ }
    }
    const { stdout } = await this.exec('git', ['branch', '--show-current'], { cwd: repoRoot })
    return stdout.trim() || 'main'
  }

  /** 从任意 worktree 路径推导主仓库根（绝对路径） */
  async resolveMainRepoRoot(anyPath: string): Promise<string> {
    const { stdout } = await this.exec(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: anyPath },
    )
    const gitCommonDir = stdout.trim()
    // .git 的父目录即主工作树根
    return gitCommonDir.replace(/[/\\]\.git[/\\]?$/, '').replace(/[/\\]\.git$/, '')
  }

  async addWorktree(repoRoot: string, params: AddWorktreeParams): Promise<void> {
    await this.exec(
      'git',
      ['worktree', 'add', '-b', params.branch, params.targetPath, params.baseBranch],
      { cwd: repoRoot },
    )
  }

  async removeWorktree(repoRoot: string, targetPath: string, opts: { force?: boolean } = {}): Promise<void> {
    const args = ['worktree', 'remove']
    if (opts.force === true) args.push('--force')
    args.push(targetPath)
    await this.exec('git', args, { cwd: repoRoot })
  }
```

> 注：`resolveMainRepoRoot` 对主仓库返回其根；对 linked worktree，`--git-common-dir` 指向主仓库的 `.git`，去掉尾部 `.git` 即主仓库根。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/agent-runtime && pnpm vitest run src/__tests__/services/git-worktree.service.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add packages/agent-runtime/src/services/git-worktree.service.ts packages/agent-runtime/src/__tests__/services/git-worktree.service.test.ts
git commit -m "feat(agent-runtime): add isMerged/detectBaseBranch/resolveMainRepoRoot/add/remove to GitWorktreeService"
```

---

## Task 3: 导出 GitWorktreeService

**Files:**
- Modify: `packages/agent-runtime/src/index.ts`（若不存在 barrel，则定位现有 service 导出文件）

- [ ] **Step 1: 确认导出位置**

Run: `grep -rn "workspace.service" packages/agent-runtime/src/index.ts`
Expected: 找到 WorkspaceService 的导出行作为参照。

- [ ] **Step 2: 添加导出**

在 `packages/agent-runtime/src/index.ts` 中，紧邻 `WorkspaceService` 导出处添加：

```typescript
export { GitWorktreeService } from './services/git-worktree.service.js'
export type { RawWorktree, AddWorktreeParams } from './services/git-worktree.service.js'
```

- [ ] **Step 3: typecheck**

Run: `cd packages/agent-runtime && pnpm typecheck`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add packages/agent-runtime/src/index.ts
git commit -m "feat(agent-runtime): export GitWorktreeService"
```

---

## Task 4: 数据库迁移 + WorkspaceRepository 字段

**Files:**
- Create: `packages/storage/migrations/030_add_workspace_worktree_meta.sql`
- Modify: `packages/storage/src/repositories/workspace.repository.ts`

- [ ] **Step 1: 写 migration**

创建 `packages/storage/migrations/030_add_workspace_worktree_meta.sql`：

```sql
-- 为 worktree 隔离会话记录其来源仓库 / 分支 / base 分支
ALTER TABLE workspaces ADD COLUMN worktree_meta_json TEXT;
```

> 命名注意：仓库已存在重复序号 `028_*`，本文件用 `030` 避免与现有 `029` 冲突。先 `ls packages/storage/migrations` 确认最大序号仍为 029。

- [ ] **Step 2: 扩展 WorkspaceRow 与 create 参数**

在 `packages/storage/src/repositories/workspace.repository.ts`：

`WorkspaceRow` 接口在 `relocated_from_json` 行后加：

```typescript
  worktree_meta_json: string | null
```

新增导出接口（文件顶部 import 之后、`CreateWorkspaceParams` 之前）：

```typescript
/** worktree workspace 的元数据（序列化进 worktree_meta_json） */
export interface WorktreeMeta {
  baseRepoRoot: string
  branch: string
  baseBranch: string
}
```

`CreateWorkspaceParams` 加可选字段：

```typescript
  worktreeMeta?: WorktreeMeta
```

`create()` 的 INSERT 语句加列与值：

```typescript
    const stmt = this.raw.prepare(`
      INSERT INTO workspaces (id, name, root_path, spark_config_path, agent_runtime_path, project_kind, relocated_from_json, worktree_meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      params.id,
      params.name,
      params.rootPath,
      `${params.rootPath}/.spark`,
      `${params.rootPath}/.agent_spark`,
      params.projectKind ?? 'generic',
      params.relocatedFrom ? this.toJson(params.relocatedFrom) : null,
      params.worktreeMeta ? this.toJson(params.worktreeMeta) : null,
      now,
      now,
    )
```

新增查询方法（放在 `findByRootPath` 之后）：

```typescript
  /** 解析某 workspace 的 worktree 元数据，非 worktree 返回 null */
  getWorktreeMeta(id: string): WorktreeMeta | null {
    const row = this.get(id)
    if (row == null || row.worktree_meta_json == null) return null
    return this.fromJson<WorktreeMeta | null>(row.worktree_meta_json, null)
  }

  /** 查找某主仓库下已注册为 workspace 的所有 worktree */
  findWorktreesByBaseRepo(baseRepoRoot: string): WorkspaceRow[] {
    const stmt = this.raw.prepare(`SELECT * FROM workspaces WHERE worktree_meta_json IS NOT NULL`)
    const rows = stmt.all() as WorkspaceRow[]
    return rows.filter((r) => {
      const meta = this.fromJson<WorktreeMeta | null>(r.worktree_meta_json, null)
      return meta?.baseRepoRoot === baseRepoRoot
    })
  }
```

- [ ] **Step 3: typecheck + 现有测试**

Run: `cd packages/storage && pnpm typecheck`
Expected: 无错误

> 注：`@spark/storage` 跑测试需先切 better-sqlite3 ABI（见项目记忆）。typecheck 不需要。

- [ ] **Step 4: 提交**

```bash
git add packages/storage/migrations/030_add_workspace_worktree_meta.sql packages/storage/src/repositories/workspace.repository.ts
git commit -m "feat(storage): add worktree_meta_json column and queries"
```

---

## Task 5: WorkspaceService — 创建 / 删除 worktree workspace

**Files:**
- Modify: `packages/agent-runtime/src/services/workspace.service.ts`
- Test: `packages/agent-runtime/src/__tests__/services/workspace.service.test.ts`

- [ ] **Step 1: 写失败测试**

在 `workspace.service.test.ts` 末尾追加（用真实临时 git repo + 真实 GitWorktreeService，repo mock 用现有 `makeRepo()`）：

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GitWorktreeService } from '../../services/git-worktree.service.js'
const execFileAsyncT = promisify(execFile)

describe('WorkspaceService worktree', () => {
  it('createWorktreeWorkspace adds a worktree and registers a workspace', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'spark-wssvc-'))
    await execFileAsyncT('git', ['init', '-b', 'main'], { cwd: repoDir })
    await execFileAsyncT('git', ['config', 'user.email', 't@t.dev'], { cwd: repoDir })
    await execFileAsyncT('git', ['config', 'user.name', 'T'], { cwd: repoDir })
    await writeFile(path.join(repoDir, 'README.md'), '# x\n')
    await execFileAsyncT('git', ['add', '.'], { cwd: repoDir })
    await execFileAsyncT('git', ['commit', '-m', 'init'], { cwd: repoDir })

    const repo = makeRepo()
    const base = repo.create({ id: 'base', name: 'base', rootPath: repoDir, projectKind: 'unknown' })
    const svc = new WorkspaceService(repo as never, new GitWorktreeService())

    const wt = await svc.createWorktreeWorkspace({ baseWorkspaceId: base.id, branch: 'spark/feat-1' })
    expect(wt.root_path).toContain(path.join('.spark', 'worktrees'))
    expect(repo.create).toHaveBeenCalledTimes(2)

    await rm(repoDir, { recursive: true, force: true })
  })
})
```

> `makeRepo()` 需补 `getWorktreeMeta`/`findWorktreesByBaseRepo` mock —— 见 Step 3 同步更新。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/agent-runtime && pnpm vitest run src/__tests__/services/workspace.service.test.ts`
Expected: FAIL — `WorkspaceService` 构造函数不接受第二参数 / `createWorktreeWorkspace` 不存在

- [ ] **Step 3: 实现**

在 `workspace.service.ts`：

顶部 import 增加：

```typescript
import { GitWorktreeService } from './git-worktree.service.js'
import type { WorktreeMeta } from '@spark/storage'
```

构造函数改为注入 GitWorktreeService（默认值便于现有调用方不破坏）：

```typescript
  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly git: GitWorktreeService = new GitWorktreeService(),
  ) {}
```

新增参数接口与方法（放在 `relocateWorkspace` 之后）：

```typescript
export interface CreateWorktreeWorkspaceParams {
  baseWorkspaceId: string
  branch: string
  baseBranch?: string
}
```

```typescript
  async createWorktreeWorkspace(params: CreateWorktreeWorkspaceParams): Promise<WorkspaceRow> {
    const base = this.repo.findByIdOrFail(params.baseWorkspaceId)
    const mainRepoRoot = await this.git.resolveMainRepoRoot(base.root_path)
    const baseBranch = params.baseBranch ?? (await this.git.detectBaseBranch(mainRepoRoot))

    const slug = slugifyBranch(params.branch)
    const targetPath = path.join(mainRepoRoot, '.spark', 'worktrees', slug)

    await ensureGitignoreEntry(mainRepoRoot, '.spark/worktrees/')
    await this.git.addWorktree(mainRepoRoot, { branch: params.branch, targetPath, baseBranch })

    const meta: WorktreeMeta = { baseRepoRoot: mainRepoRoot, branch: params.branch, baseBranch }
    const workspace = this.repo.create({
      id: randomUUID(),
      name: `${base.name} · ${params.branch}`,
      rootPath: targetPath,
      projectKind: base.project_kind,
      worktreeMeta: meta,
    })
    this.currentWorkspace = workspace
    return workspace
  }

  async removeWorktreeWorkspace(workspaceId: string, opts: { force?: boolean } = {}): Promise<void> {
    const meta = this.repo.getWorktreeMeta(workspaceId)
    if (meta == null) throw new Error('Workspace is not a worktree')
    const ws = this.repo.findByIdOrFail(workspaceId)
    await this.git.removeWorktree(meta.baseRepoRoot, ws.root_path, opts)
    if (this.currentWorkspace?.id === workspaceId) this.currentWorkspace = null
    this.repo.delete(workspaceId)
  }
```

文件底部工具函数区追加：

```typescript
function slugifyBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree'
}

async function ensureGitignoreEntry(repoRoot: string, entry: string): Promise<void> {
  const gitignorePath = path.join(repoRoot, '.gitignore')
  let content = ''
  try {
    content = await fs.readFile(gitignorePath, 'utf8')
  } catch { /* no .gitignore yet */ }
  const lines = content.split(/\r?\n/).map((l) => l.trim())
  if (lines.includes(entry.trim())) return
  const prefix = content === '' || content.endsWith('\n') ? '' : '\n'
  await fs.writeFile(gitignorePath, `${content}${prefix}${entry}\n`, 'utf8')
}
```

并在测试的 `makeRepo()` 返回对象中补两个 mock（与真实签名一致）：

```typescript
    getWorktreeMeta: vi.fn((id: string) => {
      const row = rows.get(id)
      return row?.worktree_meta_json ? JSON.parse(row.worktree_meta_json) : null
    }),
    findWorktreesByBaseRepo: vi.fn(() => [] as WorkspaceRow[]),
```

同时让 `makeRepo().create` 接受并存储 `worktreeMeta`：在 `create` mock 内把 `worktree_meta_json: params.worktreeMeta ? JSON.stringify(params.worktreeMeta) : null` 写入 `makeWorkspace` overrides，并给 `makeWorkspace` 默认值加 `worktree_meta_json: null`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/agent-runtime && pnpm vitest run src/__tests__/services/workspace.service.test.ts`
Expected: PASS

- [ ] **Step 5: typecheck + 提交**

Run: `cd packages/agent-runtime && pnpm typecheck`
Expected: 无错误

```bash
git add packages/agent-runtime/src/services/workspace.service.ts packages/agent-runtime/src/__tests__/services/workspace.service.test.ts
git commit -m "feat(agent-runtime): create/remove worktree workspace in WorkspaceService"
```

---

## Task 6: Protocol —— 通道、类型、WorkspaceInfo.worktreeMeta

**Files:**
- Modify: `packages/protocol/src/ipc/index.ts`

- [ ] **Step 1: 扩展 WorkspaceInfo**

在 `WorkspaceInfo`（约 548 行）`updatedAt` 后加：

```typescript
  /** 该 workspace 为 git worktree 时的元数据，否则 null */
  worktreeMeta: { baseRepoRoot: string; branch: string; baseBranch: string } | null
```

- [ ] **Step 2: 新增 WorktreeInfo 与三组请求/响应类型**

在 `WorkspaceSwitchBranchResponse`（约 658 行）之后追加：

```typescript
export interface WorktreeInfo {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  isCurrent: boolean
  isMerged: boolean
  workspaceId?: string
  sessionTitle?: string
}

export interface WorkspaceListWorktreesRequest {
  workspaceId: string
}
export interface WorkspaceListWorktreesResponse {
  isGitRepo: boolean
  baseBranch: string | null
  worktrees: WorktreeInfo[]
}

export interface WorkspaceCreateWorktreeRequest {
  baseWorkspaceId: string
  branch: string
  baseBranch?: string
}
export interface WorkspaceCreateWorktreeResponse {
  workspace: WorkspaceInfo
}

export interface WorkspaceRemoveWorktreeRequest {
  workspaceId: string
  force?: boolean
}
export interface WorkspaceRemoveWorktreeResponse {
  removed: boolean
}
```

- [ ] **Step 3: 注册通道映射**

在通道映射表 `workspace:switch-branch` 行（约 3602 行）之后加：

```typescript
  'workspace:list-worktrees': [WorkspaceListWorktreesRequest, WorkspaceListWorktreesResponse]
  'workspace:create-worktree': [WorkspaceCreateWorktreeRequest, WorkspaceCreateWorktreeResponse]
  'workspace:remove-worktree': [WorkspaceRemoveWorktreeRequest, WorkspaceRemoveWorktreeResponse]
```

- [ ] **Step 4: typecheck + 提交**

Run: `cd packages/protocol && pnpm typecheck`
Expected: 无错误

```bash
git add packages/protocol/src/ipc/index.ts
git commit -m "feat(protocol): add worktree IPC channels and types"
```

---

## Task 7: Main IPC handlers + toWorkspaceInfo 扩展

**Files:**
- Modify: `apps/desktop/src/main/ipc/index.ts`

- [ ] **Step 1: 扩展 toWorkspaceInfo**

`toWorkspaceInfo`（约 4313 行）参数类型加 `worktree_meta_json: string | null`，返回对象加：

```typescript
    worktreeMeta: (() => {
      if (workspace.worktree_meta_json == null) return null
      try {
        return JSON.parse(workspace.worktree_meta_json) as { baseRepoRoot: string; branch: string; baseBranch: string }
      } catch {
        return null
      }
    })(),
```

> 注：调用方传的是 `WorkspaceRow`，已含 `worktree_meta_json`，无需改调用点。

- [ ] **Step 2: 新增三个 handler**

在 `workspace:switch-branch` handler（约 2036 行结束处）之后追加：

```typescript
  typedIpcHandle('workspace:list-worktrees', async (req) => {
    log.info(`workspace:list-worktrees requested, workspaceId=${req.workspaceId}`)
    const db = getDatabase()
    const wsRepo = new WorkspaceRepository(db)
    const sessionRepo = new SessionRepository(db)
    const workspace = wsRepo.findByIdOrFail(req.workspaceId)
    const git = new GitWorktreeService()
    try {
      const mainRepoRoot = await git.resolveMainRepoRoot(workspace.root_path)
      const baseBranch = await git.detectBaseBranch(mainRepoRoot)
      const raw = await git.listWorktrees(mainRepoRoot)
      const registered = wsRepo.findWorktreesByBaseRepo(mainRepoRoot)
      const byPath = new Map(registered.map((w) => [path.resolve(w.root_path), w]))
      const currentPath = path.resolve(workspace.root_path)

      const worktrees = await Promise.all(
        raw.map(async (w) => {
          const matched = byPath.get(path.resolve(w.path))
          let sessionTitle: string | undefined
          if (matched) {
            const sessions = sessionRepo.listSessions({ workspaceId: matched.id, limit: 1 })
            sessionTitle = sessions[0]?.title
          }
          const isMerged = w.branch != null && !w.isMain
            ? await git.isMerged(mainRepoRoot, w.branch, baseBranch)
            : false
          return {
            path: w.path,
            branch: w.branch,
            head: w.head,
            isMain: w.isMain,
            isCurrent: path.resolve(w.path) === currentPath,
            isMerged,
            ...(matched ? { workspaceId: matched.id } : {}),
            ...(sessionTitle ? { sessionTitle } : {}),
          }
        }),
      )
      return { isGitRepo: true, baseBranch, worktrees }
    } catch {
      return { isGitRepo: false, baseBranch: null, worktrees: [] }
    }
  })

  typedIpcHandle('workspace:create-worktree', async (req) => {
    log.info(`workspace:create-worktree requested, base=${req.baseWorkspaceId}, branch=${req.branch}`)
    const workspace = await getWorkspaceService().createWorktreeWorkspace({
      baseWorkspaceId: req.baseWorkspaceId,
      branch: req.branch,
      ...(req.baseBranch !== undefined && { baseBranch: req.baseBranch }),
    })
    return { workspace: toWorkspaceInfo(workspace) }
  })

  typedIpcHandle('workspace:remove-worktree', async (req) => {
    log.info(`workspace:remove-worktree requested, workspaceId=${req.workspaceId}`)
    await getWorkspaceService().removeWorktreeWorkspace(req.workspaceId, {
      ...(req.force !== undefined && { force: req.force }),
    })
    return { removed: true }
  })
```

- [ ] **Step 3: 确认 import**

确认文件顶部已 import `GitWorktreeService`（来自 `@spark/agent-runtime`）与 `path`。

Run: `grep -n "GitWorktreeService\|import .* 'node:path'\|from 'node:path'" apps/desktop/src/main/ipc/index.ts`
若缺 `GitWorktreeService`，在 agent-runtime 的 import 块加入；若缺 `path`，加 `import * as path from 'node:path'`。

并确认 `SessionRepository.listSessions` 的实参形态：

Run: `grep -n "listSessions" packages/storage/src/repositories/session.repository.ts`
Expected: 存在 `listSessions(params)` 且支持 `workspaceId` 过滤（见 spec 调研，约 255 行）。若方法名不同，按实际方法名调整 Step 2 中的调用。

- [ ] **Step 4: typecheck + 提交**

Run: `cd apps/desktop && pnpm typecheck`
Expected: 无错误

```bash
git add apps/desktop/src/main/ipc/index.ts
git commit -m "feat(desktop): add worktree IPC handlers and worktreeMeta mapping"
```

---

## Task 8: handleNewSession 支持 worktree + 删除清理

**Files:**
- Modify: `apps/desktop/src/renderer/design/SessionSidebarContext.tsx`

- [ ] **Step 1: 新增 create/remove worktree 的 invoke hook**

在已有 invoke 声明区（约 239 行 `deleteSession` 附近）加：

```typescript
  const { invoke: createWorktree } = useIpcInvoke('workspace:create-worktree')
  const { invoke: removeWorktree } = useIpcInvoke('workspace:remove-worktree')
```

- [ ] **Step 2: handleNewSession 内创建 worktree**

在 `handleNewSession`（约 388 行）确定 `wsId` 之后、查找 unusedSession 之前插入：

```typescript
      // 勾选了「为本会话创建隔离 worktree」：先创建 worktree workspace，改用其 id
      if (options.createWorktree === true && wsId != null) {
        // 默认分支名 spark/YYYYMMDD-HHmm
        const ts = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
        const branch = nonEmptyString(options.worktreeBranch) ?? `spark/${ts}`
        try {
          const res = await createWorktree({ baseWorkspaceId: wsId, branch })
          wsId = res.workspace.id
          setActiveWorkspaceId(res.workspace.id)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : '创建 worktree 失败')
          return null
        }
      }
```

> `options.createWorktree` / `options.worktreeBranch` 走 `Record<string, unknown>`，用现有 `nonEmptyString` 取值。注意：worktree 会话不应复用 unusedSession，故此判断放在 unusedSession 查找之前并在创建后 wsId 已切换为新 worktree workspace（其下必无 unusedSession）。

- [ ] **Step 3: 删除会话时清理 worktree**

替换 `handleDeleteSession`（约 615 行）为：

```typescript
  const handleDeleteSession = useCallback(async (session: SessionSummary) => {
    const confirmed = await requestConfirm({
      title: '确认',
      description: `是否确定删除会话「${session.title ?? '未命名'}」？`,
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    // 若该会话工作区是 worktree，额外询问是否清理
    const wsId = session.workspaceIds[0]
    const ws = wsId != null ? workspaces.find((w) => w.id === wsId) : undefined
    let cleanupWorktree = false
    if (ws?.worktreeMeta != null) {
      cleanupWorktree = await requestConfirm({
        title: '清理 worktree',
        description: `该会话在隔离 worktree（分支 ${ws.worktreeMeta.branch}）中运行，是否一并删除该 worktree 及其分支？`,
        confirmText: '一并删除',
        danger: true,
      })
    }
    try {
      await deleteSession({ sessionId: session.id })
      if (cleanupWorktree && wsId != null) {
        await removeWorktree({ workspaceId: wsId, force: true }).catch((err) => {
          toast.error(err instanceof Error ? err.message : '删除 worktree 失败（可能有未提交改动）')
        })
      }
      if (active === session.id) setActive(null)
      await refreshData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除会话失败')
    }
  }, [active, deleteSession, removeWorktree, refreshData, requestConfirm, toast, workspaces])
```

- [ ] **Step 4: typecheck + 提交**

Run: `cd apps/desktop && pnpm typecheck`
Expected: 无错误

```bash
git add apps/desktop/src/renderer/design/SessionSidebarContext.tsx
git commit -m "feat(desktop): create worktree on new session and cleanup on delete"
```

---

## Task 9: Composer 新建会话开关 UI

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`

- [ ] **Step 1: 扩展 onCreateSession options 类型**

`onCreateSession`（约 5581 行）的参数对象类型追加：

```typescript
    createWorktree?: boolean
    worktreeBranch?: string
```

并在调用 `onCreateSession({...})`（约 5618 行的发送路径与新建路径）透传 Composer 的开关状态。

- [ ] **Step 2: 加开关 state 与 UI**

在新建会话态 Composer 组件内（持有 `popupVisible` 等 state 的组件）加：

```typescript
  const [createWorktree, setCreateWorktree] = useState(false)
  const [worktreeBranch, setWorktreeBranch] = useState('')
```

在 Composer 工具行（与其它选项按钮同处）渲染（仅当当前 workspace 为 git 项目时启用——通过新增 prop `isGitWorkspace: boolean` 传入，由父组件用 `workspace:list-worktrees` 的 `isGitRepo` 结果决定）：

```tsx
  {sessionId == null && (
    <label className="composer-worktree-toggle" title={isGitWorkspace ? '在隔离 worktree 中运行本会话' : '当前项目不是 git 仓库'}>
      <input
        type="checkbox"
        checked={createWorktree}
        disabled={!isGitWorkspace}
        onChange={(e) => setCreateWorktree(e.target.checked)}
      />
      <span>隔离 worktree</span>
      {createWorktree && (
        <input
          className="composer-worktree-branch"
          type="text"
          placeholder="分支名（留空自动生成）"
          value={worktreeBranch}
          onChange={(e) => setWorktreeBranch(e.target.value)}
        />
      )}
    </label>
  )}
```

提交发送时把 `createWorktree` / `worktreeBranch`（非空才传）并入 `onCreateSession({...})`。

- [ ] **Step 3: 父组件传入 isGitWorkspace**

在 `ChatView` 主体，新增 state `const [isGitWorkspace, setIsGitWorkspace] = useState(false)`，复用已有 `activeWorkspaceId` 变化的 effect（约 654 行 listBranches 附近）追加：

```typescript
    listWorktrees({ workspaceId: activeWorkspaceId })
      .then((res) => { if (!cancelled) setIsGitWorkspace(res.isGitRepo) })
      .catch(() => { if (!cancelled) setIsGitWorkspace(false) })
```

并声明 `const { invoke: listWorktrees } = useIpcInvoke('workspace:list-worktrees')`。把 `isGitWorkspace` 通过 props 透传到 Composer。

- [ ] **Step 4: 样式（写入组件局部，勿动 views.css）**

worktree toggle 的样式写进与 Composer 相关的现有 `.less` 文件（`ChatView.less`），追加：

```less
.composer-worktree-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
  &:has(input:disabled) { opacity: 0.5; cursor: not-allowed; }
  .composer-worktree-branch {
    width: 160px;
    padding: 2px 6px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    background: transparent;
    color: inherit;
  }
}
```

- [ ] **Step 5: typecheck + 提交**

Run: `cd apps/desktop && pnpm typecheck`
Expected: 无错误

```bash
git add apps/desktop/src/renderer/design/views/ChatView.tsx apps/desktop/src/renderer/design/views/ChatView.less
git commit -m "feat(desktop): add isolated-worktree toggle to new-session composer"
```

---

## Task 10: WorktreePanel 组件

**Files:**
- Create: `apps/desktop/src/renderer/design/components/WorktreePanel.tsx`
- Create: `apps/desktop/src/renderer/design/components/WorktreePanel.less`

- [ ] **Step 1: 实现 WorktreePanel.tsx**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { SessionId, WorktreeInfo } from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import './WorktreePanel.less'

interface WorktreePanelProps {
  workspaceId: string | null
  /** 当前会话 id；为「合并」按钮发送指令所需 */
  sessionId: SessionId | null
}

export function WorktreePanel({ workspaceId, sessionId }: WorktreePanelProps) {
  const { toast } = useToast()
  const { invoke: listWorktrees } = useIpcInvoke('workspace:list-worktrees')
  const { invoke: removeWorktree } = useIpcInvoke('workspace:remove-worktree')
  const { invoke: revealFolder } = useIpcInvoke('workspace:reveal')
  const { invoke: sendTurn } = useIpcInvoke('session:send-turn')

  const [isGitRepo, setIsGitRepo] = useState(true)
  const [baseBranch, setBaseBranch] = useState<string | null>(null)
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    if (workspaceId == null) return
    setLoading(true)
    listWorktrees({ workspaceId })
      .then((res) => { setIsGitRepo(res.isGitRepo); setBaseBranch(res.baseBranch); setWorktrees(res.worktrees) })
      .catch(() => { setIsGitRepo(false); setWorktrees([]) })
      .finally(() => setLoading(false))
  }, [workspaceId, listWorktrees])

  useEffect(() => { refresh() }, [refresh])

  const handleMerge = useCallback(async (wt: WorktreeInfo) => {
    if (sessionId == null || wt.branch == null || baseBranch == null) return
    const message =
      `请将当前 worktree 分支 \`${wt.branch}\` 合并回 \`${baseBranch}\` 分支：\n` +
      `1. 切到 ${baseBranch} 分支\n2. 合并 ${wt.branch}\n3. 如有冲突，逐一解决并说明处理\n4. 完成后报告合并结果`
    try {
      await sendTurn({ sessionId, input: message })
      toast.success('已向 Agent 发送合并指令')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送合并指令失败')
    }
  }, [sessionId, baseBranch, sendTurn, toast])

  const handleRemove = useCallback(async (wt: WorktreeInfo) => {
    if (wt.workspaceId == null) return
    try {
      await removeWorktree({ workspaceId: wt.workspaceId, force: true })
      toast.success('已删除 worktree')
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除 worktree 失败')
    }
  }, [removeWorktree, toast, refresh])

  const handleReveal = useCallback(async (wt: WorktreeInfo) => {
    if (wt.workspaceId == null) return
    await revealFolder({ workspaceId: wt.workspaceId }).catch(() => {})
  }, [revealFolder])

  if (workspaceId == null) return null

  return (
    <section className="worktree-panel">
      <header className="worktree-panel__header">
        <span className="worktree-panel__title">Worktree</span>
        <button className="worktree-panel__refresh" onClick={refresh} disabled={loading}>刷新</button>
      </header>
      {!isGitRepo ? (
        <p className="worktree-panel__empty">当前项目不是 git 仓库</p>
      ) : (
        <ul className="worktree-panel__list">
          {worktrees.map((wt) => (
            <li key={wt.path} className={`worktree-item ${wt.isCurrent ? 'is-current' : ''}`}>
              <div className="worktree-item__main">
                <span className="worktree-item__branch">{wt.branch ?? '(detached)'}</span>
                {wt.isMain && <span className="badge badge--main">main</span>}
                {!wt.isMain && (
                  <span className={`badge ${wt.isMerged ? 'badge--merged' : 'badge--unmerged'}`}>
                    {wt.isMerged ? '已合并' : '未合并'}
                  </span>
                )}
                {wt.isCurrent && <span className="badge badge--current">当前</span>}
              </div>
              <div className="worktree-item__meta">
                <code>{wt.head}</code>
                {wt.sessionTitle && <span className="worktree-item__session">{wt.sessionTitle}</span>}
              </div>
              {!wt.isMain && (
                <div className="worktree-item__actions">
                  {wt.isCurrent && (
                    <button onClick={() => handleMerge(wt)} disabled={sessionId == null}>合并</button>
                  )}
                  <button onClick={() => handleReveal(wt)}>打开</button>
                  <button className="danger" onClick={() => handleRemove(wt)}>删除</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

> Step 验证点：确认 `session:send-turn` 请求字段名。Run: `grep -n "SessionSendTurnRequest" packages/protocol/src/ipc/index.ts` 并查看其字段（可能是 `input` / `message` / `text`）。按实际字段名修正 `sendTurn({...})`。同理确认 `workspace:reveal` 通道名（Run: `grep -n "workspace:reveal\|reveal" packages/protocol/src/ipc/index.ts`）；若实际为其它名（如 `workspace:open-folder`），替换之。

- [ ] **Step 2: 实现 WorktreePanel.less**

```less
.worktree-panel {
  padding: 8px 12px;
  &__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  &__title { font-weight: 600; font-size: 13px; }
  &__refresh { font-size: 12px; background: none; border: none; color: var(--text-secondary, #888); cursor: pointer; }
  &__empty { font-size: 12px; color: var(--text-secondary, #888); }
  &__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }

  .worktree-item {
    padding: 6px 8px; border: 1px solid var(--border-color, #e3e3e3); border-radius: 6px;
    &.is-current { border-color: var(--accent-color, #4a8cff); background: var(--accent-bg, rgba(74, 140, 255, 0.06)); }
    &__main { display: flex; align-items: center; gap: 6px; }
    &__branch { font-size: 13px; font-weight: 500; }
    &__meta { display: flex; gap: 8px; align-items: center; margin-top: 2px; font-size: 11px; color: var(--text-secondary, #888); }
    &__actions { display: flex; gap: 6px; margin-top: 6px;
      button { font-size: 12px; padding: 2px 8px; border: 1px solid var(--border-color, #ddd); border-radius: 4px; background: transparent; cursor: pointer; }
      button.danger { color: var(--danger-color, #e5484d); }
    }
  }
  .badge {
    font-size: 10px; padding: 1px 6px; border-radius: 8px;
    &--main { background: var(--badge-bg, #eee); }
    &--merged { background: rgba(46, 160, 67, 0.15); color: #2ea043; }
    &--unmerged { background: var(--badge-bg, #eee); color: var(--text-secondary, #888); }
    &--current { background: rgba(74, 140, 255, 0.15); color: #4a8cff; }
  }
}
```

- [ ] **Step 3: typecheck**

Run: `cd apps/desktop && pnpm typecheck`
Expected: 无错误（若 useIpc hook 路径不同，按编译错误修正 import 路径）

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/design/components/WorktreePanel.tsx apps/desktop/src/renderer/design/components/WorktreePanel.less
git commit -m "feat(desktop): add WorktreePanel component"
```

---

## Task 11: 在 ChatInspector 挂载 WorktreePanel

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`

- [ ] **Step 1: 定位 ChatInspector 渲染分支信息处**

Run: `grep -n "branchState\|ChatInspector\b\|currentBranch" apps/desktop/src/renderer/design/views/ChatView.tsx | head`
找到 `ChatInspector` 组件内渲染分支区域的 JSX。

- [ ] **Step 2: 引入并挂载**

文件顶部 import 区加：

```typescript
import { WorktreePanel } from '../components/WorktreePanel'
```

在 `ChatInspector` 渲染分支信息的紧邻位置插入（`ChatInspector` 已能拿到 `workspace`/`sessionId`，用其传参；若无 sessionId 字段，从 props 中找当前会话 id）：

```tsx
  <WorktreePanel workspaceId={workspace?.id ?? null} sessionId={activeSessionId ?? null} />
```

> 验证点：确认 `ChatInspector` 作用域内当前会话 id 的变量名（Run: `grep -n "function ChatInspector" apps/desktop/src/renderer/design/views/ChatView.tsx` 然后阅读其 props 与内部，找到 `sessionId`/`activeSessionId`/`active` 之类）。按实际变量名传入。

- [ ] **Step 3: typecheck + 启动验证**

Run: `cd apps/desktop && pnpm typecheck`
Expected: 无错误

手动验证（启动应用）：
1. 打开一个 git 项目 → 新建会话 Composer 出现「隔离 worktree」勾选；非 git 项目则置灰
2. 勾选并发送首条消息 → `.spark/worktrees/<branch>` 被创建，会话在其中运行
3. 右侧 Inspector 的 Worktree 面板列出主工作树 + 新 worktree，新 worktree 标「当前」「未合并」
4. 点「合并」→ 会话收到合并指令 prompt
5. 删除该会话 → 弹出「是否一并删除 worktree」

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/design/views/ChatView.tsx
git commit -m "feat(desktop): mount WorktreePanel in ChatInspector"
```

---

## Task 12: 全量校验

- [ ] **Step 1: 全仓 typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 无错误

- [ ] **Step 2: 相关单测**

Run: `cd packages/agent-runtime && pnpm vitest run src/__tests__/services/git-worktree.service.test.ts src/__tests__/services/workspace.service.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: 最终提交（若有 lint 修复）**

```bash
git add -A
git commit -m "chore: lint and typecheck fixes for worktree support"
```

---

## 自检备注（实现者注意验证点汇总）

实现中以下接口名需用 grep 实地确认（计划已在对应步骤标注）：
- `SessionRepository.listSessions` 的方法名与 `workspaceId` 过滤参数形态（Task 7）
- `SessionSendTurnRequest` 的输入字段名（`input`/`message`/`text`）（Task 10）
- `workspace:reveal` 揭示文件夹的实际通道名（Task 10）
- `ChatInspector` 内当前会话 id 变量名（Task 11）
- `packages/agent-runtime/src/index.ts` barrel 是否存在（Task 3）
