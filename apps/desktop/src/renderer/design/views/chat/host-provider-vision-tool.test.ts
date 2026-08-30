import { describe, expect, it } from 'vitest'
import {
  isHostProviderVisionTool,
  parseHostProviderVisionOutput,
} from './host-provider-vision-tool'

describe('host provider vision tool helpers', () => {
  it('recognizes only the dedicated host routing tool', () => {
    expect(isHostProviderVisionTool('spark_host_provider_vision')).toBe(true)
    expect(isHostProviderVisionTool('provider_vision')).toBe(false)
  })

  it('reads trace facts from event-mapper Markdown JSON output', () => {
    expect(
      parseHostProviderVisionOutput(
        '```json\n{\n  "traceId": 42,\n  "toolId": "vision_fallback"\n}\n```',
      ),
    ).toEqual({ traceId: 42, toolId: 'vision_fallback' })
  })

  it('fails closed for non-object or malformed output', () => {
    expect(parseHostProviderVisionOutput('[1, 2]')).toEqual({})
    expect(parseHostProviderVisionOutput('not-json')).toEqual({})
  })
})
