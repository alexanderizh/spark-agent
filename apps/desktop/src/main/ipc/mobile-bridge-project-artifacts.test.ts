import { describe, expect, it } from 'vitest'
import {
  mergeProjectArtifacts,
  PROJECT_ARTIFACT_EVENT_LIMIT,
  type ProjectArtifactEventRow,
} from './mobile-bridge-project-artifacts'

function row(sessionId: string, eventJson: unknown, createdAt: string): ProjectArtifactEventRow {
  return { session_id: sessionId, event_json: JSON.stringify(eventJson), created_at: createdAt }
}

const titles = new Map([
  ['s1', '诊断会话'],
  ['s2', '报告会话'],
])

describe('mergeProjectArtifacts', () => {
  it('keeps presented_files aggregation working (old behavior parity)', () => {
    const result = mergeProjectArtifacts({
      projectId: 'p1',
      titleBySession: titles,
      presentedRows: [
        row('s1', { files: [{ path: 'G:\\ws\\报告.pdf', title: '周报' }] }, '2026-11-25 10:00:00'),
      ],
      fileChangeRows: [],
    })
    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts[0]).toMatchObject({
      path: 'G:\\ws\\报告.pdf',
      title: '周报',
      sessionId: 's1',
      sessionTitle: '诊断会话',
      presentedAt: '2026-11-25T10:00:00Z',
      presented: true,
    })
  })

  it('collects file_change events so the panel is no longer empty (Bug A)', () => {
    const result = mergeProjectArtifacts({
      projectId: 'p1',
      titleBySession: titles,
      presentedRows: [],
      fileChangeRows: [
        row('s2', { path: '.spark-agent/task-state-inbox.md', changeType: 'modify' }, '2026-11-25 09:00:00'),
        row('s2', { path: 'src/main.ts', changeType: 'modify' }, '2026-11-25 09:01:00'),
      ],
    })
    // 只有文档/多媒体扩展名进清单，代码文件不收（本地 journey 同口径）
    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts[0]).toMatchObject({
      path: '.spark-agent/task-state-inbox.md',
      sessionId: 's2',
      sessionTitle: '报告会话',
      presentedAt: '2026-11-25T09:00:00Z',
      changeTypes: ['modify'],
    })
    expect(result.artifacts[0]?.presented).toBe(false)
  })

  it('merges both sources for the same path with latest-touch attribution', () => {
    const result = mergeProjectArtifacts({
      projectId: 'p1',
      titleBySession: titles,
      presentedRows: [
        row('s1', { files: [{ path: 'G:\\ws\\report.md', title: '最终版' }] }, '2026-11-25 10:05:00'),
      ],
      fileChangeRows: [
        row('s2', { path: 'G:\\ws\\report.md', changeType: 'create' }, '2026-11-25 09:00:00'),
        row('s2', { path: 'G:\\ws\\report.md', changeType: 'modify' }, '2026-11-25 09:30:00'),
      ],
    })
    expect(result.artifacts).toHaveLength(1)
    const item = result.artifacts[0]
    expect(item?.presented).toBe(true)
    expect(item?.title).toBe('最终版')
    expect(item?.sessionId).toBe('s1')
    expect(item?.changeTypes).toEqual(['create', 'modify'])
  })

  it('prefers explicit delivery on identical timestamps', () => {
    const result = mergeProjectArtifacts({
      projectId: 'p1',
      titleBySession: titles,
      presentedRows: [
        row('s1', { files: [{ path: 'G:\\ws\\doc.md', title: '交付版' }] }, '2026-11-25 10:00:00'),
      ],
      fileChangeRows: [row('s2', { path: 'G:\\ws\\doc.md', changeType: 'create' }, '2026-11-25 10:00:00')],
    })
    const item = result.artifacts[0]
    expect(item?.sessionId).toBe('s1')
    expect(item?.title).toBe('交付版')
  })

  it('keeps explicit deliveries regardless of extension, sorted by latest first', () => {
    const result = mergeProjectArtifacts({
      projectId: 'p1',
      titleBySession: titles,
      presentedRows: [
        row('s1', { files: [{ path: 'G:\\ws\\demo.tsx' }] }, '2026-11-25 08:00:00'),
        row('s2', { files: [{ path: 'G:\\ws\\later.md' }] }, '2026-11-25 11:00:00'),
      ],
      fileChangeRows: [],
    })
    expect(result.artifacts).toHaveLength(2)
    expect(result.artifacts.map((item) => item.path)).toEqual(['G:\\ws\\later.md', 'G:\\ws\\demo.tsx'])
    expect(result.artifacts[1]?.presented).toBe(true)
  })

  it('flags truncated when a source hits the scan limit', () => {
    const rows: ProjectArtifactEventRow[] = Array.from(
      { length: PROJECT_ARTIFACT_EVENT_LIMIT },
      (_, index) =>
        row('s1', { path: `G:\\ws\\doc-${index}.md`, changeType: 'create' }, '2026-11-25 10:00:00'),
    )
    const result = mergeProjectArtifacts({
      projectId: 'p1',
      titleBySession: titles,
      presentedRows: [],
      fileChangeRows: rows,
    })
    expect(result.truncated).toBe(true)
  })

  it('falls back to a placeholder title for unknown sessions', () => {
    const result = mergeProjectArtifacts({
      projectId: 'p1',
      titleBySession: new Map(),
      presentedRows: [],
      fileChangeRows: [row('ghost', { path: 'G:\\ws\\a.md' }, '2026-11-25 10:00:00')],
    })
    expect(result.artifacts[0]?.sessionTitle).toBe('未命名会话')
  })

  it('survives malformed event payloads', () => {
    const result = mergeProjectArtifacts({
      projectId: 'p1',
      titleBySession: titles,
      presentedRows: [{ session_id: 's1', event_json: '{broken', created_at: '2026-11-25 10:00:00' }],
      fileChangeRows: [row('s2', { changeType: 'create' }, '2026-11-25 10:00:00')],
    })
    expect(result.artifacts).toHaveLength(0)
  })
})
