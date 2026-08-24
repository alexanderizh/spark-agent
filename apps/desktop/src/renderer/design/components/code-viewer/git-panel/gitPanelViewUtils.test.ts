import { describe, expect, it } from 'vitest'
import type { WorkspaceGitFileChange, WorkspaceGitStatusResponse } from '@spark/protocol'
import {
  buildGitPanelChangeTree,
  buildGitPanelFileLabels,
  buildGitPanelLogRefreshKey,
  formatGitRelativeTime,
  splitPendingGitChanges,
} from './gitPanelViewUtils'

function change(overrides: Partial<WorkspaceGitFileChange>): WorkspaceGitFileChange {
  return {
    path: 'a.ts',
    status: 'M',
    staged: false,
    unstaged: false,
    untracked: false,
    additions: 0,
    deletions: 0,
    ...overrides,
  }
}

describe('splitPendingGitChanges', () => {
  it('按三态标志分到已暂存 / 更改两组', () => {
    const stagedOnly = change({ path: 'staged.ts', staged: true })
    const unstagedOnly = change({ path: 'unstaged.ts', unstaged: true })
    const untrackedOnly = change({ path: 'new.ts', untracked: true, status: '??' })
    const { staged, unstaged } = splitPendingGitChanges([stagedOnly, unstagedOnly, untrackedOnly])
    expect(staged.map((f) => f.path)).toEqual(['staged.ts'])
    expect(unstaged.map((f) => f.path)).toEqual(['unstaged.ts', 'new.ts'])
  })

  it('MM（staged && unstaged）两组都出现', () => {
    const mm = change({ path: 'mm.ts', staged: true, unstaged: true })
    const { staged, unstaged } = splitPendingGitChanges([mm])
    expect(staged).toHaveLength(1)
    expect(unstaged).toHaveLength(1)
  })

  it('排除三态全 false 的已提交 baseline 项（仅供审查面板）', () => {
    const baseline = change({ path: 'committed.ts' })
    const { staged, unstaged } = splitPendingGitChanges([baseline])
    expect(staged).toHaveLength(0)
    expect(unstaged).toHaveLength(0)
  })

  it('空数组返回空分组', () => {
    expect(splitPendingGitChanges([])).toEqual({ staged: [], unstaged: [] })
  })
})

describe('buildGitPanelFileLabels', () => {
  it('basename 唯一时只显示文件名，不带目录', () => {
    const labels = buildGitPanelFileLabels(['src/renderer/app.ts', 'docs/readme.md'])
    expect(labels.get('src/renderer/app.ts')).toEqual({ name: 'app.ts', shortDir: null })
    expect(labels.get('docs/readme.md')).toEqual({ name: 'readme.md', shortDir: null })
  })

  it('同名文件自动带最短父目录（含尾部 /）消歧', () => {
    const labels = buildGitPanelFileLabels(['src/a/index.ts', 'src/b/index.ts'])
    expect(labels.get('src/a/index.ts')).toEqual({ name: 'index.ts', shortDir: 'a/' })
    expect(labels.get('src/b/index.ts')).toEqual({ name: 'index.ts', shortDir: 'b/' })
  })

  it('一段目录仍撞名时递增到两段', () => {
    const labels = buildGitPanelFileLabels([
      'src/mod/a/index.ts',
      'src/mod/b/index.ts',
      'src/mod2/a/index.ts',
    ])
    expect(labels.get('src/mod/a/index.ts')).toEqual({ name: 'index.ts', shortDir: 'mod/a/' })
    expect(labels.get('src/mod/b/index.ts')).toEqual({ name: 'index.ts', shortDir: 'mod/b/' })
    expect(labels.get('src/mod2/a/index.ts')).toEqual({ name: 'index.ts', shortDir: 'mod2/a/' })
  })

  it('根目录文件与子目录文件同名时用子目录消歧', () => {
    const labels = buildGitPanelFileLabels(['config.json', 'app/config.json'])
    expect(labels.get('config.json')).toEqual({ name: 'config.json', shortDir: null })
    expect(labels.get('app/config.json')).toEqual({ name: 'config.json', shortDir: 'app/' })
  })
})

