import officePreset from '@file-viewer/preset-office'
import type { ViewerOptions } from '@file-viewer/react'

export type OfficeViewerTheme = 'light' | 'dark'

const viewerDocumentBaseUrl =
  typeof document === 'undefined' ? 'http://localhost/' : document.baseURI

export const resolveFileViewerAssetUrl = (
  relativePath: string,
  baseUrl = viewerDocumentBaseUrl,
): string => new URL(`file-viewer/${relativePath}`, baseUrl).toString()

function createOfficeViewerBaseOptions(assetBaseUrl?: string) {
  const assetUrl = (relativePath: string) =>
    assetBaseUrl
      ? new URL(relativePath, assetBaseUrl.endsWith('/') ? assetBaseUrl : `${assetBaseUrl}/`).toString()
      : resolveFileViewerAssetUrl(relativePath)
  return {
  preset: officePreset,
  ui: { density: 'compact' },
  toolbar: { position: 'bottom-right', theme: false },
  archive: {
    workerUrl: assetUrl('vendor/libarchive/worker-bundle.js'),
    wasmUrl: assetUrl('vendor/libarchive/libarchive.wasm'),
  },
  cad: {
    wasmPath: assetUrl('wasm/cad/'),
    workerUrl: assetUrl('wasm/cad/dwg-worker.js'),
    dwfWasmUrl: assetUrl('wasm/cad/dwfv-render.wasm'),
  },
  data: { sqlWasmUrl: assetUrl('wasm/data/sql-wasm.wasm') },
  pdf: {
    workerUrl: assetUrl('vendor/pdf/pdf.worker.mjs'),
    cMapUrl: assetUrl('vendor/pdf/cmaps/'),
    wasmUrl: assetUrl('vendor/pdf/wasm/'),
    standardFontDataUrl: assetUrl('vendor/pdf/standard_fonts/'),
    cjkFontFallbackPath: assetUrl('vendor/pdf/fonts/'),
  },
  docx: {
    workerUrl: assetUrl('vendor/docx/docx.worker.js'),
    workerJsZipUrl: assetUrl('vendor/docx/jszip.min.js'),
  },
  spreadsheet: { workerUrl: assetUrl('vendor/xlsx/sheet.worker.js') },
  presentation: {
    workerUrl: assetUrl('vendor/pptx/pptx.worker.js'),
    pptModuleUrl: assetUrl('vendor/ppt/index.mjs'),
    pptWorkerUrl: assetUrl('vendor/ppt/worker.mjs'),
    pptWasmUrl: assetUrl('vendor/ppt/ppt-native.wasm'),
    pptFontUrl: assetUrl('vendor/ppt/ppt-font-cjk.otf'),
  },
  typst: {
    compilerWasmUrl: assetUrl('wasm/typst/typst_ts_web_compiler_bg.wasm'),
    rendererWasmUrl: assetUrl('wasm/typst/typst_ts_renderer_bg.wasm'),
  },
  } satisfies ViewerOptions
}

export const officeViewerOptions = createOfficeViewerBaseOptions()

export const createOfficeViewerOptions = (
  theme: OfficeViewerTheme,
  assetBaseUrl?: string,
): ViewerOptions => ({
  ...createOfficeViewerBaseOptions(assetBaseUrl),
  theme,
})
