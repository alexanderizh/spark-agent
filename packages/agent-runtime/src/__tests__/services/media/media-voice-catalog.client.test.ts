import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VOICE_CATALOG_TEMPLATES } from '@spark/protocol'
import {
  extractVoiceCatalog,
  fetchVoiceCatalogByPlan,
  hasVoiceCatalogOverrides,
  pickPath,
  resolveVoiceCatalogRequest,
} from '../../../services/media/media-voice-catalog.client.js'

vi.mock('@spark/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spark/shared')>()
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }
})

const minimaxDefaults = VOICE_CATALOG_TEMPLATES.minimax
const zhipuDefaults = VOICE_CATALOG_TEMPLATES.zhipu

describe('hasVoiceCatalogOverrides', () => {
  it('未配置、只有 templateId 都不算覆盖（保证升级后既有渠道行为不变）', () => {
    expect(hasVoiceCatalogOverrides(undefined)).toBe(false)
    expect(hasVoiceCatalogOverrides({})).toBe(false)
    expect(hasVoiceCatalogOverrides({ templateId: 'minimax' })).toBe(false)
    expect(hasVoiceCatalogOverrides({ headers: {}, privateListPaths: [] })).toBe(false)
  })

  it('任一实质字段都算覆盖', () => {
    expect(hasVoiceCatalogOverrides({ url: 'https://x/y' })).toBe(true)
    expect(hasVoiceCatalogOverrides({ listPath: 'data' })).toBe(true)
    expect(hasVoiceCatalogOverrides({ headers: { 'x-a': '1' } })).toBe(true)
    expect(hasVoiceCatalogOverrides({ privateFlagValues: ['PRIVATE'] })).toBe(true)
    expect(hasVoiceCatalogOverrides({ method: 'GET' })).toBe(true)
  })
})

describe('resolveVoiceCatalogRequest', () => {
  it('模板默认值 + 渠道 Base URL 拼出请求地址（MiniMax 会吃掉重复的 /v1）', () => {
    const plan = resolveVoiceCatalogRequest({
      templateId: 'minimax',
      defaults: minimaxDefaults,
      config: undefined,
      apiEndpoint: 'https://api.minimaxi.com/v1',
      action: '同步音色',
    })
    expect(plan.url).toBe('https://api.minimaxi.com/v1/get_voice')
    expect(plan.method).toBe('POST')
    expect(plan.body).toBe('{"voice_type":"all"}')
    expect(plan.headers.authorization).toBe('Bearer {{apiKey}}')
    expect(plan.listPath).toBe('system_voice')
    expect(plan.valueField).toBe('voice_id')
    expect(plan.privateListPaths).toEqual(['voice_cloning', 'voice_generation'])
  })

  it('智谱模板默认路径挂在 Base 之后，不被版本段干扰', () => {
    const plan = resolveVoiceCatalogRequest({
      templateId: 'zhipu',
      defaults: zhipuDefaults,
      config: undefined,
      apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/',
      action: '同步音色',
    })
    expect(plan.url).toBe('https://open.bigmodel.cn/api/paas/v4/voice/list')
    expect(plan.method).toBe('GET')
    expect(plan.privateFlagValues).toEqual(['PRIVATE'])
  })

  it('覆盖项按字段生效，未覆盖的仍走模板默认', () => {
    const plan = resolveVoiceCatalogRequest({
      templateId: 'minimax',
      defaults: minimaxDefaults,
      config: { url: 'https://relay.example.com/voices', method: 'GET', valueField: 'id' },
      apiEndpoint: 'https://api.minimaxi.com',
      action: '同步音色',
    })
    expect(plan.url).toBe('https://relay.example.com/voices')
    expect(plan.method).toBe('GET')
    expect(plan.valueField).toBe('id')
    expect(plan.listPath).toBe('system_voice')
    expect(plan.body).toBeUndefined()
  })

  it('显式空数组不算覆盖：不会清空模板默认的私有音色路径', () => {
    // 回归：sanitizeList 曾把 `privateListPaths: []` 当成覆盖项，
    // MiniMax 的 voice_cloning / voice_generation 会被清空，私有音色全部丢失。
    const empty = resolveVoiceCatalogRequest({
      templateId: 'minimax',
      defaults: minimaxDefaults,
      config: { url: 'https://relay.example.com/voices', privateListPaths: [] },
      apiEndpoint: 'https://api.minimaxi.com',
      action: '同步音色',
    })
    expect(empty.privateListPaths).toEqual(['voice_cloning', 'voice_generation'])

    // 全空白数组与空数组同口径（与 hasVoiceCatalogOverrides 的判定一致）
    const blank = resolveVoiceCatalogRequest({
      templateId: 'minimax',
      defaults: minimaxDefaults,
      config: { url: 'https://relay.example.com/voices', privateListPaths: ['', '  '] },
      apiEndpoint: 'https://api.minimaxi.com',
      action: '同步音色',
    })
    expect(blank.privateListPaths).toEqual(['voice_cloning', 'voice_generation'])

    // 真给了值仍然照用（覆盖能力本身不能被削弱）
    const overridden = resolveVoiceCatalogRequest({
      templateId: 'minimax',
      defaults: minimaxDefaults,
      config: { url: 'https://relay.example.com/voices', privateListPaths: ['my_private'] },
      apiEndpoint: 'https://api.minimaxi.com',
      action: '同步音色',
    })
    expect(overridden.privateListPaths).toEqual(['my_private'])
  })

  it('完整 URL 渠道在没给地址时报可读错误（不猜路径）', () => {
    expect(() =>
      resolveVoiceCatalogRequest({
        templateId: 'zhipu',
        defaults: zhipuDefaults,
        config: undefined,
        apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/speech',
        apiEndpointFullUrl: true,
        action: '音色目录同步',
      }),
    ).toThrow(/完整 URL.*音色获取.*里填写完整请求地址/)
  })

  it('完整 URL 渠道给了地址即可用（用户痛点出口）', () => {
    const plan = resolveVoiceCatalogRequest({
      templateId: 'zhipu',
      defaults: zhipuDefaults,
      config: { url: 'https://open.bigmodel.cn/api/paas/v4/voice/list' },
      apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/speech',
      apiEndpointFullUrl: true,
      action: '音色目录同步',
    })
    expect(plan.url).toBe('https://open.bigmodel.cn/api/paas/v4/voice/list')
  })

  it('自定义模板缺地址 / 缺字段映射时报错', () => {
    expect(() =>
      resolveVoiceCatalogRequest({
        templateId: 'custom',
        defaults: VOICE_CATALOG_TEMPLATES.custom,
        config: undefined,
        apiEndpoint: 'https://x',
        action: '同步音色',
      }),
    ).toThrow(/需要填写请求地址/)

    expect(() =>
      resolveVoiceCatalogRequest({
        templateId: 'custom',
        defaults: VOICE_CATALOG_TEMPLATES.custom,
        config: { url: 'https://x/voices' },
        apiEndpoint: '',
        action: '同步音色',
      }),
    ).toThrow(/音色列表路径/)
  })
})

