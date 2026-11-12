import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MobileBridgeEvent } from '@spark/protocol'
import { RemoteAgentArtifactStore } from './RemoteAgentArtifactStore.js'

describe('RemoteAgentArtifactStore', () => {
  let artifactRoot: string | null = null

  afterEach(async () => {
    if (artifactRoot != null) await rm(artifactRoot, { recursive: true, force: true })
    artifactRoot = null
  })

  it('distinguishes successive collaborative outputs at the same remote path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'spark-remote-artifact-'))
    artifactRoot = root
    const store = new RemoteAgentArtifactStore(() => root)
    const firstEvent = presentedFileEvent('event-first')
    const secondEvent = presentedFileEvent('event-second')

    store.indexEvent('link-a', firstEvent, firstEvent.id)
    const firstSafe = store.toSafeEvent('link-a', firstEvent, firstEvent.id)
    const firstArtifactId = firstSafe.files?.[0]?.artifactId
    if (firstArtifactId == null) throw new Error('First artifact reference was not indexed')
    const firstFile = await store.save(
      'link-a',
      'device-b',
      firstArtifactId,
      'text/plain',
      Buffer.from('first result').toString('base64'),
    )

    store.indexEvent('link-a', secondEvent, secondEvent.id)
    const secondSafe = store.toSafeEvent('link-a', secondEvent, secondEvent.id)
    const secondArtifactId = secondSafe.files?.[0]?.artifactId
    if (secondArtifactId == null) throw new Error('Second artifact reference was not indexed')
    expect(secondArtifactId).not.toBe(firstArtifactId)
    const secondFile = await store.save(
      'link-a',
      'device-b',
      secondArtifactId,
      'text/plain',
      Buffer.from('updated result').toString('base64'),
    )

    await expect(readFile(firstFile.localPath, 'utf8')).resolves.toBe('first result')
    await expect(readFile(secondFile.localPath, 'utf8')).resolves.toBe('updated result')
  })

  it('preserves legacy artifact ids when no reference scope is provided', () => {
    const store = new RemoteAgentArtifactStore(() => tmpdir())
    const event = presentedFileEvent('event-legacy')
    store.indexEvent('task-a', event)

    const safeEvent = store.toSafeEvent('task-a', event)
    const expectedId = createHash('sha256')
      .update(`task-a\u0000presented\u0000/workspace/project/report.txt`)
      .digest('hex')
      .slice(0, 32)

    expect(safeEvent.files?.[0]?.artifactId).toBe(expectedId)
  })
})

function presentedFileEvent(id: string): MobileBridgeEvent {
  return {
    id,
    seq: id === 'event-first' ? 1 : 2,
    turnId: 'turn-a',
    type: 'presented_files',
    timestamp: '2026-11-13T00:00:00.000Z',
    files: [{ path: '/workspace/project/report.txt', title: 'report.txt' }],
  }
}
