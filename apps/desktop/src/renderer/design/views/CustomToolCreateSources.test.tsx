import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CustomToolCreateSources, CustomToolTemplateSources } from './CustomToolCreateSources'

describe('CustomToolCreateSources', () => {
  it('keeps concrete business templates out of the top-level creation entry', () => {
    const markup = renderToStaticMarkup(
      <CustomToolCreateSources
        onBlank={vi.fn()}
        onCurl={vi.fn()}
        onCode={vi.fn()}
        onOpenTemplates={vi.fn()}
        onImportPackage={vi.fn()}
      />,
    )

    expect(markup).toContain('从空白创建')
    expect(markup).toContain('编写 TypeScript')
    expect(markup).toContain('使用模板')
    expect(markup).not.toContain('图像理解')
  })

  it('shows image understanding only inside the secondary template list', () => {
    const markup = renderToStaticMarkup(
      <CustomToolTemplateSources onHttp={vi.fn()} onVision={vi.fn()} />,
    )

    expect(markup).toContain('HTTP API')
    expect(markup).toContain('图像理解')
    expect(markup).toContain('参考模板')
  })
})
