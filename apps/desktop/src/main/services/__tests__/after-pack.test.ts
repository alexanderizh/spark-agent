import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pruneMacElectronLocales } = require('../../../../scripts/after-pack.js') as {
  pruneMacElectronLocales: (appPath: string) => Promise<{ kept: string[]; removed: number }>
}

describe('after-pack locale pruning', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('keeps only English, Simplified Chinese and Traditional Chinese', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-after-pack-'))
    const resources = join(
      root,
      'Spark Agent.app',
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources',
    )
    for (const locale of ['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj', 'de.lproj', 'ja.lproj']) {
      mkdirSync(join(resources, locale), { recursive: true })
      writeFileSync(join(resources, locale, 'locale.pak'), locale)
    }

    const result = await pruneMacElectronLocales(join(root, 'Spark Agent.app'))

    expect(result).toEqual({
      kept: ['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj'],
      removed: 2,
    })
  })
})