describe('extractVoiceCatalog', () => {
  it('点路径取嵌套数组，value / label 按字段映射', () => {
    const payload = {
      Result: {
        Total: 1,
        Speakers: [
          { VoiceType: 'zh_female_tianmeitaozi_uranus_bigtts', Name: '甜美桃子 2.0' },
          { VoiceType: 'zh_male_m191_uranus_bigtts', Name: 'zh_male_m191_uranus_bigtts' },
        ],
      },
    }
    const snapshot = extractVoiceCatalog(payload, {
      listPath: 'Result.Speakers',
      valueField: 'VoiceType',
      labelField: 'Name',
      privateListPaths: [],
      privateFlagValues: [],
    })
    expect(snapshot.options).toEqual([
      { value: 'zh_female_tianmeitaozi_uranus_bigtts', label: '甜美桃子 2.0' },
      // label 与 value 相同时不重复携带，避免候选里出现重复文案
      { value: 'zh_male_m191_uranus_bigtts' },
    ])
    expect(snapshot.officialCount).toBe(2)
    expect(snapshot.privateCount).toBe(0)
  })

  it('私有音色（MiniMax 形态）：私有数组按 privateListPaths 合并，排在官方之后', () => {
    const payload = {
      system_voice: [
        { voice_id: 'sys_1', voice_name: '音色一' },
        { voice_id: 'sys_2', voice_name: 'sys_2' },
      ],
      voice_cloning: [{ voice_id: 'clone_9', voice_name: '复刻音色' }],
      voice_generation: [{ voice_id: 'gen_3', voice_name: '文生音色' }],
    }
    const snapshot = extractVoiceCatalog(payload, {
      listPath: 'system_voice',
      valueField: 'voice_id',
      labelField: 'voice_name',
      privateListPaths: ['voice_cloning', 'voice_generation'],
      privateFlagValues: [],
    })
    expect(snapshot.options.map((item) => item.value)).toEqual([
      'sys_1',
      'sys_2',
      'clone_9',
      'gen_3',
    ])
    expect(snapshot.privateVoices.map((item) => item.value)).toEqual(['clone_9', 'gen_3'])
    expect(snapshot.officialCount).toBe(2)
    expect(snapshot.privateCount).toBe(2)
  })

  it('私有音色（智谱形态）：同数组按标记字段判定 voice_type=PRIVATE', () => {
    const payload = {
      voice_list: [
        { voice: 'tongtong', voice_name: '彤彤', voice_type: 'OFFICIAL' },
        { voice: 'mine_1', voice_name: '我的音色', voice_type: 'PRIVATE' },
      ],
    }
    const snapshot = extractVoiceCatalog(payload, {
      listPath: 'voice_list',
      valueField: 'voice',
      labelField: 'voice_name',
      privateListPaths: [],
      privateFlagField: 'voice_type',
      privateFlagValues: ['PRIVATE'],
    })
    expect(snapshot.options.map((item) => item.value)).toEqual(['tongtong', 'mine_1'])
    expect(snapshot.privateVoices.map((item) => item.value)).toEqual(['mine_1'])
    expect(snapshot.officialCount).toBe(1)
    expect(snapshot.privateCount).toBe(1)
  })

  it('字符串数组与重复值都能安全处理', () => {
    const snapshot = extractVoiceCatalog(['a', 'b', 'a', ''], {
      listPath: '',
      valueField: 'voice',
      privateListPaths: [],
      privateFlagValues: [],
    })
    expect(snapshot.options).toEqual([{ value: 'a' }, { value: 'b' }])
  })

  it('路径不存在时返回空候选（由调用方报可读错误）', () => {
    expect(
      extractVoiceCatalog(
        { other: [] },
        {
          listPath: 'Speakers',
          valueField: 'VoiceType',
          privateListPaths: [],
          privateFlagValues: [],
        },
      ).options,
    ).toEqual([])
  })
})

