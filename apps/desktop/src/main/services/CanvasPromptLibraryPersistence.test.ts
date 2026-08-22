import { describe, expect, it } from 'vitest'
import { preserveCanvasProjectPrompts } from './CanvasPromptLibraryPersistence.js'

function safeFileUrl(filePath: string): string {
  const encoded = Buffer.from(filePath, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}

describe('preserveCanvasProjectPrompts', () => {
  it('moves project prompts to the global library and materializes safe-file covers', async () => {
    const result = await preserveCanvasProjectPrompts(
      'project-1',
      {
        assets: [
          {
            id: 'cover-1',
            mimeType: 'image/png',
            url: safeFileUrl('/allowed/cover.png'),
            metadata: { kind: 'image' },
          },
          {
            id: 'prompt-1',
            title: '主角提示词',
            contentText: '红色风衣，电影光影',
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-03T00:00:00.000Z',
            metadata: {
              kind: 'prompt_library',
              tags: ['人物'],
              attributes: {
                promptCategory: '人物',
                coverAssetId: 'cover-1',
              },
            },
          },
        ],
      },
      { version: 1, categories: ['人物'], items: [], legacyMigrated: false },
      {
        isAllowedPath: (filePath) => filePath === '/allowed/cover.png',
        readFile: async () => Buffer.from('png-bytes'),
      },
    )

    expect(result.changed).toBe(true)
    expect(result.migratedCount).toBe(1)
    expect(result.state.items[0]).toMatchObject({
      id: 'legacy:project-1:prompt-1',
      title: '主角提示词',
      category: '人物',
      tags: ['人物'],
      coverMimeType: 'image/png',
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    expect(result.state.items[0]?.coverUrl).toBe('data:image/png;base64,cG5nLWJ5dGVz')
  })

  it('fails before deletion when a referenced local cover cannot be read', async () => {
    await expect(
      preserveCanvasProjectPrompts(
        'project-1',
        {
          assets: [
            {
              id: 'prompt-1',
              contentText: 'prompt',
              metadata: {
                kind: 'prompt_library',
                attributes: {
                  coverUrl: safeFileUrl('/allowed/missing.png'),
                  coverMimeType: 'image/png',
                },
              },
            },
          ],
        },
        null,
        {
          isAllowedPath: () => true,
          readFile: async () => {
            throw new Error('missing')
          },
        },
      ),
    ).rejects.toThrow('已中止项目删除')
  })
})
