import { describe, expect, it } from 'vitest'
import { prepareTurnFileSummary } from '../design/services/turn-file-summary'
import { isNestedAgentWorktreeSummaryPath } from '../design/services/turn-summary-filter'

function file(
  path: string,
  collectionSource: 'agent' | 'agent_manifest' | 'workspace_snapshot' | 'git_fallback' = 'agent',
) {
  return { path, changeType: 'modify' as const, adds: 1, dels: 0, collectionSource }
}

describe('prepareTurnFileSummary', () => {
  it('keeps direct edits visible even when they are under a generated directory', () => {
    const result = prepareTurnFileSummary([file('dist/index.html')])

    expect(result.files).toHaveLength(1)
    expect(result.generatedGroups).toHaveLength(0)
  })

  it('keeps the agent turn manifest visible without consulting workspace Git state', () => {
    const result = prepareTurnFileSummary([file('/workspace/src/reported.ts', 'agent_manifest')])

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.collectionSource).toBe('agent_manifest')
    expect(result.generatedGroups).toHaveLength(0)
  })

  it('hides snapshot changes under known generated directories as one group', () => {
    const result = prepareTurnFileSummary([
      file('/workspace/.gitnexus/parse-cache/a.json', 'workspace_snapshot'),
      file('/workspace/.gitnexus/parse-cache/b.json', 'workspace_snapshot'),
    ])

    expect(result.files).toHaveLength(0)
    expect(result.generatedGroups).toEqual([
      expect.objectContaining({
        directory: '/workspace/.gitnexus',
        fileCount: 2,
        reason: 'generated-path',
      }),
    ])
  })

  it('also hides legacy zero-stat events from generated paths', () => {
    const result = prepareTurnFileSummary([
      {
        path: '/workspace/.gitnexus/parse-cache/legacy.json',
        changeType: 'modify' as const,
        adds: 0,
        dels: 0,
      },
    ])

    expect(result.files).toHaveLength(0)
    expect(result.generatedGroups[0]).toMatchObject({
      directory: '/workspace/.gitnexus',
      fileCount: 1,
    })
  })

  it('aggregates a large low-confidence batch outside known output directories', () => {
    const result = prepareTurnFileSummary(
      Array.from({ length: 20 }, (_, index) =>
        file(`/workspace/generated-${index}.json`, 'git_fallback'),
      ),
    )

    expect(result.files).toHaveLength(0)
    expect(result.generatedGroups[0]).toMatchObject({
      directory: '/workspace',
      fileCount: 20,
      reason: 'large-batch',
    })
  })

  it('keeps small non-git fallback batches visible', () => {
    const result = prepareTurnFileSummary([
      file('/workspace/index.html', 'git_fallback'),
      file('/workspace/styles.css', 'git_fallback'),
    ])

    expect(result.files.map((item) => item.path)).toEqual([
      '/workspace/index.html',
      '/workspace/styles.css',
    ])
    expect(result.generatedGroups).toHaveLength(0)
  })

  it('filters nested agent worktrees relative to the active workspace only', () => {
    expect(
      isNestedAgentWorktreeSummaryPath(
        '/workspace/.claude/worktrees/agent-1/src/app.ts',
        '/workspace',
      ),
    ).toBe(true)
    expect(
      isNestedAgentWorktreeSummaryPath(
        '/workspace/.claude/worktrees/agent-1/src/app.ts',
        '/workspace/.claude/worktrees/agent-1',
      ),
    ).toBe(false)
    expect(isNestedAgentWorktreeSummaryPath('.worktrees/review/src/app.ts', '/workspace')).toBe(
      true,
    )
  })
})
