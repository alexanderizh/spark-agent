import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../../services/event-mapper'
import { reorderChatTurnSummaryBlocks } from './chat-turn-summary-order'

describe('reorderChatTurnSummaryBlocks', () => {
  it('keeps an application snapshot at the point where the tool produced it', () => {
    const blocks: UIBlock[] = [
      { kind: 'text', content: 'Inspecting the application.', isStreaming: false },
      {
        kind: 'application_snapshot',
        snapshotId: 'snapshot-1',
        previewUrl: `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`,
        appName: '哔哩哔哩',
        windowTitle: '搜索',
        capturedAt: '2026-08-02T00:00:00.000Z',
      },
      { kind: 'text', content: 'Found the search box.', isStreaming: false },
      { kind: 'presented_files', files: [{ path: '/workspace/result.md' }] },
    ]

    expect(reorderChatTurnSummaryBlocks(blocks).map((block) => block.kind)).toEqual([
      'text',
      'application_snapshot',
      'text',
      'presented_files',
    ])
  })
})
