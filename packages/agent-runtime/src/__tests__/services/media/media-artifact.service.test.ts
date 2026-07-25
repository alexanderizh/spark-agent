import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

  it('retries a transient image download failure without regenerating the artifact', async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), 'spark-media-retry-'))
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls === 1) {
        throw new TypeError('fetch failed', { cause: new Error('read ECONNRESET') })
      }
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }) as typeof fetch

    const asset = await new MediaArtifactService({ retryDelayMs: 1 }).writeImage(
      { kind: 'url', value: 'https://media.example/signed-image.png?token=secret' },
      outputDir,
      'image',
      fetchImpl,
      5_000,
    )

    expect(calls).toBe(2)
    expect(asset.filePath).toBeDefined()
    await expect(readFile(asset.filePath!)).resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it('does not retry a deterministic HTTP 404 artifact response', async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), 'spark-media-no-retry-'))
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response('Not Found', { status: 404 })
    }) as typeof fetch

    await expect(
      new MediaArtifactService({ retryDelayMs: 1 }).writeImage(
        { kind: 'url', value: 'https://media.example/missing.png?token=secret' },
        outputDir,
        'image',
        fetchImpl,
        5_000,
      ),
    ).rejects.toMatchObject({ code: 'artifact_download_failed', statusCode: 404 })

    expect(calls).toBe(1)
  })
})