describe('fetchVoiceCatalogByPlan', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('注入 {{apiKey}}、带 content-type 发请求并解析候选', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.minimaxi.com/v1/get_voice')
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-x')
      expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
      expect(init.body).toBe('{"voice_type":"all"}')
      return new Response(
        JSON.stringify({ system_voice: [{ voice_id: 'v1', voice_name: '音色一' }] }),
        { status: 200 },
      )
    })
    const snapshot = await fetchVoiceCatalogByPlan(
      {
        templateId: 'minimax',
        url: 'https://api.minimaxi.com/v1/get_voice',
        method: 'POST',
        headers: { authorization: 'Bearer {{apiKey}}' },
        body: '{"voice_type":"all"}',
        listPath: 'system_voice',
        valueField: 'voice_id',
        labelField: 'voice_name',
        privateListPaths: [],
        privateFlagValues: [],
      },
      { apiKey: 'sk-x', fetchImpl: fetchMock as never },
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(snapshot.options).toEqual([{ value: 'v1', label: '音色一' }])
  })

  it('非 2xx 抛出可读的 MediaProviderError（IPC 层据此透传原因）', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }),
    )
    await expect(
      fetchVoiceCatalogByPlan(
        {
          templateId: 'minimax',
          url: 'https://api.minimaxi.com/v1/get_voice',
          method: 'POST',
          headers: {},
          listPath: 'system_voice',
          valueField: 'voice_id',
          privateListPaths: [],
          privateFlagValues: [],
        },
        { apiKey: 'sk-x', fetchImpl: fetchMock as never },
      ),
    ).rejects.toThrow(/HTTP 401 · .*bad key/)
  })

  it('解析不到候选时报错而不是静默成功', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await expect(
      fetchVoiceCatalogByPlan(
        {
          templateId: 'custom',
          url: 'https://x/voices',
          method: 'GET',
          headers: {},
          listPath: 'Speakers',
          valueField: 'VoiceType',
          privateListPaths: [],
          privateFlagValues: [],
        },
        { apiKey: 'sk-x', fetchImpl: fetchMock as never },
      ),
    ).rejects.toThrow(/未解析到音色/)
  })
})

describe('pickPath', () => {
  it('支持点路径与数组下标，空路径返回原值', () => {
    expect(pickPath({ a: { b: [1, 2] } }, 'a.b.1')).toBe(2)
    expect(pickPath({ a: 1 }, '')).toEqual({ a: 1 })
    expect(pickPath({ a: 1 }, 'a.b.c')).toBeUndefined()
  })
})
