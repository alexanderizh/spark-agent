import type { Plugin } from 'vite'

const OPTIONAL_OFFICE_ROOT = 'capability-asset://office-viewer/'

type Rewrite = {
  from: string
  to: string
}

const rewritesByModule = new Map<string, Rewrite[]>([
  [
    '/@file-viewer/ppt/index.mjs',
    [
      {
        from: "new URL('./ppt-native.wasm', import.meta.url)",
        to: `new URL('${OPTIONAL_OFFICE_ROOT}vendor/ppt/ppt-native.wasm')`,
      },
      {
        from: "new URL(`./${MANIFEST.fontPack.file}`, import.meta.url)",
        to: `new URL('${OPTIONAL_OFFICE_ROOT}vendor/ppt/ppt-font-cjk.otf')`,
      },
      {
        from: "new URL(`./${MANIFEST.workerFile}`, import.meta.url)",
        to: `new URL('${OPTIONAL_OFFICE_ROOT}vendor/ppt/worker.mjs')`,
      },
    ],
  ],
  [
    '/@file-viewer/pptx/dist/worker.js',
    [
      {
        from: "new URL('./worker/pptx.worker.js', import.meta.url)",
        to: `new URL('${OPTIONAL_OFFICE_ROOT}vendor/pptx/pptx.worker.js')`,
      },
    ],
  ],
])

export function rewriteOptionalOfficeAssetFallbacks(code: string, moduleId: string): string | null {
  const normalizedId = moduleId.replaceAll('\\', '/').replace(/\?.*$/, '')
  const matchingEntry = [...rewritesByModule.entries()].find(([suffix]) =>
    normalizedId.endsWith(suffix),
  )
  if (!matchingEntry) return null

  const [, rewrites] = matchingEntry
  let rewritten = code
  for (const { from, to } of rewrites) {
    if (!rewritten.includes(from)) {
      throw new Error(
        `[optional-office-assets] Upstream module changed; refusing to bundle its fallback asset: ${normalizedId}`,
      )
    }
    rewritten = rewritten.replace(from, to)
  }
  return rewritten
}

/**
 * The File Viewer renderers ship large default PPT/PPTX assets via import.meta.url.
 * Spark always supplies capability-asset:// URLs after installing office-viewer,
 * so retaining those defaults would duplicate Worker/WASM/font files in app.asar.
 */
export function externalizeOptionalOfficeAssetsPlugin(): Plugin {
  return {
    name: 'externalize-optional-office-assets',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      return rewriteOptionalOfficeAssetFallbacks(code, id)
    },
  }
}
