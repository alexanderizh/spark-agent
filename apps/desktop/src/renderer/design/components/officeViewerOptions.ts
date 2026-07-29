import officePreset from '@file-viewer/preset-office'
import type { ViewerOptions } from '@file-viewer/react'

export type OfficeViewerTheme = 'light' | 'dark'

const viewerDocumentBaseUrl =
  typeof document === 'undefined' ? 'http://localhost/' : document.baseURI

export const resolveFileViewerAssetUrl = (
  relativePath: string,
  baseUrl = viewerDocumentBaseUrl,
): string => new URL(`file-viewer/${relativePath}`, baseUrl).toString()

export const officeViewerOptions = {
  preset: officePreset,
  ui: { density: 'compact' },
  toolbar: { position: 'bottom-right', theme: false },
  archive: {
    workerUrl: resolveFileViewerAssetUrl('vendor/libarchive/worker-bundle.js'),
    wasmUrl: resolveFileViewerAssetUrl('vendor/libarchive/libarchive.wasm'),
  },
  cad: {
    wasmPath: resolveFileViewerAssetUrl('wasm/cad/'),
    workerUrl: resolveFileViewerAssetUrl('wasm/cad/dwg-worker.js'),
    dwfWasmUrl: resolveFileViewerAssetUrl('wasm/cad/dwfv-render.wasm'),
  },
  data: { sqlWasmUrl: resolveFileViewerAssetUrl('wasm/data/sql-wasm.wasm') },
  pdf: {
    workerUrl: resolveFileViewerAssetUrl('vendor/pdf/pdf.worker.mjs'),
    cMapUrl: resolveFileViewerAssetUrl('vendor/pdf/cmaps/'),
    wasmUrl: resolveFileViewerAssetUrl('vendor/pdf/wasm/'),
    standardFontDataUrl: resolveFileViewerAssetUrl('vendor/pdf/standard_fonts/'),
    cjkFontFallbackPath: resolveFileViewerAssetUrl('vendor/pdf/fonts/'),
  },
  docx: {
    workerUrl: resolveFileViewerAssetUrl('vendor/docx/docx.worker.js'),
    workerJsZipUrl: resolveFileViewerAssetUrl('vendor/docx/jszip.min.js'),
  },
  spreadsheet: { workerUrl: resolveFileViewerAssetUrl('vendor/xlsx/sheet.worker.js') },
  presentation: {
    workerUrl: resolveFileViewerAssetUrl('vendor/pptx/pptx.worker.js'),
    pptModuleUrl: resolveFileViewerAssetUrl('vendor/ppt/index.mjs'),
    pptWorkerUrl: resolveFileViewerAssetUrl('vendor/ppt/worker.mjs'),
    pptWasmUrl: resolveFileViewerAssetUrl('vendor/ppt/ppt-native.wasm'),
    pptFontUrl: resolveFileViewerAssetUrl('vendor/ppt/ppt-font-cjk.otf'),
  },
  typst: {
    compilerWasmUrl: resolveFileViewerAssetUrl('wasm/typst/typst_ts_web_compiler_bg.wasm'),
    rendererWasmUrl: resolveFileViewerAssetUrl('wasm/typst/typst_ts_renderer_bg.wasm'),
  },
} satisfies ViewerOptions

export const createOfficeViewerOptions = (theme: OfficeViewerTheme): ViewerOptions => ({
  ...officeViewerOptions,
  theme,
})
