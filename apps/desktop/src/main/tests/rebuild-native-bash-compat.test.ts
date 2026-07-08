import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('rebuild-native-for-electron.sh', () => {
  it('avoids Bash 4 associative arrays required by neither macOS nor CI', () => {
    const script = readFileSync(
      resolve(__dirname, '../../../scripts/rebuild-native-for-electron.sh'),
      'utf8',
    )

    expect(script).not.toMatch(/\bdeclare\s+-A\b/)
  })
})
