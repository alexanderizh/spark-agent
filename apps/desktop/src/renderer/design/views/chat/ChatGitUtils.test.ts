import { describe, expect, it } from 'vitest'
import type { WorkspaceGitFileChange } from '@spark/protocol'
import {
  buildAgentCommitMessage,
  buildDefaultCommitMessage,
  buildDefaultExpandedTreeDirs,
  buildGitReviewTree,
  collectGitReviewTreeDirPaths,
  collectGitTreeNodeFilePaths,
  getGitChangeStageLabel,
  getGitChangeStatusCode,
  getGitChangeStatusBadgeClass,
  getGitReviewFileOpenPath,
  getGitTreeStageClass,
  isGitReviewFileOpenable,
  matchesGitReviewStageFilter,
  parseGitDiffViewSegments,
  summarizeGitSelection,
} from './ChatGitUtils'

const changes: WorkspaceGitFileChange[] = [
  {
    path: 'src/app.ts',
    status: 'M',
    staged: true,
    unstaged: false,
    untracked: false,
    additions: 3,
    deletions: 1,
  },
  {
    path: 'src/components/Button.tsx',
    status: '??',
    staged: false,
    unstaged: true,
    untracked: true,
    additions: 8,
    deletions: 0,
  },
]

describe('ChatGitUtils', () => {
  it('builds stable directory statistics and stage filters', () => {
    const tree = buildGitReviewTree(changes)

    expect(tree).toMatchObject({
      fileCount: 2,
      stagedCount: 1,
      unstagedCount: 1,
      untrackedCount: 1,
      additions: 11,
      deletions: 1,
    })
    expect(tree.children[0]).toMatchObject({ name: 'src', fileCount: 2 })
    expect(tree.children[0]?.children.map((node) => node.name)).toEqual(['components', 'app.ts'])
    expect(matchesGitReviewStageFilter(changes[0]!, 'staged')).toBe(true)
    expect(matchesGitReviewStageFilter(changes[0]!, 'unstaged')).toBe(false)
    expect(matchesGitReviewStageFilter(changes[1]!, 'unstaged')).toBe(true)
  })

  it('expands all nested directories for a small change set', () => {
    expect(buildDefaultExpandedTreeDirs(changes)).toEqual({
      '': true,
      src: true,
      'src/components': true,
    })
  })

  it('resolves reviewed files against the reviewed workspace root', () => {
    expect(getGitReviewFileOpenPath('G:\\worktrees\\feature', 'src/app.ts')).toBe(
      'G:\\worktrees\\feature\\src/app.ts',
    )
    expect(getGitReviewFileOpenPath('/worktrees/feature/', '/src/app.ts')).toBe(
      '/worktrees/feature/src/app.ts',
    )
  })

  it('does not offer opening for deleted review files', () => {
    const modifiedChange = changes[0]
    if (modifiedChange == null) throw new Error('missing modified change fixture')

    expect(isGitReviewFileOpenable(modifiedChange)).toBe(true)
    expect(isGitReviewFileOpenable({ ...modifiedChange, status: 'D' })).toBe(false)
    expect(isGitReviewFileOpenable({ ...modifiedChange, status: 'AD' })).toBe(false)
    expect(isGitReviewFileOpenable({ ...modifiedChange, status: 'DA' })).toBe(true)
  })

  it('labels baseline-only review changes as committed', () => {
    const modifiedChange = changes[0]
    if (modifiedChange == null) throw new Error('missing modified change fixture')
    const committedChange = {
      ...modifiedChange,
      staged: false,
      unstaged: false,
      untracked: false,
    }

    expect(getGitChangeStageLabel(committedChange)).toBe('已提交')
    expect(getGitTreeStageClass(committedChange)).toBe('committed')
  })

  it('preserves diff line numbers and collapses long context runs', () => {
    const segments = parseGitDiffViewSegments(
      '@@ -10,7 +20,7 @@\n one\n two\n three\n four\n five\n-old\n+new',
      4,
    )

    expect(segments[1]).toMatchObject({
      kind: 'gap',
      count: 5,
      lines: [
        { type: 'ctx', oldLn: 10, newLn: 20, text: 'one' },
        { type: 'ctx', oldLn: 11, newLn: 21, text: 'two' },
        { type: 'ctx', oldLn: 12, newLn: 22, text: 'three' },
        { type: 'ctx', oldLn: 13, newLn: 23, text: 'four' },
        { type: 'ctx', oldLn: 14, newLn: 24, text: 'five' },
      ],
    })
    expect(segments.slice(2)).toEqual([
      { kind: 'line', line: { type: 'del', oldLn: 15, newLn: undefined, text: 'old' } },
      { kind: 'line', line: { type: 'add', oldLn: undefined, newLn: 25, text: 'new' } },
    ])
  })

  it('keeps commit delegation choices in the generated prompt', () => {
    const message = buildAgentCommitMessage(false, true)

    expect(message).toContain('仅提交当前已暂存的更改')
    expect(message).toContain('git push -u origin <分支>')
    expect(message).not.toContain('git add -A')
  })

  it('scopes default commit messages to the selected paths', () => {
    const status = {
      state: {
        kind: 'ready',
        repositoryKind: 'worktree',
        runtimeSource: 'system',
        runtimeVersion: '2.50.0',
      } as const,
      isGitRepo: true,
      currentBranch: 'master',
      branches: ['master'],
      ahead: 0,
      behind: 0,
      additions: 11,
      deletions: 1,
      changedFiles: 2,
      stagedFiles: 1,
      unstagedFiles: 1,
      untrackedFiles: 1,
      hasRemote: false,
      remoteName: null,
      remoteBranch: null,
      pullRequestUrl: null,
      stashEntries: [],
      files: changes,
    }
    expect(buildDefaultCommitMessage(status)).toBe('Update src/app.ts and 1 more files')
    expect(buildDefaultCommitMessage(status, ['src/components/Button.tsx'])).toBe(
      'Update src/components/Button.tsx',
    )
    expect(buildDefaultCommitMessage(status, ['unknown/file.ts'])).toBe('Update workspace changes')
  })

  it('constrains the agent prompt to the selected file list', () => {
    const message = buildAgentCommitMessage(true, false, ['src/app.ts', 'docs/a.md'])

    expect(message).toContain('只提交下面列出的文件')
    expect(message).toContain('- src/app.ts')
    expect(message).toContain('- docs/a.md')
    expect(message).not.toContain('git add -A')
    expect(message).toContain('仅在本地提交')
  })

  it('maps porcelain statuses to short badge codes', () => {
    const [modified, untracked] = changes
    if (modified == null || untracked == null) throw new Error('missing fixture')

    expect(getGitChangeStatusCode(modified)).toBe('M')
    expect(getGitChangeStatusCode(untracked)).toBe('?')
    expect(getGitChangeStatusCode({ ...modified, status: 'D' })).toBe('D')
    expect(getGitChangeStatusCode({ ...modified, status: 'A' })).toBe('A')
    expect(getGitChangeStatusBadgeClass('?')).toBe('add')
    expect(getGitChangeStatusBadgeClass('D')).toBe('del')
    expect(getGitChangeStatusBadgeClass('M')).toBe('mod')
  })

  it('summarizes selection stats and collects folder file paths', () => {
    const tree = buildGitReviewTree(changes)
    const selected = new Set(['src/app.ts'])

    expect(summarizeGitSelection(changes, selected)).toEqual({
      count: 1,
      additions: 3,
      deletions: 1,
    })
    expect(summarizeGitSelection(changes, new Set())).toEqual({
      count: 0,
      additions: 0,
      deletions: 0,
    })
    const srcNode = tree.children[0]
    if (srcNode == null) throw new Error('missing src node')
    expect(collectGitTreeNodeFilePaths(srcNode).sort()).toEqual([
      'src/app.ts',
      'src/components/Button.tsx',
    ])
    expect(collectGitTreeNodeFilePaths(srcNode.children[0]!)).toEqual(['src/components/Button.tsx'])
  })

  it('collects every directory path (root included) for expand-all', () => {
    const tree = buildGitReviewTree(changes)

    expect(collectGitReviewTreeDirPaths(tree).sort()).toEqual(['', 'src', 'src/components'])
    expect(collectGitReviewTreeDirPaths(tree.children[0]!).sort()).toEqual([
      'src',
      'src/components',
    ])
    const fileNode = tree.children[0]?.children[1]
    if (fileNode == null) throw new Error('missing file node')
    expect(collectGitReviewTreeDirPaths(fileNode)).toEqual([])
  })
})
