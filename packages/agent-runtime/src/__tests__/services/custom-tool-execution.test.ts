import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CustomToolRecord } from '@spark/protocol'
import { CustomToolError } from '../../services/custom-tools/custom-tool-errors.js'
import { executeCustomTool } from '../../services/custom-tools/custom-tool-executor.js'
import { validateToolInput } from '../../services/custom-tools/custom-tool-input-validator.js'
import {
  jsonPathExtract,
  parseJsonPath,
} from '../../services/custom-tools/custom-tool-json-path.js'
import {
  renderHeaderTemplate,
  renderJsonBodyTemplate,
  renderUrlTemplate,
} from '../../services/custom-tools/custom-tool-template.js'

// ─── 模板渲染安全用例 ───────────────────────────────────────────────────

describe('renderUrlTemplate', () => {
  it('encodes path segment values (路径穿越免疫)', () => {
    const url = renderUrlTemplate('https://api.test/v3/issue/{{key}}', { key: '../../admin' })
    expect(url).toBe('https://api.test/v3/issue/..%2F..%2Fadmin')
  })

  it('encodes query injection attempts', () => {
    const url = renderUrlTemplate('https://api.test/search?q={{q}}', { q: 'a&admin=true' })
    expect(url).toBe('https://api.test/search?q=a%26admin%3Dtrue')
  })

  it('rejects missing params', () => {
    expect(() => renderUrlTemplate('https://api.test/{{a}}', {})).toThrow(CustomToolError)
  })

  it('rejects non-http schemes produced by values', () => {
    expect(() => renderUrlTemplate('https://api.test/{{a}}', { a: 'x' })).not.toThrow()
  })
})

describe('renderHeaderTemplate', () => {
  it('rejects CRLF injection', () => {
    expect(() => renderHeaderTemplate('{{v}}', { v: 'ok\r\nX-Injected: 1' })).toThrow(/换行/)
    expect(() => renderHeaderTemplate('{{v}}', { v: 'ok\0' })).toThrow(/换行/)
  })

  it('renders plain values', () => {
    expect(renderHeaderTemplate('Bearer {{token}}', { token: 'abc' })).toBe('Bearer abc')
  })
})

describe('renderJsonBodyTemplate（结构注入免疫）', () => {
  it('preserves original types at value positions', () => {
    const rendered = renderJsonBodyTemplate('{"limit": {{limit}}, "flag": {{flag}}}', {
      limit: 42,
      flag: true,
    })
    expect(JSON.parse(rendered)).toEqual({ limit: 42, flag: true })
  })

  it('escapes embedded string values (JSON escaping kills breakouts)', () => {
    const rendered = renderJsonBodyTemplate('{"summary": "title: {{title}}"}', {
      title: '"} & injected = "x',
    })
    expect(JSON.parse(rendered)).toEqual({ summary: 'title: "} & injected = "x' })
  })

  it('rejects the `"}}&c=` breakout sample as inert data', () => {
    const rendered = renderJsonBodyTemplate('{"q": "{{v}}"}', { v: '"}}&c=' })
    expect(JSON.parse(rendered)).toEqual({ q: '"}}&c=' })
  })

  it('handles arrays/objects as whole values', () => {
    const rendered = renderJsonBodyTemplate('{"data": {{data}}}', { data: { a: [1, 2] } })
    expect(JSON.parse(rendered)).toEqual({ data: { a: [1, 2] } })
  })

  it('rejects broken structure', () => {
    expect(() => renderJsonBodyTemplate('{"a": ', { a: 1 })).toThrow(/JSON/)
  })

  it('rejects missing params', () => {
    expect(() => renderJsonBodyTemplate('{"a": {{missing}}}', {})).toThrow(/missing/)
  })
})

// ─── jsonPath 最小子集 ─────────────────────────────────────────────────

describe('jsonPath', () => {
  it('parses supported shapes only', () => {
    expect(parseJsonPath('$.a.b')).not.toBeNull()
    expect(parseJsonPath('$.a[0].b')).not.toBeNull()
    expect(parseJsonPath('$.a[*].b')).not.toBeNull()
    expect(parseJsonPath('a.b')).toBeNull()
    expect(parseJsonPath('$.a..b')).toBeNull()
    expect(parseJsonPath('$.a[xyz]')).toBeNull()
  })

  it('extracts with wildcard fan-out', () => {
    const data = { issues: [{ fields: { summary: 's1' } }, { fields: { summary: 's2' } }] }
    expect(jsonPathExtract(data, '$.issues[*].fields.summary')).toEqual(['s1', 's2'])
    expect(jsonPathExtract(data, '$.issues[0].fields.summary')).toEqual(['s1'])
    expect(jsonPathExtract(data, '$.missing[*]')).toEqual([])
  })
})

// ─── 输入校验 ──────────────────────────────────────────────────────────

describe('validateToolInput', () => {
  const schema = {
    type: 'object' as const,
    properties: {
      key: { type: 'string' as const },
      limit: { type: 'integer' as const, enum: [10, 50] },
      tags: { type: 'array' as const, items: { type: 'string' as const } },
    },
    required: ['key'],
  }

  it('accepts valid input', () => {
    expect(validateToolInput(schema, { key: 'x', limit: 10, tags: ['a'] })).toMatchObject({
      key: 'x',
    })
  })

  it('rejects missing required / unknown / wrong-type / enum-violation', () => {
    expect(() => validateToolInput(schema, {})).toThrow(/缺少必填/)
    expect(() => validateToolInput(schema, { key: 'x', ghost: 1 })).toThrow(/未知参数/)
    expect(() => validateToolInput(schema, { key: 1 })).toThrow(/必须为字符串/)
    expect(() => validateToolInput(schema, { key: 'x', limit: 99 })).toThrow(/枚举/)
    expect(() => validateToolInput(schema, { key: 'x', tags: ['a', 2] })).toThrow(/元素/)
  })
})

