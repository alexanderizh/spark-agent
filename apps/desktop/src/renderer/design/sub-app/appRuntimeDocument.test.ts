// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildAppRuntimeDocument, MAX_SUB_APP_SOURCE_LENGTH } from './appRuntimeDocument'

const baseConfig = {
  appId: '0b6f6c46-63f5-4a1e-8f74-9a92d68e6a11',
  versionId: 'draft-0b6f6c46',
  instanceId: 'inst-0001',
  mode: 'draft' as const,
  surface: 'content' as const,
}

describe('buildAppRuntimeDocument', () => {
  it('片段源码被包装成完整文档，注入 CSP、color-scheme 与 bootstrap SDK', () => {
    const doc = buildAppRuntimeDocument({
      source: '<div id="app">hello</div>',
      theme: 'dark',
      config: baseConfig,
    })
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('data-spark-theme="dark"')
    expect(doc).toContain('http-equiv="Content-Security-Policy"')
    // connect-src 关闭：数据只能走 bridge
    expect(doc).toContain("connect-src 'none'")
    // bootstrap 先于用户源码注入
    expect(doc.indexOf('window.sparkApp')).toBeLessThan(doc.indexOf('id="app"'))
    // app/ready 心跳存在于 bootstrap
    expect(doc).toContain("'app/ready'")
    // 五个新能力域命名空间已注入 SDK
    expect(doc).toContain('window.sparkApp = {')
    // 宿主主题会自动映射为 --spark-* CSS 变量，应用无需依赖具体 UI 框架。
    expect(doc).toContain('applyTheme(data.theme)')
    expect(doc).toContain('--spark-primary-color')
    expect(doc).toContain('toCssVariable')
    expect(doc).toContain('files: {')
    expect(doc).toContain('agent: {')
    expect(doc).toContain('media: {')
    expect(doc).toContain('canvas: {')
    expect(doc).toContain('browser: {')
    expect(doc).toContain('expectedRevision: expectedRevision')
  })

  it('完整文档源码在 head 内注入，不破坏原有结构', () => {
    const source =
      '<!doctype html><html lang="zh"><head><script>console.log(1)</script></head><body><p>app</p></body></html>'
    const doc = buildAppRuntimeDocument({ source, theme: 'light', config: baseConfig })
    // 属性顺序不敏感：lang 保留、主题属性存在即可
    expect(doc).toMatch(/<html[^>]*lang="zh"[^>]*>/)
    expect(doc).toMatch(/<html[^>]*data-spark-theme="light"[^>]*>/)
    const cspIndex = doc.indexOf('Content-Security-Policy')
    const userScriptIndex = doc.indexOf('console.log(1)')
    expect(cspIndex).toBeGreaterThan(-1)
    expect(userScriptIndex).toBeGreaterThan(cspIndex)
    expect(doc).toContain('<p>app</p>')
  })

  it('配置注入对 </script> 逃逸做转义，不能提前闭合 script 标签', () => {
    const doc = buildAppRuntimeDocument({
      source: '<div>x</div>',
      theme: 'light',
      config: {
        ...baseConfig,
        instanceId: '"></script><script>window.pwned=1</script>',
      },
    })
    // bootstrap script 标签本身只有一个：逃逸序列不产生新的未转义 <script>
    const scriptOpens = doc.match(/<script>/g) ?? []
    const scriptCloses = doc.match(/<\/script>/g) ?? []
    expect(scriptOpens).toHaveLength(1)
    expect(scriptCloses).toHaveLength(1)
    // 配置 JSON 内的 < > 已转义
    expect(doc).toContain('\\u003c/script\\u003e')
    expect(doc).not.toContain('"></script>')
  })

  it('超过长度上限的源码直接拒绝构建', () => {
    expect(() =>
      buildAppRuntimeDocument({
        source: 'a'.repeat(MAX_SUB_APP_SOURCE_LENGTH + 1),
        theme: 'light',
        config: baseConfig,
      }),
    ).toThrow(/上限/)
  })

  it('小窗口 surface 注入铺满兜底样式，且位于应用源码之后', () => {
    const source =
      '<!doctype html><html><head><style>#app{max-width:480px;margin:0 auto}</style></head><body><div id="app">x</div></body></html>'
    const doc = buildAppRuntimeDocument({
      source,
      theme: 'dark',
      config: { ...baseConfig, surface: 'overlay' },
    })
    // 铺满兜底：html/body 铺满 + 应用根容器去 max-width、最小高度铺满
    expect(doc).toContain('body>*:first-child{width:100%!important;max-width:none!important')
    expect(doc).toContain('html{height:100%!important}')
    // 注入在应用源码之后（!important 后置才能稳定覆盖应用声明）
    expect(doc.indexOf('max-width:none!important')).toBeGreaterThan(doc.indexOf('max-width:480px'))
    // 注入到 </body> 之前，不破坏文档结构
    expect(doc.indexOf('body>*:first-child')).toBeLessThan(doc.toLowerCase().lastIndexOf('</body>'))
  })

  it('content surface 不注入铺满兜底（全屏下居中排版合法）', () => {
    const doc = buildAppRuntimeDocument({
      source: '<div id="app">x</div>',
      theme: 'dark',
      config: baseConfig,
    })
    expect(doc).not.toContain('max-width:none!important')
  })

  it('片段源码在小窗口 surface 同样注入铺满兜底', () => {
    const doc = buildAppRuntimeDocument({
      source: '<div id="app">x</div>',
      theme: 'light',
      config: { ...baseConfig, surface: 'panel' },
    })
    expect(doc).toContain('body>*:first-child{width:100%!important')
  })
})
