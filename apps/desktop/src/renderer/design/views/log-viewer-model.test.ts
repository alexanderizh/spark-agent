import { describe, expect, it } from 'vitest'
import { buildLogReadRequest } from './log-viewer-model.js'

describe('buildLogReadRequest', () => {
  it('requests the dedicated canvas scope together with a level filter', () => {
    expect(buildLogReadRequest('canvas', 'warn')).toEqual({
      maxLines: 500,
      scope: 'canvas',
      levels: ['warn'],
    })
  })

  it('omits optional filters for the all-logs view', () => {
    expect(buildLogReadRequest('all', 'all')).toEqual({ maxLines: 500 })
  })
})
