import { describe, expect, it } from 'vitest'
import { isSparkInstallArtifactType } from './artifact-manifest'

describe('artifact manifest types', () => {
  it('recognizes model archives as managed install artifacts', () => {
    expect(isSparkInstallArtifactType('model')).toBe(true)
    expect(isSparkInstallArtifactType('binary')).toBe(true)
    expect(isSparkInstallArtifactType('unknown')).toBe(false)
  })
})
