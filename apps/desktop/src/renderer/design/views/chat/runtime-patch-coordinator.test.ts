import { describe, expect, it, vi } from 'vitest'
import { RuntimePatchCoordinator } from './runtime-patch-coordinator'

type TestRuntimePatch = {
  modelId?: string | null
  providerProfileId?: string
  cliSparkOverride?: { providerProfileId: string; modelId: string } | null
}

describe('RuntimePatchCoordinator', () => {
  it('uses the latest pending selection when a turn snapshot is captured', () => {
    const coordinator = new RuntimePatchCoordinator<TestRuntimePatch>()
    coordinator.remember('session-1', { providerProfileId: 'provider-b', modelId: 'model-b' })
    coordinator.remember('session-1', { providerProfileId: 'provider-c', modelId: 'model-c' })

    expect(
      coordinator.snapshot('session-1', {
        providerProfileId: 'provider-a',
        modelId: 'model-a',
        cliSparkOverride: { providerProfileId: 'spark-a', modelId: 'spark-model-a' },
      }),
    ).toEqual({
      providerProfileId: 'provider-c',
      modelId: 'model-c',
      cliSparkOverride: { providerProfileId: 'spark-a', modelId: 'spark-model-a' },
    })
  })

  it('preserves an explicit CLI override clear in the turn snapshot', () => {
    const coordinator = new RuntimePatchCoordinator<TestRuntimePatch>()
    coordinator.remember('session-1', { cliSparkOverride: null })

    expect(
      coordinator.snapshot('session-1', {
        cliSparkOverride: { providerProfileId: 'spark-a', modelId: 'spark-model-a' },
      }),
    ).toEqual({ cliSparkOverride: null })
  })

  it('serializes writes so a rapid B to C switch is persisted in order', async () => {
    const coordinator = new RuntimePatchCoordinator<TestRuntimePatch>()
    let releaseFirstWrite: (() => void) | undefined
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const writes: Array<string | null | undefined> = []
    const write = vi.fn(async (patch: TestRuntimePatch) => {
      writes.push(patch.modelId)
      if (patch.modelId === 'model-b') await firstWriteGate
    })

    const persistB = coordinator.persist('session-1', { modelId: 'model-b' }, write)
    const persistC = coordinator.persist('session-1', { modelId: 'model-c' }, write)
    await vi.waitFor(() => expect(writes).toEqual(['model-b']))
    releaseFirstWrite?.()
    await Promise.all([persistB, persistC])

    expect(writes).toEqual(['model-b', 'model-c'])
    expect(coordinator.snapshot('session-1', { modelId: 'model-a' })).toEqual({
      modelId: 'model-a',
    })
  })

  it('does not leak a pending selection into another session', () => {
    const coordinator = new RuntimePatchCoordinator<TestRuntimePatch>()
    coordinator.remember('session-1', { modelId: 'model-b' })

    expect(coordinator.snapshot('session-2', { modelId: 'model-a' })).toEqual({
      modelId: 'model-a',
    })
  })

  it('keeps an in-flight selection when switching away and back to the session', async () => {
    const coordinator = new RuntimePatchCoordinator<TestRuntimePatch>()
    let releaseWrite: (() => void) | undefined
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })

    const persist = coordinator.persist('session-1', { modelId: 'model-b' }, async () => writeGate)
    expect(coordinator.snapshot('session-2', { modelId: 'model-c' })).toEqual({
      modelId: 'model-c',
    })
    expect(coordinator.snapshot('session-1', { modelId: 'model-a' })).toEqual({
      modelId: 'model-b',
    })

    releaseWrite?.()
    await persist
    expect(coordinator.snapshot('session-1', { modelId: 'model-b' })).toEqual({
      modelId: 'model-b',
    })
  })
})
