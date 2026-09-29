/* eslint-disable @typescript-eslint/no-require-imports -- build hooks are CommonJS modules */
import { describe, expect, it } from 'vitest'
import path from 'node:path'

const { parseSwiftBinPathOutput } = require('../../../../scripts/package-native-host.js') as {
  parseSwiftBinPathOutput: (stdout: string) => string
}

/**
 * The macOS packaging scripts used to compose the built host path by hand
 * (`.build/<arch>-apple-macosx/<config>/SparkComputerHost`). Newer SwiftPM moved
 * products to `.build/out/Products/<Config>` and left the old directory behind,
 * so that guess returned a binary built weeks earlier: the dev host deployed
 * into Electron's Resources on 2026-09-30 was a 2026-09-07 build and contained
 * none of the fixes made in between. Both scripts now ask SwiftPM for the
 * directory through `--show-bin-path`; these tests lock the parsing contract that
 * makes the resolution trustworthy.
 */
describe('native host build path resolution', () => {
  it('takes the product directory from a plain answer', () => {
    expect(
      parseSwiftBinPathOutput(
        '/repo/apps/desktop/native/macos/SparkComputerHost/.build/out/Products/Debug\n',
      ),
    ).toBe(path.join('/repo/apps/desktop/native/macos/SparkComputerHost/.build/out/Products/Debug'))
  })

  it('keeps the path when build progress precedes it', () => {
    const stdout = [
      'Building for debugging...',
      '[1/1] Planning build',
      'Build complete! (0.26s)',
      '/repo/pkg/.build/out/Products/Release',
      '',
    ].join('\n')
    expect(parseSwiftBinPathOutput(stdout)).toBe('/repo/pkg/.build/out/Products/Release')
  })

  it('rejects an empty answer instead of guessing a directory', () => {
    expect(() => parseSwiftBinPathOutput('')).toThrow(/did not report a product directory/)
    expect(() => parseSwiftBinPathOutput('Building for debugging...\n')).toThrow(
      /did not report a product directory/,
    )
  })

  it('rejects a relative answer', () => {
    expect(() => parseSwiftBinPathOutput('./.build/debug\n')).toThrow(
      /did not report a product directory/,
    )
  })
})
