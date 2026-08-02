import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createOfficeViewerOptions,
  officeViewerOptions,
  resolveFileViewerAssetUrl,
} from './officeViewerOptions'

const component = readFileSync(new URL('./OfficeFileViewer.tsx', import.meta.url), 'utf8')

describe('officeViewerOptions', () => {
  it('explicitly assembles the Word, spreadsheet, and presentation renderers', () => {
    const rendererIds = officeViewerOptions.preset.renderers.map((renderer) => renderer.id)
    const supportedExtensions = officeViewerOptions.preset.renderers.flatMap((renderer) =>
      (renderer.definitions ?? []).flatMap((definition) => definition.extensions),
    )

    expect(rendererIds).toEqual(
      expect.arrayContaining([
        'file-viewer-renderer-word',
        'file-viewer-renderer-spreadsheet',
        'file-viewer-renderer-presentation',
      ]),
    )
    expect(supportedExtensions).toEqual(expect.arrayContaining(['docx', 'xlsx', 'pptx']))
  })

  it('keeps Office workers on packaged same-origin assets', () => {
    expect(officeViewerOptions.docx.workerUrl).toBe(
      'http://localhost/file-viewer/vendor/docx/docx.worker.js',
    )
    expect(officeViewerOptions.docx.workerJsZipUrl).toBe(
      'http://localhost/file-viewer/vendor/docx/jszip.min.js',
    )
    expect(officeViewerOptions.spreadsheet.workerUrl).toBe(
      'http://localhost/file-viewer/vendor/xlsx/sheet.worker.js',
    )
    expect(officeViewerOptions.presentation.workerUrl).toBe(
      'http://localhost/file-viewer/vendor/pptx/pptx.worker.js',
    )
    expect(officeViewerOptions.presentation.pptModuleUrl).toBe(
      'http://localhost/file-viewer/vendor/ppt/index.mjs',
    )
  })

  it('resolves packaged assets beside the Electron renderer entry', () => {
    expect(
      resolveFileViewerAssetUrl(
        'vendor/docx/docx.worker.js',
        'file:///C:/Program%20Files/SparkWork/resources/app.asar/out/renderer/index.html',
      ),
    ).toBe(
      'file:///C:/Program%20Files/SparkWork/resources/app.asar/out/renderer/file-viewer/vendor/docx/docx.worker.js',
    )
  })

  it('can point every Office worker at an installed capability asset root', () => {
    const options = createOfficeViewerOptions('dark', 'capability-asset://office-viewer/')
    expect(options.docx?.workerUrl).toBe(
      'capability-asset://office-viewer/vendor/docx/docx.worker.js',
    )
    expect(options.presentation?.pptWasmUrl).toBe(
      'capability-asset://office-viewer/vendor/ppt/ppt-native.wasm',
    )
  })

  it('uses compact viewer chrome so the floating toolbar stays inside narrow panels', () => {
    expect(officeViewerOptions.ui.density).toBe('compact')
    expect(officeViewerOptions.toolbar.position).toBe('bottom-right')
    expect(officeViewerOptions.toolbar.theme).toBe(false)
  })

  it('uses the resolved application theme instead of the operating-system theme', () => {
    expect(createOfficeViewerOptions('light').theme).toBe('light')
    expect(createOfficeViewerOptions('dark').theme).toBe('dark')
    expect(officeViewerOptions).not.toHaveProperty('theme')
    expect(component).toContain('const resolvedTheme = useResolvedTheme()')
    expect(component).toContain(
      "createOfficeViewerOptions(viewerTheme, 'capability-asset://office-viewer/')",
    )
    expect(component).toContain('viewerRef.current?.getViewState()')
    expect(component).toContain('viewerRef.current?.applyViewState(pendingViewState')
    expect(component).toContain('office?.error')
    expect(component).toContain('setInstallError')
    expect(component).toContain('refreshCapabilities(true)')
    expect(component).toContain('正在检查当前平台可用的 Office 预览资源')
  })
})
