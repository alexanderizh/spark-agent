import { describe, expect, it } from 'vitest'
import { buildPendingConnectionInput } from './canvasPendingConnection'

describe('buildPendingConnectionInput', () => {
  it('connects the pending source to the newly created node', () => {
    expect(
      buildPendingConnectionInput(
        { sourceNodeId: 'source-node' },
        { id: 'created-node' },
      ),
    ).toEqual({
      sourceNodeId: 'source-node',
      targetNodeId: 'created-node',
    })
  })

  it('skips when there is no pending source or created node', () => {
    expect(buildPendingConnectionInput(null, { id: 'created-node' })).toBeNull()
    expect(buildPendingConnectionInput({ sourceNodeId: 'source-node' }, null)).toBeNull()
  })

  it('skips self-connections', () => {
    expect(
      buildPendingConnectionInput(
        { sourceNodeId: 'same-node' },
        { id: 'same-node' },
      ),
    ).toBeNull()
  })

  it('ignores async menu actions until a node is actually created', () => {
    expect(buildPendingConnectionInput({ sourceNodeId: 'source-node' }, undefined)).toBeNull()
  })
})