describe('formatGitRelativeTime', () => {
  const now = Date.parse('2026-08-24T12:00:00Z')

  it('空与非法输入原样返回', () => {
    expect(formatGitRelativeTime(null, now)).toBe('')
    expect(formatGitRelativeTime(undefined, now)).toBe('')
    expect(formatGitRelativeTime('not-a-date', now)).toBe('not-a-date')
  })

  it('各时间档位', () => {
    const at = (offsetMs: number): string => new Date(now - offsetMs).toISOString()
    expect(formatGitRelativeTime(at(30_000), now)).toBe('刚刚')
    expect(formatGitRelativeTime(at(5 * 60_000), now)).toBe('5 分钟前')
    expect(formatGitRelativeTime(at(3 * 3_600_000), now)).toBe('3 小时前')
    expect(formatGitRelativeTime(at(2 * 86_400_000), now)).toBe('2 天前')
    expect(formatGitRelativeTime(at(45 * 86_400_000), now)).toBe('1 个月前')
    expect(formatGitRelativeTime(at(400 * 86_400_000), now)).toBe('1 年前')
  })

  it('未来时间按刚刚处理（clamp 到 0）', () => {
    const future = new Date(now + 60_000).toISOString()
    expect(formatGitRelativeTime(future, now)).toBe('刚刚')
  })
})

describe('buildGitPanelLogRefreshKey', () => {
  const baseStatus: WorkspaceGitStatusResponse = {
    state: {
      kind: 'ready',
      repositoryKind: 'worktree',
      runtimeSource: 'system',
      runtimeVersion: '2.50.0',
    },
    isGitRepo: true,
    currentBranch: 'master',
    branches: [],
    ahead: 0,
    behind: 0,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    stagedFiles: 0,
    unstagedFiles: 0,
    untrackedFiles: 0,
    hasRemote: true,
    remoteName: 'origin',
    remoteBranch: 'origin/master',
    pullRequestUrl: null,
    stashEntries: [],
    files: [],
  }

  it('null status 只含 tick', () => {
    expect(buildGitPanelLogRefreshKey(null, 3)).toBe('3|null')
  })

  it('影响历史的字段变化时 key 变化', () => {
    const key1 = buildGitPanelLogRefreshKey(baseStatus, 0)
    const afterCommit = buildGitPanelLogRefreshKey({ ...baseStatus, ahead: 1 }, 0)
    const afterBranch = buildGitPanelLogRefreshKey({ ...baseStatus, currentBranch: 'dev' }, 0)
    const afterTick = buildGitPanelLogRefreshKey(baseStatus, 1)
    expect(new Set([key1, afterCommit, afterBranch, afterTick]).size).toBe(4)
  })

  it('与提交历史无关的计数变化不改变 key', () => {
    const key1 = buildGitPanelLogRefreshKey(baseStatus, 0)
    const key2 = buildGitPanelLogRefreshKey(
      { ...baseStatus, unstagedFiles: 5, additions: 100, deletions: 20 },
      0,
    )
    expect(key2).toBe(key1)
  })
})

describe('buildGitPanelChangeTree', () => {
  it('深层路径逐级嵌套，目录在前文件在后', () => {
    const tree = buildGitPanelChangeTree([
      change({ path: 'src/renderer/app.ts' }),
      change({ path: 'src/util.ts' }),
      change({ path: 'readme.md' }),
    ])
    // 顶层：src（目录）在前、readme.md（文件）在后
    expect(tree.map((n) => (n.type === 'dir' ? n.name : n.change.path))).toEqual([
      'src',
      'readme.md',
    ])
    const src = tree[0]
    expect(src?.type).toBe('dir')
    if (src?.type !== 'dir') return
    expect(src.fileCount).toBe(2)
    expect(src.children.map((c) => (c.type === 'dir' ? c.name : c.change.path))).toEqual([
      'renderer',
      'src/util.ts',
    ])
    const renderer = src.children[0]
    expect(renderer?.type).toBe('dir')
    if (renderer?.type !== 'dir') return
    expect(renderer.fileCount).toBe(1)
    expect(renderer.children[0]?.type).toBe('file')
  })

  it('目录路径作为折叠 key 唯一（同名兄弟目录不冲突）', () => {
    const tree = buildGitPanelChangeTree([
      change({ path: 'a/shared/x.ts' }),
      change({ path: 'b/shared/y.ts' }),
    ])
    const paths = tree
      .filter((n): n is Extract<typeof n, { type: 'dir' }> => n.type === 'dir')
      .flatMap((d) => d.children)
      .filter((c): c is Extract<typeof c, { type: 'dir' }> => c.type === 'dir')
      .map((d) => d.path)
    expect(paths).toEqual(['a/shared', 'b/shared'])
  })

  it('同级按名称字典序排序', () => {
    const tree = buildGitPanelChangeTree([
      change({ path: 'zeta/a.ts' }),
      change({ path: 'alpha/a.ts' }),
      change({ path: 'mid/a.ts' }),
    ])
    expect(tree.map((n) => (n.type === 'dir' ? `${n.name}/` : n.change.path))).toEqual([
      'alpha/',
      'mid/',
      'zeta/',
    ])
  })

  it('空数组返回空树', () => {
    expect(buildGitPanelChangeTree([])).toEqual([])
  })
})
