import { describe, expect, it } from 'vitest'
import { CanvasSnapshotWriteCoordinator } from './canvasSnapshotWriteCoordinator'

describe('CanvasSnapshotWriteCoordinator', () => {
  it('serializes writes for the same project in arrival order', async () => {
    const coordinator = new CanvasSnapshotWriteCoordinator()
    const events: string[] = []
    let releaseFirst: () => void = () => {}

    const first = coordinator.run('project-1', async () => {
      events.push('first:start')
      await new Promise<void>((resolve) => (releaseFirst = resolve))
      events.push('first:end')
      return 'first'
    })
    const second = coordinator.run('project-1', async () => {
      events.push('second:start')
      return 'second'
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst()
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('lets different projects persist independently', async () => {
    const coordinator = new CanvasSnapshotWriteCoordinator()
    const events: string[] = []
    let releaseFirst: () => void = () => {}

    const first = coordinator.run('project-1', async () => {
      await new Promise<void>((resolve) => (releaseFirst = resolve))
      events.push('project-1')
    })
    const second = coordinator.run('project-2', async () => {
      events.push('project-2')
    })

    await second
    expect(events).toEqual(['project-2'])
    releaseFirst()
    await first
  })

  it('unblocks queued writes after a failed write', async () => {
    const coordinator = new CanvasSnapshotWriteCoordinator()
    const failed = coordinator.run('project-1', async () => {
      throw new Error('save failed')
    })
    const recovered = coordinator.run('project-1', async () => 'saved')

    await expect(failed).rejects.toThrow('save failed')
    await expect(recovered).resolves.toBe('saved')
  })

  it('keeps a load inside the same project queue so a later save cannot overlap it', async () => {
    const coordinator = new CanvasSnapshotWriteCoordinator()
    const events: string[] = []
    let releaseLoad: () => void = () => {}

    const load = coordinator.run('project-1', async () => {
      events.push('load:start')
      await new Promise<void>((resolve) => (releaseLoad = resolve))
      events.push('load:end')
      return 'snapshot'
    })
    const save = coordinator.run('project-1', async () => {
      events.push('save:start')
      return 'saved'
    })

    await Promise.resolve()
    expect(events).toEqual(['load:start'])
    releaseLoad()
    await expect(Promise.all([load, save])).resolves.toEqual(['snapshot', 'saved'])
    expect(events).toEqual(['load:start', 'load:end', 'save:start'])
  })
})