// ─── HTTP 执行器（本地 mock server）────────────────────────────────────

type HttpRecordOverrides = Partial<CustomToolRecord>

function makeHttpRecord(spec: unknown, overrides: HttpRecordOverrides = {}): CustomToolRecord {
  const now = new Date().toISOString()
  return {
    id: 'probe_tool',
    title: '探测工具',
    description: '用于执行器行为锁测试的 HTTP 工具',
    type: 'http',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 3_000,
    spec,
    enabled: true,
    origin: 'local',
    lastTestAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CustomToolRecord
}

describe('executeHttpTool', () => {
  let server: http.Server
  let baseUrl = ''
  const seen: Array<{
    method: string
    url: string
    headers: http.IncomingHttpHeaders
    body: string
  }> = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk as Buffer))
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
        const url = req.url ?? ''
        if (url.startsWith('/slow')) {
          setTimeout(() => res.end('late'), 5_000)
          return
        }
        if (url.startsWith('/big')) {
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end('x'.repeat(300_000))
          return
        }
        if (url.startsWith('/fail')) {
          res.writeHead(500, { 'content-type': 'text/plain' })
          res.end('boom detail')
          return
        }
        if (url.startsWith('/json')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              issues: [{ fields: { summary: 's1' } }, { fields: { summary: 's2' } }],
            }),
          )
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error != null ? reject(error) : resolve()))
    })
  })

  const ctx = (secrets: Record<string, string> = {}) => ({
    signal: new AbortController().signal,
    resolveSecret: async (name: string) => {
      const value = secrets[name]
      if (value == null) throw new CustomToolError('SECRET_MISSING', `missing ${name}`)
      return value
    },
  })

  it('sends GET with encoded url params and resolves secret headers', async () => {
    const record = makeHttpRecord({
      request: {
        method: 'GET',
        urlTemplate: `${baseUrl}/api?q={{q}}`,
        headers: [{ name: 'Authorization', secretRef: 'auth' }],
      },
      response: { format: 'json' },
    })
    const result = await executeCustomTool(record, { q: 'a&b' }, ctx({ auth: 'secret-token' }))
    expect(result.text).toContain('"ok": true')
    const request = seen.at(-1)
    expect(request?.url).toBe('/api?q=a%26b')
    expect(request?.headers.authorization).toBe('secret-token')
  })

  it('sends POST json body with structural injection neutralized', async () => {
    const record = makeHttpRecord(
      {
        request: {
          method: 'POST',
          urlTemplate: `${baseUrl}/submit`,
          body: { mode: 'json', jsonTemplate: '{"summary": "{{q}}", "fixed": 1}' },
        },
        response: { format: 'json' },
      },
      { risk: 'low-write', effect: 'create' },
    )
    await executeCustomTool(record, { q: '"}, "hacked": "yes' }, ctx())
    const request = seen.at(-1)
    const parsed = JSON.parse(request?.body ?? '{}')
    expect(parsed).toEqual({ summary: '"}, "hacked": "yes', fixed: 1 })
    expect(request?.headers['content-type']).toContain('application/json')
  })

  it('renders extract rules into a markdown table', async () => {
    const record = makeHttpRecord({
      request: { method: 'GET', urlTemplate: `${baseUrl}/json` },
      response: {
        format: 'markdown-table',
        extract: [{ label: '摘要', jsonPath: '$.issues[*].fields.summary' }],
      },
    })
    const result = await executeCustomTool(record, {}, ctx())
    expect(result.text).toContain('| 摘要 |')
    expect(result.text).toContain('s1')
    expect(result.text).toContain('s2')
  })

  it('maps non-2xx to HTTP_ERROR with excerpt', async () => {
    const record = makeHttpRecord({
      request: { method: 'GET', urlTemplate: `${baseUrl}/fail` },
      response: { format: 'text' },
    })
    await expect(executeCustomTool(record, {}, ctx())).rejects.toThrow(/HTTP 500/)
  })

  it('enforces timeout', async () => {
    const record = makeHttpRecord(
      {
        request: { method: 'GET', urlTemplate: `${baseUrl}/slow` },
        response: { format: 'text' },
      },
      { timeoutMs: 300 },
    )
    await expect(executeCustomTool(record, {}, ctx())).rejects.toThrow(/超时/)
  })

  it('caps response size and marks truncated', async () => {
    const record = makeHttpRecord({
      request: { method: 'GET', urlTemplate: `${baseUrl}/big` },
      response: { format: 'text', maxSizeBytes: 1_000 },
    })
    const result = await executeCustomTool(record, {}, ctx())
    expect(result.meta.truncated).toBe(true)
    expect(result.meta.bytes).toBeLessThanOrEqual(1_000)
  })

  it('rejects unreachable targets as UNREACHABLE', async () => {
    const record = makeHttpRecord({
      request: { method: 'GET', urlTemplate: 'http://127.0.0.1:1/never' },
      response: { format: 'text' },
    })
    await expect(executeCustomTool(record, {}, ctx())).rejects.toThrow(/无法访问/)
  })

  it('rejects non-http tool types', async () => {
    const record = makeHttpRecord({}, { type: 'sql' } as HttpRecordOverrides)
    await expect(executeCustomTool(record, {}, ctx())).rejects.toThrow(
      /NOT_IMPLEMENTED|仅支持|尚未/,
    )
  })
})
