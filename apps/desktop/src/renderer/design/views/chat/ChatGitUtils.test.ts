import { describe, expect, it } from 'vitest'
import type { WorkspaceGitFileChange } from '@spark/protocol'
import {
  buildAgentCommitMessage,
  buildDefaultExpandedTreeDirs,
  buildGitReviewTree,
  getGitChangeStageLabel,
  getGitReviewFileOpenPath,
  getGitTreeStageClass,
  isGitReviewFileOpenable,
  matchesGitReviewStageFilter,
  parseGitDiffViewSegments,
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
    expect(tree.children[0]?.children.map((node) => node.name)).toEqual([
      'components',
      'app.ts',
    ])
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
})
