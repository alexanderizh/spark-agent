/**
 * ModelService.embed() 单元测试
 *
 * 重点覆盖 embeddings 响应解析的多格式兼容：
 *   - OpenAI 标准：{ data: [{ embedding, index }] }
 *   - 智谱原生（embedding-3 较新后端）：{ vectors: number[][], base_resp? }
 *
 * embed() 的契约：永不抛异常，鉴权/网络/解析失败一律返回 { available: false, reason }。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { ModelService } from '../../services/model.service.js'

vi.mock('@spark/shared', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@spark/shared/keystore', () => ({
  getSecret: vi.fn(async () => 'test-key'),
}))

// ─── 测试夹具 ────────────────────────────────────────────────────────────

const PROVIDER_ID = 'prov-1'
const MODEL = 'embedding-3'
const API_KEY = 'test-key'

function makeService() {
  // providerRepo.get(id) 返回带 keystore_ref + config_json 的 row
  const providerRepo = {
    get: vi.fn(() => ({
      id: PROVIDER_ID,
      keystore_ref: 'keychain:zhipu',
      config_json: JSON.stringify({ apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4' }),
    })),
  }
  // settingsGet 返回 embedding 配置
  const settingsGet = vi.fn((category: string, key: string) => {
    if (category === 'memory' && key === 'embeddingProviderId') return PROVIDER_ID
    if (category === 'memory' && key === 'embeddingModel') return MODEL
    return null
  })
  // keystore.getSecret —— 通过全局 mock 注入（见下方 vi.mock）
  const repo = { ensureSchema: vi.fn() }
  const svc = new ModelService(repo as never, providerRepo as never, settingsGet as never)
  return { svc, providerRepo }
}

/** 构造一个 fetch response 桩 */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

// ─── 测试用例 ────────────────────────────────────────────────────────────

describe('ModelService.embed — embeddings response parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('解析 OpenAI 标准格式 { data: [{ embedding, index }] }', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3] },
          { index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
        model: MODEL,
        object: 'list',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }),
    )
    const { svc } = makeService()
    const r = await svc.embed(['hello', 'world'])
    expect(r.available).toBe(true)
    if (r.available) {
      expect(r.dimension).toBe(3)
      expect(r.vectors).toHaveLength(2)
      expect(r.vectors[0]).toEqual([0.1, 0.2, 0.3])
      expect(r.vectors[1]).toEqual([0.4, 0.5, 0.6])
      expect(r.model).toBe(MODEL)
    }
    // 确认请求体使用 array input
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.input).toEqual(['hello', 'world'])
  })

  it('OpenAI 格式按 index 排序对齐输入顺序', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        // 故意把 index=1 放前面，验证按 index 排序
        data: [
          { index: 1, embedding: [0.4, 0.5] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    )
    const { svc } = makeService()
    const r = await svc.embed(['first', 'second'])
    expect(r.available).toBe(true)
    if (r.available) {
      expect(r.vectors[0]).toEqual([0.1, 0.2])
      expect(r.vectors[1]).toEqual([0.4, 0.5])
    }
  })

  it('解析智谱原生格式 { vectors: number[][], base_resp } ', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        vectors: [
          [0.1, 0.2, 0.3, 0.4],
          [0.5, 0.6, 0.7, 0.8],
        ],
        base_resp: { status_code: 0, status_msg: 'ok' },
      }),
    )
    const { svc } = makeService()
    const r = await svc.embed(['a', 'b'])
    expect(r.available).toBe(true)
    if (r.available) {
      expect(r.dimension).toBe(4)
      expect(r.vectors).toHaveLength(2)
      expect(r.vectors[0]).toEqual([0.1, 0.2, 0.3, 0.4])
      expect(r.vectors[1]).toEqual([0.5, 0.6, 0.7, 0.8])
    }
  })

  it('智谱 base_resp 业务错误（HTTP 200 但 status_code≠0/200）→ available:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        vectors: [],
        base_resp: { status_code: 1301, status_msg: 'API key 不正确' },
      }),
    )
    const { svc } = makeService()
    const r = await svc.embed(['x'])
    expect(r.available).toBe(false)
    if (!r.available) {
      expect(r.reason).toContain('1301')
      expect(r.reason).toContain('API key')
    }
  })

  it('既无 data 也无 vectors → reason 携带 topKeys 便于定位', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { error: 'unknown', foo: 1 }),
    )
    const { svc } = makeService()
    const r = await svc.embed(['x'])
    expect(r.available).toBe(false)
    if (!r.available) {
      expect(r.reason).toMatch(/data\[\]|vectors\[\]/)
      expect(r.reason).toContain('topKeys')
    }
  })

  it('向量数量与输入不匹配 → available:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
          { index: 2, embedding: [0.5, 0.6] },
        ],
      }),
    )
    const { svc } = makeService()
    const r = await svc.embed(['only-one-input'])
    expect(r.available).toBe(false)
    if (!r.available) {
      expect(r.reason).toMatch(/count mismatch/i)
      expect(r.reason).toContain('expected 1')
    }
  })

  it('智谱 vectors 元素非数字数组 → available:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        vectors: [['not', 'numbers']],
        base_resp: { status_code: 0 },
      }),
    )
    const { svc } = makeService()
    const r = await svc.embed(['x'])
    expect(r.available).toBe(false)
    if (!r.available) {
      expect(r.reason).toContain('zhipu vectors')
    }
  })

  it('HTTP 非 2xx → available:false，reason 含状态码与响应体摘要', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(401, { error: { message: 'invalid api key' } }),
    )
    const { svc } = makeService()
    const r = await svc.embed(['x'])
    expect(r.available).toBe(false)
    if (!r.available) {
      expect(r.reason).toContain('HTTP 401')
    }
  })

  it('空 texts → available:false (empty input)', async () => {
    const { svc } = makeService()
    const r = await svc.embed([])
    expect(r.available).toBe(false)
    if (!r.available) expect(r.reason).toBe('empty input')
  })
})
