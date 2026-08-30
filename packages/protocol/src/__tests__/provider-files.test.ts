import { describe, expect, it } from 'vitest'
import { ProviderFilesIpcSchemaRegistry } from '../provider-files.js'

describe('provider files IPC schemas', () => {
  it('accepts the official Volcengine upload fields', () => {
    expect(
      ProviderFilesIpcSchemaRegistry['provider:files:upload'].parse({
        providerProfileId: 'profile-1',
        url: 'tos://source/videos/clip.mp4',
        purpose: 'user_data',
        expireAt: 1_800_000_000,
        tos: { bucket: 'target', prefix: 'arkfiles/' },
        preprocessVideo: {
          fps: 0.3,
          model: 'doubao-seed-1-8-251228',
          maxVideoTokens: 200_000,
          minFrameTokens: 32,
          maxFrameTokens: 256,
          minFrames: 16,
        },
      }),
    ).toMatchObject({ purpose: 'user_data' })
  })

  it('requires exactly one upload source and rejects unverified purpose values', () => {
    const schema = ProviderFilesIpcSchemaRegistry['provider:files:upload']
    expect(schema.safeParse({ providerProfileId: 'profile-1' }).success).toBe(false)
    expect(
      schema.safeParse({
        providerProfileId: 'profile-1',
        filePath: '/tmp/a.pdf',
        url: 'https://example.com/a.pdf',
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        providerProfileId: 'profile-1',
        url: 'https://example.com/a.pdf',
        purpose: 'assistants',
      }).success,
    ).toBe(false)
  })
})
