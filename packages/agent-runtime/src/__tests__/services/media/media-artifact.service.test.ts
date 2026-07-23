import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MediaArtifactService } from '../../../services/media/media-artifact.service.js'

describe('MediaArtifactService interface timeout', () => {
  let outputDir: string | undefined

  afterEach(async () => {
    if (outputDir) await rm(outputDir, { recursive: true, force: true })
  })

  it('aborts an image download using the configured interface timeout', async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), 'spark-media-timeout-'))
    const fetchImpl = ((_: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'))
        })
        setTimeout(() => reject(new Error('fallback timeout')), 20)
      })) as typeof fetch

    await expect(
      new MediaArtifactService().writeImage(
        { kind: 'url', value: 'https://media.example/image.png' },
        outputDir,
        'image',
        fetchImpl,
        5,
      ),
    ).rejects.toThrow('Download timed out after 5ms')
  })
})
