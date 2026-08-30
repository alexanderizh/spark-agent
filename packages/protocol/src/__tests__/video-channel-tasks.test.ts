import { describe, expect, it } from 'vitest'
import {
  isOfficialBailianEndpoint,
  isOfficialMinimaxEndpoint,
  isOfficialVolcengineArkEndpoint,
  isVideoChannelTaskQueryableProvider,
  isVideoChannelTaskStatusSupported,
  resolveVideoChannelTaskProviderKind,
} from '../video-channel-tasks.js'

describe('isOfficialVolcengineArkEndpoint', () => {
  it('识别官方火山方舟 Endpoint 的基础域名', () => {
    expect(isOfficialVolcengineArkEndpoint('https://ark.cn-beijing.volces.com/api/v3')).toBe(true)
    expect(isOfficialVolcengineArkEndpoint('https://ARK.CN-BEIJING.VOLCES.COM/api/v3')).toBe(true)
  })

  it('拒绝代理地址、查询参数域名和无效地址', () => {
    expect(
      isOfficialVolcengineArkEndpoint(
        'https://proxy.example.com/ark?target=ark.cn-beijing.volces.com',
      ),
    ).toBe(false)
    expect(isOfficialVolcengineArkEndpoint('https://ark.example.com/api/v3')).toBe(false)
    expect(isOfficialVolcengineArkEndpoint('not-a-url')).toBe(false)
  })

  it('识别阿里云百炼官方公共和工作空间域名', () => {
    expect(isOfficialBailianEndpoint('https://dashscope.aliyuncs.com/api/v1')).toBe(true)
    expect(
      resolveVideoChannelTaskProviderKind('https://workspace.cn-beijing.maas.aliyuncs.com/api/v1'),
    ).toBe('bailian')
    expect(isOfficialBailianEndpoint('https://proxy.example.com/dashscope')).toBe(false)
  })

  it('识别 MiniMax 官方视频 API 域名并拒绝代理地址', () => {
    expect(isOfficialMinimaxEndpoint('https://api.minimaxi.com')).toBe(true)
    expect(resolveVideoChannelTaskProviderKind('https://api.minimaxi.com/v2')).toBe(
      'minimax-hailuo',
    )
    expect(isOfficialMinimaxEndpoint('https://proxy.example.com/api.minimaxi.com')).toBe(false)
    expect(isOfficialMinimaxEndpoint('http://api.minimaxi.com')).toBe(false)
  })

  it('only exposes MiniMax H3 providers to the V2 task list', () => {
    expect(
      isVideoChannelTaskQueryableProvider(
        { defaultModel: 'MiniMax-H3', modelIds: ['MiniMax-H3'] },
        'https://api.minimaxi.com',
      ),
    ).toBe(true)
    expect(
      isVideoChannelTaskQueryableProvider(
        { defaultModel: 'MiniMax-Hailuo-2.3', modelIds: ['MiniMax-Hailuo-2.3'] },
        'https://api.minimaxi.com',
      ),
    ).toBe(false)
    expect(isVideoChannelTaskStatusSupported('bailian', 'expired')).toBe(false)
    expect(isVideoChannelTaskStatusSupported('volcengine-ark', 'expired')).toBe(true)
  })
})
