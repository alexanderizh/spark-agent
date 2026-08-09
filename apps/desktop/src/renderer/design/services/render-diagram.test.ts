import { describe, expect, it } from 'vitest'
import {
  isRenderDiagramTool,
  normalizeDiagramType,
  parseRenderDiagramInput,
  parseRenderDiagramResult,
} from './render-diagram'

describe('render-diagram helpers', () => {
  it('recognizes the spark_ui render_diagram tool name (case/space tolerant)', () => {
    expect(isRenderDiagramTool('mcp__spark_ui__render_diagram')).toBe(true)
    expect(isRenderDiagramTool('  MCP__spark_ui__render_diagram ')).toBe(true)
    expect(isRenderDiagramTool('mcp__spark_ui__render_html')).toBe(false)
  })

  it('normalizes diagram type including the mindmap alias', () => {
    expect(normalizeDiagramType('markmap')).toBe('markmap')
    expect(normalizeDiagramType('Mermaid')).toBe('mermaid')
    expect(normalizeDiagramType('mindmap')).toBe('markmap')
    expect(normalizeDiagramType('graphviz')).toBeNull()
    expect(normalizeDiagramType(42)).toBeNull()
    expect(normalizeDiagramType(undefined)).toBeNull()
  })

  it('parses tool_use input and applies defaults', () => {
    expect(parseRenderDiagramInput({ type: 'mindmap', source: '# T' })).toEqual({
      diagramType: 'markmap',
      source: '# T',
      title: '思维导图',
      height: 400,
    })
    expect(parseRenderDiagramInput({ type: 'mermaid', source: 'flowchart TD' })).toEqual({
      diagramType: 'mermaid',
      source: 'flowchart TD',
      title: '图表',
      height: 400,
    })
  })

  it('clamps height into [120, 800] and rejects invalid payloads', () => {
    expect(parseRenderDiagramInput({ type: 'mermaid', source: '' })).toBeNull()
    expect(parseRenderDiagramInput({ type: 'bad', source: 'x' })).toBeNull()
    expect(parseRenderDiagramInput({ source: '# T' })).toBeNull()
    const clampedHigh = parseRenderDiagramInput({ type: 'mermaid', source: 'x', height: 99999 })
    expect(clampedHigh?.height).toBe(800)
    const clampedLow = parseRenderDiagramInput({ type: 'mermaid', source: 'x', height: 1 })
    expect(clampedLow?.height).toBe(120)
    const nonInteger = parseRenderDiagramInput({ type: 'mermaid', source: 'x', height: 300.5 })
    expect(nonInteger?.height).toBe(400)
  })

  it('parses tool_result output from wrapped MCP content', () => {
    const accepted = parseRenderDiagramResult({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            accepted: true,
            type: 'mermaid',
            source: 'flowchart TD',
            title: '图表',
            height: 300,
            warnings: [],
          }),
        },
      ],
    })
    expect(accepted).toMatchObject({ accepted: true, type: 'mermaid', height: 300 })

    const rejected = parseRenderDiagramResult({
      content: [
        { type: 'text', text: JSON.stringify({ accepted: false, reason: 'type must be one of: markmap, mermaid' }) },
      ],
    })
    expect(rejected).toMatchObject({ accepted: false, reason: expect.stringContaining('type') })

    expect(parseRenderDiagramResult(null)).toBeNull()
    expect(parseRenderDiagramResult('not json')).toBeNull()
  })
})
