import { describe, expect, it } from 'vitest'

import { assertEngineProviderCompatible } from '../../services/session/session-pure-utils.js'

describe('assertEngineProviderCompatible', () => {
  it('codex 引擎 × Anthropic 协议渠道：快速失败并给出中文指引（语音会话 403 根因组合）', () => {
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'codex',
        providerType: 'anthropic',
        providerName: '火山方舟 Coding Plan',
      }),
    ).toThrowError(/Codex.*Anthropic 协议/u)
  })

  it('claude 引擎 × OpenAI 系协议渠道：快速失败（远程 use-channel 换渠道不同步引擎的组合）', () => {
    for (const providerType of ['openai', 'openai-compatible', 'deepseek', 'ollama']) {
      expect(() =>
        assertEngineProviderCompatible({
          adapterKind: 'claude-sdk',
          providerType,
          providerName: 'OpenCode',
        }),
      ).toThrowError(/Claude.*OpenAI 系协议/u)
    }
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'claude',
        providerType: 'openai',
        providerName: 'OpenCode',
      }),
    ).toThrowError(/Claude.*OpenAI 系协议/u)
  })

  it('引擎与协议匹配的组合一律放行', () => {
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'claude-sdk',
        providerType: 'anthropic',
        providerName: '方舟',
      }),
    ).not.toThrow()
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'claude',
        providerType: 'anthropic',
        providerName: '方舟',
      }),
    ).not.toThrow()
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'codex',
        providerType: 'openai',
        providerName: 'OpenCode',
      }),
    ).not.toThrow()
  })

  it('本地 CLI 内置渠道形态放行（claude CLI 行是 anthropic、codex CLI 行是 openai）', () => {
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'claude-sdk',
        providerType: 'anthropic',
        providerName: '本地 Claude CLI',
      }),
    ).not.toThrow()
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'codex',
        providerType: 'openai',
        providerName: '本地 Codex CLI',
      }),
    ).not.toThrow()
  })

  it('spark 引擎不校验（CLI 桥双协议转换，由执行器可用性把关）', () => {
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'spark',
        providerType: 'anthropic',
        providerName: '方舟',
      }),
    ).not.toThrow()
    expect(() =>
      assertEngineProviderCompatible({
        adapterKind: 'spark',
        providerType: 'openai',
        providerName: 'OpenCode',
      }),
    ).not.toThrow()
  })
})
