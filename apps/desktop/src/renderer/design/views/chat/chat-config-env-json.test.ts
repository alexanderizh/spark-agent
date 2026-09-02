import { describe, expect, it } from 'vitest'
import { parseEnvVarsJson, serializeEnvVarsJson } from './chat-config-env-json'

describe('chat config environment variable JSON', () => {
  it('serializes non-empty keys as a formatted key-value object', () => {
    expect(
      serializeEnvVarsJson([
        { key: ' API_KEY ', value: 'secret', description: 'not exported' },
        { key: '', value: 'ignored' },
        { key: 'PORT', value: '3000' },
      ]),
    ).toBe('{\n  "API_KEY": "secret",\n  "PORT": "3000"\n}')
  })

  it('uses the first value when duplicate keys are serialized, matching persistence', () => {
    expect(
      JSON.parse(
        serializeEnvVarsJson([
          { key: 'TOKEN', value: 'old' },
          { key: 'TOKEN', value: 'new' },
        ]),
      ),
    ).toEqual({ TOKEN: 'old' })
  })

  it('parses a key-value object', () => {
    expect(parseEnvVarsJson('{"API_KEY":"secret","PORT":"3000"}')).toEqual([
      { key: 'API_KEY', value: 'secret' },
      { key: 'PORT', value: '3000' },
    ])
  })

  it('parses the native array shape and preserves descriptions', () => {
    expect(
      parseEnvVarsJson('[{"key":" API_KEY ","value":"secret","description":" access token "}]'),
    ).toEqual([{ key: 'API_KEY', value: 'secret', description: 'access token' }])
  })

  it('keeps the first duplicate array item, matching persistence', () => {
    expect(
      parseEnvVarsJson('[{"key":"TOKEN","value":"first"},{"key":"TOKEN","value":"second"}]'),
    ).toEqual([{ key: 'TOKEN', value: 'first' }])
  })

  it('deduplicates object keys after trimming, matching persistence', () => {
    expect(parseEnvVarsJson('{"TOKEN":"first"," TOKEN ":"second"}')).toEqual([
      { key: 'TOKEN', value: 'first' },
    ])
  })

  it.each([
    ['', '剪贴板为空'],
    ['{oops', 'JSON 解析失败'],
    ['42', 'JSON 顶层必须是键值对象或环境变量数组'],
    ['{"PORT":3000}', '环境变量 PORT 的值必须是字符串'],
    ['[{"key":"TOKEN","value":false}]', '环境变量 TOKEN 的 value 必须是字符串'],
  ])('rejects invalid input without producing a partial import', (input, message) => {
    expect(() => parseEnvVarsJson(input)).toThrow(message)
  })
})
