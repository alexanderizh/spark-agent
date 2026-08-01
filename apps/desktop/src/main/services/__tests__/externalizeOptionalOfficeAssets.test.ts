import { describe, expect, it } from 'vitest'
import { rewriteOptionalOfficeAssetFallbacks } from '../optional-capabilities/optionalOfficeBuildAssets'

describe('optional Office build assets', () => {
  it('externalizes PPT native fallbacks from the base renderer bundle', () => {
    const source = [
      "const wasm = new URL('./ppt-native.wasm', import.meta.url)",
      'const font = new URL(`./${MANIFEST.fontPack.file}`, import.meta.url)',
      'const worker = new URL(`./${MANIFEST.workerFile}`, import.meta.url)',
    ].join('\n')

    const result = rewriteOptionalOfficeAssetFallbacks(
      source,
      '/workspace/node_modules/@file-viewer/ppt/index.mjs',
    )

    expect(result).toContain(
      "new URL('capability-asset://office-viewer/vendor/ppt/ppt-native.wasm')",
    )
    expect(result).toContain(
      "new URL('capability-asset://office-viewer/vendor/ppt/ppt-font-cjk.otf')",
    )
    expect(result).not.toContain('import.meta.url')
  })

  it('externalizes the PPTX worker fallback from the base renderer bundle', () => {
    const result = rewriteOptionalOfficeAssetFallbacks(
      "const worker = new URL('./worker/pptx.worker.js', import.meta.url)",
      '/workspace/node_modules/@file-viewer/pptx/dist/worker.js?commonjs-proxy',
    )

    expect(result).toContain(
      "new URL('capability-asset://office-viewer/vendor/pptx/pptx.worker.js')",
    )
    expect(result).not.toContain('import.meta.url')
  })

  it('fails closed when an upstream package changes its asset expression', () => {
    expect(() =>
      rewriteOptionalOfficeAssetFallbacks(
        'const changedUpstreamSource = true',
        '/workspace/node_modules/@file-viewer/ppt/index.mjs',
      ),
    ).toThrow('Upstream module changed')
  })
})
