import { describe, expect, it } from 'vitest'

const { buildNodeOptions, MIN_BUILD_HEAP_MB } =
  require('../../../../scripts/run-electron-vite-build.js') as {
    MIN_BUILD_HEAP_MB: number
    buildNodeOptions: (current?: string) => string
  }

describe('desktop build memory wrapper', () => {
  it('adds the 8 GiB heap when NODE_OPTIONS has no heap setting', () => {
    expect(MIN_BUILD_HEAP_MB).toBe(8192)
    expect(buildNodeOptions('--no-warnings')).toBe('--no-warnings --max-old-space-size=8192')
  })

  it('raises smaller heap settings used by old local and CI commands', () => {
    expect(buildNodeOptions('--max-old-space-size=4096')).toBe('--max-old-space-size=8192')
    expect(buildNodeOptions('--max_old_space_size 6144 --trace-warnings')).toBe(
      '--trace-warnings --max-old-space-size=8192',
    )
  })

  it('preserves an explicitly larger heap', () => {
    expect(buildNodeOptions('--max-old-space-size=12288')).toBe('--max-old-space-size=12288')
  })
})
