/**
 * VoiceAssistantService 状态机集成测试（全依赖注入 + mock native 识别）
 *
 * 覆盖 M1 关键链路：
 * 1. 唤醒 → listening → VAD final → thinking → submitTurn → delta 流式 →
 *    speaking（逐句播放指令）→ 播完 → idle(completed)
 * 2. listening 再按快捷键 → 取消 → idle
 * 3. 15s 听写超时 → idle(timeout) + 失效提示音
 * 4. speaking 打断 → cancelTurn + 停播指令 + idle(cancelled)
 * 5. 语音命令「新开会话」→ 不进会话，播报确认
 * 6. 渲染端采集失败 → idle(error)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  VoiceAssistantCaptureCommand,
  VoiceAssistantPlayCommand,
  VoiceAssistantSessionFocusEvent,
  VoiceAssistantSettings,
  VoiceAssistantStateEvent,
} from '@spark/protocol'
import { DEFAULT_VOICE_ASSISTANT_SETTINGS } from '@spark/protocol'

vi.mock('../VoiceRecognitionService.js', () => ({
  startVoiceSession: vi.fn(() => ({
    success: true,
    sessionId: 'voice-100-1',
    error: null,
  })),
  stopVoiceSession: vi.fn(() => false),
  feedVoiceAudio: vi.fn(),
}))

// TTS 产物目录操作走内存 fake（真实 fs promise 在 fake timers 下不会推进）
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
}))

// KWS 检测器整体 mock（真实模型加载依赖已安装的语音包）；
// vi.hoisted 避免 mock 工厂提升后引用未初始化变量
const kwsMocks = vi.hoisted(() => ({
  feed: vi.fn(),
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  /** 模拟 KWS 模型是否已安装（安装等待场景需要动态切换） */
  available: true,
}))
vi.mock('./WakeWordDetector.js', () => ({
  WakeWordDetector: class {
    isActive(): boolean {
      return true
    }
    start = kwsMocks.start
    stop = kwsMocks.stop
    feed = kwsMocks.feed
  },
  isWakeWordModelAvailable: () => kwsMocks.available,
}))
const kwsFeedMock = kwsMocks.feed

// 完整性服务的模型路径解析走可控 mock：真实实现查 userData 文件系统，
// 测试机是否装过 vad/refine 模型会让 installVoicePack 调用数不确定（flaky）
const integrityMocks = vi.hoisted(() => ({
  vadAvailable: true,
  refineAvailable: true,
}))
vi.mock('../VoiceIntegrityService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../VoiceIntegrityService.js')>()
  return {
    ...actual,
    resolveVoiceVadPaths: () =>
      integrityMocks.vadAvailable ? { modelPath: '/virtual/vad.onnx' } : null,
    resolveVoiceRefinePaths: () =>
      integrityMocks.refineAvailable ? { model: '/virtual/refine.onnx' } : null,
  }
})

import { VoiceAssistantService } from './VoiceAssistantService.js'
import type { VoiceAssistantRouteBinding } from '@spark/protocol'
import type { VoiceRouteBinding } from './VoiceRouteBinding.js'

interface Harness {
  service: VoiceAssistantService
  stateEvents: VoiceAssistantStateEvent[]
  sessionFocusEvents: VoiceAssistantSessionFocusEvent[]
  captureCommands: VoiceAssistantCaptureCommand[]
  playCommands: VoiceAssistantPlayCommand[]
  submitted: Array<{ sessionId: string; message: string; userMessageDisplayContent: string }>
  cancelledSessions: string[]
  recovered: Array<{ sessionId: string; turnId: string }>
  createdSessions: string[]
  listedRecent: number[]
  listedWorkspaces: number[]
  /** M4 模型候选查询的 sessionId 记录 */
  listedModels: string[]
  /** M4 updateSessionModel 调用记录 */
  modelUpdates: Array<{ sessionId: string; modelId: string }>
  bindingUpdates: Array<Record<string, unknown>>
  approvals: Array<{ requestId: string; decision: 'allow' | 'deny' }>
  route: VoiceRouteBinding
  installCalls: number[]
  /** setSessionReasoningEffort 调用记录（语音会话思考档位对齐断言用） */
  reasoningEffortSyncs: Array<{ sessionId: string; effort: string | null }>
  /** writeSettings 全量记录（迁移回写断言用） */
  settingsWrites: VoiceAssistantSettings[]
  /** 覆盖唤醒预跳窥探结果（null = 无存活绑定，不发预跳事件） */
  setPeekAliveSessionId(id: string | null): void
  setInstallImpl: (
    impl: () => Promise<{
      success: boolean
      message: string
      status?: { downloading?: boolean }
    }>,
  ) => void
}

function createHarness(
  settingsPatch: Partial<VoiceAssistantSettings> = {},
  /** 模拟 v1 存量设置：初始对象不含 noisePipelineMigrated 字段（迁移回写分支） */
  legacyV1 = false,
  /** 覆盖 TTS 相关依赖（providers / mediaRouter），供语音合成选路用例注入误声明渠道 */
  overrides: {
    providers?: Array<Record<string, unknown>>
    mediaRouter?: Record<string, unknown>
  } = {},
): Harness {
  const stateEvents: VoiceAssistantStateEvent[] = []
  const sessionFocusEvents: VoiceAssistantSessionFocusEvent[] = []
  let peekAliveSessionId: string | null = 'session-voice-1'
  const captureCommands: VoiceAssistantCaptureCommand[] = []
  const playCommands: VoiceAssistantPlayCommand[] = []
  const submitted: Harness['submitted'] = []
  const cancelledSessions: string[] = []
  const recovered: Harness['recovered'] = []
  const createdSessions: string[] = []
  const recentSessions = [
    { id: 'session-a', title: '会话A：语音助手开发' },
    { id: 'session-b', title: '会话B：画布功能' },
  ]
  const workspaces = [
    { id: 'ws-1', name: 'Spark-Agent' },
    { id: 'ws-2', name: '个人项目' },
  ]
  const listedRecent: number[] = []
  const listedWorkspaces: number[] = []
  const listedModels: string[] = []
  const modelUpdates: Harness['modelUpdates'] = []
  const bindingUpdates: Array<Record<string, unknown>> = []
  const approvals: Array<{ requestId: string; decision: 'allow' | 'deny' }> = []
  const installCalls: number[] = []
  const settingsWrites: VoiceAssistantSettings[] = []
  const reasoningEffortSyncs: Harness['reasoningEffortSyncs'] = []
  let installImpl:
    | (() => Promise<{
        success: boolean
        message: string
        status?: { downloading?: boolean }
      }>)
    | null = null
  let settings: VoiceAssistantSettings = {
    ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
    // 状态机测试不涉及门控；显式关闭避免触发 vad 模型后台补装（多调 installVoicePack）
    voiceFocus: 'off',
    ...settingsPatch,
  }
  if (legacyV1) {
    delete (settings as { noisePipelineMigrated?: boolean }).noisePipelineMigrated
    delete (settings as { refineTranscriptMigrated?: boolean }).refineTranscriptMigrated
  }

  const route: VoiceRouteBinding = {
    current: { defaultSessionId: 'session-voice-1' },
    ensureSession: async () => ({ sessionId: 'session-voice-1', created: false }),
    peekAliveSessionId: async () => peekAliveSessionId,
    createNewSession: async () => {
      createdSessions.push('session-voice-new')
      return { sessionId: 'session-voice-new' }
    },
    updateBinding: (patch: Partial<VoiceAssistantRouteBinding>) => {
      bindingUpdates.push(patch as Record<string, unknown>)
    },
    clearSession: () => undefined,
  } as unknown as VoiceRouteBinding

  let turnCounter = 0
  const service = new VoiceAssistantService({
    readSettings: () => settings,
    writeSettings: (value) => {
      settings = value
      settingsWrites.push(value)
    },
    shortcutRegistrar: {
      register: () => true,
      unregister: () => undefined,
    },
    resolveMediaProviders: async () =>
      (overrides.providers ?? [
        { id: 'p1', name: 'fake-tts', defaultModel: 'tts-1', apiKey: 'k' },
      ]) as never,
    mediaRouter: (overrides.mediaRouter ?? {
      // 既有用例的 provider 无任何声明数据，supports 恒 true 保持自动选路不缺候选
      supports: () => true,
      invoke: async () => ({
        output: {
          provider: 'fake-tts',
          model: 'tts-1',
          mode: 'sync',
          assets: [{ type: 'audio', filePath: `/tmp/va-tts-${Date.now()}-${Math.random()}.mp3` }],
        },
        providerProfileId: 'p1',
      }),
    }) as never,
    submitVoiceTurn: async (params) => {
      submitted.push(params)
      turnCounter += 1
      return { turnId: `turn-${turnCounter}`, started: true }
    },
    cancelSessionTurn: async (sessionId) => {
      cancelledSessions.push(sessionId)
    },
    recoverFinalFromHistory: async (sessionId, turnId) => {
      recovered.push({ sessionId, turnId })
      return null
    },
    route,
    sendCaptureCommand: (command) => {
      captureCommands.push(command)
    },
    sendPlayCommand: (command) => {
      playCommands.push(command)
    },
    broadcastState: (event) => {
      stateEvents.push(event)
    },
    broadcastStatus: () => undefined,
    emitSessionFocus: (event) => {
      sessionFocusEvents.push(event)
    },
    registerCleanup: () => undefined,
    ttsDir: '/tmp/voice-assistant-test-tts',
    runtimeDir: '/tmp/voice-assistant-test-runtime',
    installVoicePack: async () => {
      installCalls.push(1)
      return installImpl != null ? installImpl() : { success: true, message: 'ok' }
    },
    listRecentSessions: async (limit) => {
      listedRecent.push(limit)
      return recentSessions.slice(0, limit)
    },
    listWorkspaces: async () => {
      listedWorkspaces.push(1)
      return workspaces
    },
    findLatestSessionIdInWorkspace: async (workspaceId) =>
      workspaceId === 'ws-1' ? 'session-in-ws1' : null,
    listSessionModels: async (sessionId) => {
      listedModels.push(sessionId)
      return ['claude-sonnet-4-5', 'gpt-4o-mini']
    },
    updateSessionModel: async (sessionId, modelId) => {
      modelUpdates.push({ sessionId, modelId })
    },
    resolveApproval: (requestId, decision) => {
      approvals.push({ requestId, decision })
      return true
    },
    setSessionReasoningEffort: async (sessionId, effort) => {
      reasoningEffortSyncs.push({ sessionId, effort })
    },
    resolveAgentInfo: (agentId) =>
      agentId != null ? { adapter: 'codex', agentName: `agent-${agentId}` } : null,
  })

  return {
    service,
    stateEvents,
    sessionFocusEvents,
    captureCommands,
    playCommands,
    submitted,
    cancelledSessions,
    recovered,
    createdSessions,
    listedRecent,
    listedWorkspaces,
    listedModels,
    modelUpdates,
    bindingUpdates,
    approvals,
    route,
    installCalls,
    settingsWrites,
    reasoningEffortSyncs,
    setPeekAliveSessionId: (id: string | null) => {
      peekAliveSessionId = id
    },
    setInstallImpl: (
      impl: () => Promise<{
        success: boolean
        message: string
        status?: { downloading?: boolean }
      }>,
    ) => {
      installImpl = impl
    },
  }
}

/** 驱动一轮「唤醒→收口提交→首句 delta」链路，触发逐句 TTS 合成（synthesizeSentence）。 */
async function driveAssistantSpeech(h: Harness): Promise<void> {
  expect(h.service.wake().ok).toBe(true)
  h.service.handleRecognitionEvent({
    type: 'final',
    sessionId: 'voice-100-1',
    text: '念一句话',
  })
  await vi.advanceTimersByTimeAsync(1250)
  expect(h.service.getStatus().state).toBe('thinking')
  // 收口 flush：尾句并入 + 会话停止 → 真正 submit（activeTurn 建立后 delta 才被消费）
  h.service.handleRecognitionEvent({
    type: 'final',
    sessionId: 'voice-100-1',
    text: '好吗',
  })
  h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
  await vi.advanceTimersByTimeAsync(10)
  expect(h.submitted.length).toBe(1)
  h.service.handleTurnEvent({
    type: 'assistant_message',
    turnId: 'turn-1',
    sessionId: 'session-voice-1',
    mode: 'delta',
    content: '这是播报的第一句。',
    provider: 'p',
    isFinal: false,
  } as never)
  await vi.advanceTimersByTimeAsync(20)
}

/** 语音合成选路用例的渠道 fixtures：误声明 ASR 渠道排前、真 TTS 渠道排后。 */
function misdeclaredTtsProviders(): Array<Record<string, unknown>> {
  return [
    {
      id: 'p-asr',
      name: '误声明 ASR 渠道',
      defaultModel: 'asr-1.0',
      apiKey: 'k',
      mediaProvider: 'minimax-hailuo',
      // 渠道级误声明 audio.speech，模型 manifest 只有转写能力（回归现场）
      mediaCapabilities: ['audio.speech', 'audio.transcription'],
      mediaModelManifests: [{ capabilities: [{ id: 'audio.transcription' }] }],
    },
    {
      id: 'p-tts',
      name: '真 TTS 渠道',
      defaultModel: 'speech-1',
      apiKey: 'k',
      mediaModelManifests: [{ capabilities: [{ id: 'audio.speech' }] }],
    },
  ]
}

describe('VoiceAssistantService 状态机', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    kwsMocks.available = true
  })

  it('完整链路：唤醒→聆听→VAD final→提交→逐句播报→完成回 idle', async () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.captureCommands[0]?.action).toBe('start')
    // 唤醒提示音
    expect(h.playCommands[0]).toEqual({ kind: 'cue', cue: 'wake' })

    // VAD final → 进入说完确认窗口（防抖：不立即收口，仍可继续说）
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '今天天气怎么样',
    })
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.stateEvents.some((e) => e.reason === 'confirm')).toBe(true)
    // 确认窗口内持续静默 → 到期收口 → thinking → flush 收尾
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().state).toBe('thinking')
    expect(h.captureCommands.some((c) => c.action === 'stop')).toBe(true)
    // flush 尾句并入
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '适合出行吗',
    })
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)

    expect(h.submitted.length).toBe(1)
    expect(h.submitted[0]?.sessionId).toBe('session-voice-1')
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('今天天气怎么样 适合出行吗')
    expect(h.submitted[0]?.message).toContain('今天天气怎么样 适合出行吗')
    expect(h.submitted[0]?.message).toContain('语音助手会话')

    // assistant delta → speaking + 逐句播放
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      mode: 'delta',
      content: '今天晴，气温二十五度。',
      provider: 'p',
      isFinal: false,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    expect(h.service.getStatus().state).toBe('speaking')
    const playCommands = h.playCommands.filter((c) => c.kind === 'play')
    expect(playCommands.length).toBe(1)

    // isFinal 全文 → 尾句 + 收尾
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      mode: 'complete',
      content: '今天晴，气温二十五度。适合出行。',
      provider: 'p',
      isFinal: true,
    } as never)
    await vi.advanceTimersByTimeAsync(20)

    // completed 终态（300ms 回捞兜底）
    h.service.handleTurnEvent({
      type: 'agent_status',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      status: 'completed',
    } as never)
    await vi.advanceTimersByTimeAsync(400)
    expect(h.recovered.length).toBe(1)

    // 逐句播放结束 → idle(completed)
    const allPlay = h.playCommands.filter((c) => c.kind === 'play')
    expect(allPlay.length).toBe(2)
    for (const command of allPlay) {
      if (command.kind === 'play') {
        h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: command.sentenceId })
      }
    }
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'completed' })
  })

  it('TTS 自动选路：渠道级误声明 audio.speech 的 ASR 渠道不再抢走语音合成', async () => {
    const invoke = vi.fn(async (_request: unknown, _options: unknown) => ({
      output: {
        provider: 'fake-tts',
        model: 'speech-1',
        mode: 'sync',
        assets: [{ type: 'audio', filePath: '/tmp/va-tts-auto.mp3' }],
      },
      providerProfileId: 'p-tts',
    }))
    // 查表式 supports：模拟 mediaRouter.supports 对误声明 ASR 渠道拒绝、真 TTS 渠道放行
    // （supports 本体的「模型级声明优先」语义由 agent-runtime 侧测试锁定）
    const supports = vi.fn((profile: { id: string }) => profile.id === 'p-tts')
    const h = createHarness({ ttsVol: 2, ttsPitch: 3, ttsEmotion: 'happy' }, false, {
      providers: misdeclaredTtsProviders(),
      mediaRouter: { supports, invoke },
    })
    await driveAssistantSpeech(h)

    // 按候选顺序逐个查询 supports：ASR 被拒后落到真 TTS 渠道
    expect(supports.mock.calls.map((call) => call[0]?.id)).toEqual(['p-asr', 'p-tts'])
    expect(invoke).toHaveBeenCalledTimes(1)
    // 选中的是真 TTS 渠道（非 minimax-hailuo），MiniMax 专有参数不得下发；
    // 旧 OR 逻辑会误选排前的 minimax ASR 渠道，把 vol/pitch/emotion 错发给实际路由的 TTS 渠道
    const [request] = invoke.mock.calls[0] as unknown as [Record<string, unknown>, unknown]
    const modelParams = request.modelParams as Record<string, unknown> | undefined
    expect(modelParams).not.toHaveProperty('vol')
    expect(modelParams).not.toHaveProperty('pitch')
    expect(modelParams).not.toHaveProperty('emotion')
  })

  it('TTS 显式指定渠道：不经 supports 门控，MiniMax 参数仍按渠道类型下发', async () => {
    const invoke = vi.fn(async (_request: unknown, _options: unknown) => ({
      output: {
        provider: 'fake-tts',
        model: 'asr-1.0',
        mode: 'sync',
        assets: [{ type: 'audio', filePath: '/tmp/va-tts-explicit.mp3' }],
      },
      providerProfileId: 'p-asr',
    }))
    const supports = vi.fn(() => true)
    const h = createHarness(
      { ttsProviderProfileId: 'p-asr', ttsVol: 2, ttsPitch: 3, ttsEmotion: 'happy' },
      false,
      { providers: misdeclaredTtsProviders(), mediaRouter: { supports, invoke } },
    )
    await driveAssistantSpeech(h)

    // 显式 ttsProviderProfileId 直接按 id 命中，不查 supports（既有行为不变）
    expect(supports).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledTimes(1)
    const [explicitRequest] = invoke.mock.calls[0] as unknown as [Record<string, unknown>, unknown]
    const modelParams = explicitRequest.modelParams as Record<string, unknown> | undefined
    expect(modelParams).toMatchObject({ vol: 2, pitch: 3, emotion: 'happy' })
  })

  it('识别精修：refined 全文整体替换流式拼接后提交', async () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '今天天气怎么样',
    })
    // 确认窗口静默到期 → thinking → stop（refine 模式）
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().state).toBe('thinking')
    // flush 尾句并入流式拼接
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '适合出行吗',
    })
    // SenseVoice 精修全文到达：流式两句的漏字/错字修复版，整体替换
    h.service.handleRecognitionEvent({
      type: 'refined',
      sessionId: 'voice-100-1',
      text: '今天天气怎么样？适合出行吗？',
    })
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)

    expect(h.submitted.length).toBe(1)
    // 提交的是精修全文，而非流式拼接（"今天天气怎么样 适合出行吗"）
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('今天天气怎么样？适合出行吗？')
  })

  it('v1→v2 噪音管线迁移：存量默认组合自动回退新默认并回写持久化', () => {
    // 模拟 v1 存量：上一版默认 browserDenoise=true + voiceFocus=standard，
    // 且设置文件里没有迁移标记字段
    const h = createHarness({ browserDenoise: true, voiceFocus: 'standard' }, true)
    expect(h.service.getSettings().browserDenoise).toBe(false)
    expect(h.service.getSettings().voiceFocus).toBe('off')
    expect(h.service.getSettings().refineTranscript).toBe(true)
    expect(h.service.getSettings().noisePipelineMigrated).toBe(true)
    // 迁移结果立即回写持久化（防止每次启动重复迁移/用户显式开启后被重置）
    expect(h.settingsWrites.length).toBe(1)
    expect(h.settingsWrites[0]?.noisePipelineMigrated).toBe(true)
    expect(h.settingsWrites[0]?.browserDenoise).toBe(false)
  })

  it('v1→v2 迁移：用户显式组合不回退（只置迁移标记）', () => {
    // 用户只开了降噪（voiceFocus=off）：非 v1 默认组合，视为显式选择保留
    const h = createHarness({ browserDenoise: true, voiceFocus: 'off' }, true)
    expect(h.service.getSettings().browserDenoise).toBe(true)
    expect(h.service.getSettings().voiceFocus).toBe('off')
    expect(h.service.getSettings().noisePipelineMigrated).toBe(true)
  })

  it('识别精修迁移：v1 死字段持久化的 false 自动翻回默认开并回写', () => {
    // v1 时代 refineTranscript 是无 UI 死字段（默认 false 被整体保存持久化），
    // 升级后首次构造即迁移回开（精修对识别率提升显著），并立即回写防重复迁移
    const h = createHarness({ refineTranscript: false }, true)
    expect(h.service.getSettings().refineTranscript).toBe(true)
    expect(h.service.getSettings().refineTranscriptMigrated).toBe(true)
    expect(h.settingsWrites.length).toBe(1)
    expect(h.settingsWrites[0]?.refineTranscript).toBe(true)
    expect(h.settingsWrites[0]?.refineTranscriptMigrated).toBe(true)
  })

  it('识别精修迁移：已迁移后用户显式关闭被尊重', () => {
    const h = createHarness({ refineTranscript: false, refineTranscriptMigrated: true })
    expect(h.service.getSettings().refineTranscript).toBe(false)
    // 标记已存在 → 构造时不发生迁移回写
    expect(h.settingsWrites.length).toBe(0)
  })

  it('listening 态再按快捷键 → 取消并回 idle', () => {
    const h = createHarness()
    h.service.wake()
    expect(h.service.getStatus().state).toBe('listening')
    const result = h.service.wake()
    expect(result.message).toContain('取消')
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'cancelled' })
    // 未提交任何会话
    expect(h.submitted.length).toBe(0)
  })

  it('回归：聆听中取消 → 自发 session-stopped 不得被误判为 error', async () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    expect(h.service.getStatus().state).toBe('listening')

    // 还原真实 stopVoiceSession 行为：flush 收尾会**同步**经 recognitionBridge 回调
    // session-stopped。若归属未先摘除，这个自发停止会被当成「外部终止」→ 用户点
    // 「取消聆听」却弹「语音识别会话已中断」红色报错（本用例锁死该回归）。
    const { stopVoiceSession } = await import('../VoiceRecognitionService.js')
    vi.mocked(stopVoiceSession).mockImplementation((sessionId?: string) => {
      if (sessionId != null) {
        h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId })
      }
      return false
    })
    try {
      expect(h.service.wake().message).toContain('取消')
    } finally {
      // clearAllMocks 不还原实现，必须显式复位避免污染后续用例
      vi.mocked(stopVoiceSession).mockImplementation(() => false)
    }

    expect(h.service.getStatus().state).toBe('idle')
    expect(h.stateEvents.some((e) => e.reason === 'error')).toBe(false)
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'cancelled' })
    expect(h.submitted.length).toBe(0)
  })

  it('回归：外部终止活跃识别会话仍报 error（与主动取消区分）', () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    // 非本服务发起的停止（如语音包安装触发引擎缓存重置）仍须暴露为错误
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'error' })
  })

  it('防抖：final 后确认窗口内继续说话 → 撤销收口拼接，多段合并提交', async () => {
    const h = createHarness()
    h.service.wake()
    // 第一段说完（VAD final）→ 进入确认窗口
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '帮我查一下',
    })
    expect(h.service.getStatus().state).toBe('listening') // 仍聆听，未收口
    expect(h.captureCommands.some((c) => c.action === 'stop')).toBe(false) // 采集未停
    // 窗口内用户继续开口（partial）→ 撤销收口
    h.service.handleRecognitionEvent({
      type: 'partial',
      sessionId: 'voice-100-1',
      text: '明天北京的',
    })
    expect(h.service.getStatus().state).toBe('listening')
    // 第二段说完 → 窗口重新计时
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '明天北京的天气',
    })
    // 推进 800ms（不到 1200ms 窗口）→ 仍未收口
    await vi.advanceTimersByTimeAsync(800)
    expect(h.service.getStatus().state).toBe('listening')
    // 再推进 500ms → 窗口到期 → thinking → flush 收口
    await vi.advanceTimersByTimeAsync(500)
    expect(h.service.getStatus().state).toBe('thinking')
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    // 两段拼接提交，未被截断
    expect(h.submitted.length).toBe(1)
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('帮我查一下 明天北京的天气')
  })

  it('防抖：确认窗口内再按快捷键取消 → 不提交任何内容', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '说了一半' })
    expect(h.service.getStatus().state).toBe('listening')
    // 窗口内取消
    const result = h.service.wake()
    expect(result.message).toContain('取消')
    expect(h.service.getStatus().state).toBe('idle')
    // 窗口定时器已清理：推进到期时间不产生任何提交
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.submitted.length).toBe(0)
    expect(h.stateEvents.some((e) => e.state === 'thinking')).toBe(false)
  })

  it('防抖：说完判定灵敏度设置生效（从容 2 秒档）', async () => {
    const h = createHarness({ utteranceConfirmMs: 2000 })
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '慢速说话' })
    // 推进 1200ms（标准档时长）→ 从容档尚未到期
    await vi.advanceTimersByTimeAsync(1200)
    expect(h.service.getStatus().state).toBe('listening')
    // 推进到 2000ms → 到期收口
    await vi.advanceTimersByTimeAsync(800)
    expect(h.service.getStatus().state).toBe('thinking')
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(1)
  })

  it('HUD 不重复：final 定稿后清掉同句 partial，确认窗口播报文本不含两遍', async () => {
    const h = createHarness()
    h.service.wake()
    // 实时识别流：partial 是当前句的实时全文（覆盖语义）
    h.service.handleRecognitionEvent({
      type: 'partial',
      sessionId: 'voice-100-1',
      text: '你能干什么',
    })
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '你能干什么',
    })
    // 确认窗口广播的 detail 必须只有一遍（partialText 已随 final 清空）
    const confirmEvent = h.stateEvents.find((e) => e.reason === 'confirm')
    expect(confirmEvent?.detail).toBe('你能干什么')
    // 窗口到期正常提交一遍
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(1)
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('你能干什么')
  })

  it('纯标点不提交：噪音硬解出的句号不算输入，确认窗口到期继续聆听', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '。。' })
    // 确认窗口到期 → 无有效正文 → 不收口、不停采集、继续聆听
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.captureCommands.some((c) => c.action === 'stop')).toBe(false)
    expect(h.submitted.length).toBe(0)
    expect(h.stateEvents.some((e) => e.state === 'thinking')).toBe(false)
    // 用户随后开口说有效内容 → 正常收口提交
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '现在帮你查询',
    })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().state).toBe('thinking')
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(1)
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('现在帮你查询')
  })

  it('收口兜底：精修后仅剩标点 → 恢复聆听而非提交', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '嗯，啊' })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().state).toBe('thinking')
    // 精修整体替换为纯标点（噪音段的典型精修产出）
    h.service.handleRecognitionEvent({ type: 'refined', sessionId: 'voice-100-1', text: '。' })
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    // 不提交；自动恢复聆听（新采集会话已下发）
    expect(h.submitted.length).toBe(0)
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.captureCommands.filter((c) => c.action === 'start').length).toBe(2)
  })

  it('语音会话思考：开关/档位切换 → 同步绑定会话推理档位', async () => {
    const h = createHarness()
    expect(h.reasoningEffortSyncs.length).toBe(0)
    // 关闭思考 → 对齐为 agent 档位（null）
    h.service.updateSettings({
      ...h.service.getSettings(),
      sessionThinkingEnabled: false,
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.reasoningEffortSyncs).toEqual([{ sessionId: 'session-voice-1', effort: null }])
    // 与思考无关的设置变更不触发同步
    h.service.updateSettings({ ...h.service.getSettings(), ttsSpeed: 1.5 })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.reasoningEffortSyncs.length).toBe(1)
    // 重新开启（默认 minimal 档）→ 再次同步
    h.service.updateSettings({
      ...h.service.getSettings(),
      sessionThinkingEnabled: true,
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.reasoningEffortSyncs).toEqual([
      { sessionId: 'session-voice-1', effort: null },
      { sessionId: 'session-voice-1', effort: 'minimal' },
    ])
    // 档位切换（开关不动）也触发同步，且同步所选档位
    h.service.updateSettings({
      ...h.service.getSettings(),
      sessionThinkingEffort: 'low',
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.reasoningEffortSyncs.at(-1)).toEqual({ sessionId: 'session-voice-1', effort: 'low' })
  })

  it('describeSessionAgent：透传绑定 Agent 的适配器信息', () => {
    const h = createHarness()
    // harness 默认绑定只有 defaultSessionId、未绑定 Agent → null（UI 回落默认选项）
    expect(h.service.describeSessionAgent()).toBeNull()
    // 绑定 Agent 后 → 透传解析结果（mock：非空 id → codex + 名称）
    h.route.current.defaultAgentId = 'agent-voice-1'
    expect(h.service.describeSessionAgent()).toEqual({
      adapter: 'codex',
      agentName: 'agent-agent-voice-1',
    })
  })

  it('20s 空转无转写 → 超时收口 + 失效提示音', async () => {
    const h = createHarness()
    h.service.wake()
    await vi.advanceTimersByTimeAsync(20_100)
    // stopVoiceSession(flush) 后需送 session-stopped 才收口
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'timeout' })
    expect(h.playCommands.some((c) => c.kind === 'cue' && c.cue === 'fail')).toBe(true)
    expect(h.submitted.length).toBe(0)
  })

  it('speech-activity 重置空转计时：19s 后有语音活动 → 20s 空转不触发', async () => {
    const h = createHarness()
    h.service.wake()
    await vi.advanceTimersByTimeAsync(19_000)
    // 门控检出人声（如用户在想措辞后开口，ASR 尚未解出文本）
    h.service.handleRecognitionEvent({
      type: 'speech-activity',
      sessionId: 'voice-100-1',
      speechActive: true,
    })
    await vi.advanceTimersByTimeAsync(19_500)
    expect(h.service.getStatus().state).toBe('listening')
    // 总时长越过原 20s 空转窗口仍未超时；到 40s（重置后再满 20s）才收口
    await vi.advanceTimersByTimeAsync(600)
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'timeout' })
  })

  it('listening 硬上限：持续活动不断重置空转计时，120s 强制收口', async () => {
    const h = createHarness()
    h.service.wake()
    // 模拟持续噪音场景：每 15s 一次 speech-activity，空转计时永远不满
    for (let round = 0; round < 7; round += 1) {
      await vi.advanceTimersByTimeAsync(15_000)
      h.service.handleRecognitionEvent({
        type: 'speech-activity',
        sessionId: 'voice-100-1',
        speechActive: true,
      })
    }
    // 105s 已过仍 listening；推进越过 120s 硬上限 → 强制收口
    expect(h.service.getStatus().state).toBe('listening')
    await vi.advanceTimersByTimeAsync(20_000)
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'timeout' })
    expect(h.submitted.length).toBe(0)
  })

  it('speaking 态打断 → cancelTurn + 停播 + idle(cancelled)', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '随便说点什么',
    })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      mode: 'delta',
      content: '正在回答你的问题。',
      provider: 'p',
      isFinal: false,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    expect(h.service.getStatus().state).toBe('speaking')

    h.service.interrupt()
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.cancelledSessions).toEqual(['session-voice-1'])
    expect(h.playCommands.some((c) => c.kind === 'stop')).toBe(true)
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'cancelled' })
  })

  it('语音命令「新开会话」→ 新建会话并语音确认，不提交 turn', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '新开会话' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.createdSessions).toEqual(['session-voice-new'])
    expect(h.submitted.length).toBe(0)
    expect(h.service.getStatus().state).toBe('speaking')
    const plays = h.playCommands.filter((c) => c.kind === 'play')
    expect(plays.length).toBe(1)
    if (plays[0]?.kind === 'play') {
      h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: plays[0].sentenceId })
    }
    expect(h.service.getStatus().state).toBe('idle')
  })

  it('渲染端采集失败 → idle(error)', () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRendererEvent({
      type: 'capture-failed',
      message: '麦克风访问被拒绝',
    })
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'error' })
  })

  it('设置更新 → 快捷键再武装', () => {
    const h = createHarness()
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      wakeShortcut: 'CommandOrControl+Shift+V',
    })
    // 无异常且设置生效即可（注册器为 fake）
    expect(h.service.getSettings().wakeShortcut).toBe('CommandOrControl+Shift+V')
  })

  it('M2 常驻聆听：开启 → standby + KWS 采集指令；关闭 → 释放', async () => {
    const h = createHarness()
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      alwaysListening: true,
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('standby')
    const kwsStart = h.captureCommands.find(
      (c) => c.sessionId === 'voice-assistant:kws' && c.action === 'start',
    )
    expect(kwsStart).toBeDefined()
    // 渲染端确认 KWS 采集在线
    h.service.handleRendererEvent({ type: 'capture-started', sessionId: 'voice-assistant:kws' })
    // standby 态 chunk 喂给 KWS 检测器（不进 ASR）
    kwsFeedMock.mockClear()
    h.service.handleAudioChunk('voice-assistant:kws', new Int16Array(1600))
    expect(kwsFeedMock).toHaveBeenCalledTimes(1)
    // 关闭常驻 → 停采集 + idle
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      alwaysListening: false,
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('idle')
    expect(
      h.captureCommands.some((c) => c.sessionId === 'voice-assistant:kws' && c.action === 'stop'),
    ).toBe(true)
  })

  it('M2 常驻对话收尾后自动回 standby', async () => {
    const h = createHarness()
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      alwaysListening: true,
    })
    await vi.advanceTimersByTimeAsync(10)
    h.service.handleRendererEvent({ type: 'capture-started', sessionId: 'voice-assistant:kws' })
    // 快捷键唤醒（复用常驻采集，不应对话采集 start）
    h.service.wake()
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.captureCommands.some((c) => c.action === 'start' && c.mode === 'dialogue')).toBe(false)
    // 说话 → 提交 → isFinal → 播完
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '说点什么',
    })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      mode: 'complete',
      content: '好的，收到。',
      provider: 'p',
      isFinal: true,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    const plays = h.playCommands.filter((c) => c.kind === 'play')
    expect(plays.length).toBe(1)
    if (plays[0]?.kind === 'play') {
      h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: plays[0].sentenceId })
    }
    // 播完 → idle → 常驻在线自动回 standby
    expect(h.service.getStatus().state).toBe('standby')
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'standby', reason: 'standby-on' })
  })

  it('M2 语音命令：切换会话 → 念列表 → 序号选择 → 改绑', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换会话' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0)
    expect(h.service.getStatus().state).toBe('speaking')
    // 选择态回应「第1个」
    h.service.wake() // speaking 态唤醒 = 打断，回到 idle 后再听
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第1个' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0) // 选择命中仍不进会话
    expect(h.bindingUpdates.some((patch) => patch.defaultSessionId === 'session-a')).toBe(true)
  })

  it('M2 语音命令：切换到已登记工作区 → 绑定其最近会话', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '切换到Spark工作区',
    })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0)
    expect(h.listedWorkspaces.length).toBe(1)
    expect(
      h.bindingUpdates.some(
        (patch) =>
          patch.defaultWorkspaceId === 'ws-1' && patch.defaultSessionId === 'session-in-ws1',
      ),
    ).toBe(true)
  })

  it('M4 语音命令：切换模型 → 念候选 → 序号选择 → 更新会话模型', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换模型' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0) // 命中命令不进会话
    expect(h.listedModels).toEqual(['session-voice-1']) // 候选取自语音绑定会话
    expect(h.service.getStatus().state).toBe('speaking') // 念候选列表
    // 选择态回应「第2个」
    h.service.wake() // speaking 态唤醒 = 打断，回到 idle 后再听
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第2个' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.modelUpdates).toEqual([{ sessionId: 'session-voice-1', modelId: 'gpt-4o-mini' }])
    expect(h.submitted.length).toBe(0) // 选择命中仍不进会话
  })

  it('M4 语音命令：切换到指定模型（带名直选，ASR 丢连字符也能宽松匹配）', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '切换到claude sonnet 4 5模型',
    })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.modelUpdates).toEqual([{ sessionId: 'session-voice-1', modelId: 'claude-sonnet-4-5' }])
    expect(h.submitted.length).toBe(0)
    expect(
      h.sessionFocusEvents.some(
        (e) => e.cause === 'command-switch' && e.sessionId === 'session-voice-1',
      ),
    ).toBe(true)
  })

  it('M4 语音命令：切换项目（无名称）→ 念候选 → 名称选择 → 切到该项目', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换项目' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0)
    expect(h.bindingUpdates.length).toBe(0) // 只念列表，未改绑
    expect(h.service.getStatus().state).toBe('speaking')
    // 选择态回应项目名称「个人项目」（ws-2 无最近会话 → 新建）
    h.service.wake() // speaking 态唤醒 = 打断，回到 idle 后再听
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '个人项目' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.bindingUpdates.some((patch) => patch.defaultWorkspaceId === 'ws-2')).toBe(true)
    expect(h.createdSessions).toEqual(['session-voice-new'])
    expect(h.submitted.length).toBe(0)
  })

  it('M4 语音命令：切换到指定会话（带名直选，未念列表直接改绑）', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '切换到画布功能的会话',
    })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0)
    expect(h.bindingUpdates.some((patch) => patch.defaultSessionId === 'session-b')).toBe(true)
    expect(
      h.sessionFocusEvents.some((e) => e.cause === 'command-switch' && e.sessionId === 'session-b'),
    ).toBe(true)
  })

  it('M4 挂起选择态：打断播报不作废候选，说序号仍完成选择', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换模型' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('speaking') // 候选列表播报中（挂起态已建立）
    h.service.interrupt() // 打断 TTS 只停播，不作废挂起候选（打断后说序号仍可选择）
    expect(h.service.getStatus().state).toBe('idle')
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第2个' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.modelUpdates).toEqual([{ sessionId: 'session-voice-1', modelId: 'gpt-4o-mini' }])
    expect(h.submitted.length).toBe(0) // 选择命中不进会话
  })

  it('M4 挂起选择态：说「算了」作废候选，下一句回普通对话', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换模型' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('speaking') // 候选列表播报中（挂起态已建立）
    h.service.wake() // speaking 态唤醒 = 打断，回到 idle 后再听
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '算了' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0) // 「算了」= stop-listening 命令，清挂起态
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '今天天气怎么样',
    })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    // 挂起态已清，不再被解析成 select-model，正常提交轮次
    expect(h.submitted.length).toBe(1)
    expect(h.modelUpdates).toEqual([])
  })

  it('会话聚焦：唤醒预跳 + 提交轮次 → emitSessionFocus 驱动 UI 跳转', async () => {
    const h = createHarness()
    h.service.wake()
    await vi.advanceTimersByTimeAsync(10)
    // 唤醒即预跳绑定会话（说话时转写直接出现在眼前）
    expect(h.sessionFocusEvents).toEqual([{ sessionId: 'session-voice-1', cause: 'wake' }])

    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '你好' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(1)
    expect(
      h.sessionFocusEvents.some((e) => e.cause === 'turn' && e.sessionId === 'session-voice-1'),
    ).toBe(true)
  })

  it('会话聚焦：无存活绑定（首次使用）唤醒不预跳，提交轮次时才跳', async () => {
    const h = createHarness()
    h.setPeekAliveSessionId(null)
    h.service.wake()
    await vi.advanceTimersByTimeAsync(10)
    expect(h.sessionFocusEvents.filter((e) => e.cause === 'wake')).toHaveLength(0)

    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '你好' })
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.sessionFocusEvents.some((e) => e.cause === 'turn')).toBe(true)
  })

  it('会话聚焦：语音命令新开会话/选择会话/切工作区 → 跳转到改绑后的会话', async () => {
    const h = createHarness()
    // 新开会话 → command-new
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '新开会话' })
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(
      h.sessionFocusEvents.some(
        (e) => e.cause === 'command-new' && e.sessionId === 'session-voice-new',
      ),
    ).toBe(true)

    // 切换会话 → 念列表 → 第1个（session-a）→ command-switch
    h.service.wake() // speaking 态唤醒 = 打断，回 idle
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换会话' })
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    h.service.wake() // speaking 打断 → idle
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第1个' })
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(
      h.sessionFocusEvents.some((e) => e.cause === 'command-switch' && e.sessionId === 'session-a'),
    ).toBe(true)

    // 切换工作区 → 绑定其最近会话（session-in-ws1）→ command-workspace
    h.service.wake()
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '切换到Spark工作区',
    })
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(
      h.sessionFocusEvents.some(
        (e) => e.cause === 'command-workspace' && e.sessionId === 'session-in-ws1',
      ),
    ).toBe(true)
  })

  it('M2 KWS 采集断流 → 自动重试重启', async () => {
    const h = createHarness({ alwaysListening: true })
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      alwaysListening: true,
    })
    await vi.advanceTimersByTimeAsync(10)
    h.service.handleRendererEvent({ type: 'capture-started', sessionId: 'voice-assistant:kws' })
    // 采集意外停止 → idle + 2s 后重发 start
    h.service.handleRendererEvent({ type: 'capture-stopped', sessionId: 'voice-assistant:kws' })
    expect(h.service.getStatus().state).toBe('idle')
    const startCountBefore = h.captureCommands.filter(
      (c) => c.action === 'start' && c.sessionId === 'voice-assistant:kws',
    ).length
    await vi.advanceTimersByTimeAsync(2_100)
    const startCountAfter = h.captureCommands.filter(
      (c) => c.action === 'start' && c.sessionId === 'voice-assistant:kws',
    ).length
    expect(startCountAfter).toBe(startCountBefore + 1)
  })

  it('M2 外部安装在途 → 等待而非误报；就绪后自动进 standby', async () => {
    kwsMocks.available = false
    const h = createHarness()
    h.setInstallImpl(async () => ({
      success: false,
      message: '语音包正在安装中，请稍候',
      status: { downloading: true },
    }))
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      alwaysListening: true,
    })
    await vi.advanceTimersByTimeAsync(10)
    // 在途：不得报「唤醒词模型未安装」错误
    expect(h.stateEvents.some((e) => e.reason === 'error')).toBe(false)
    expect(h.installCalls.length).toBe(1)
    expect(h.service.getStatus().state).toBe('idle')
    // 等待轮询期间不重复发起安装（waitingInstall 只查就绪）
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.installCalls.length).toBe(1)
    expect(h.stateEvents.some((e) => e.reason === 'error')).toBe(false)
    // 模型就绪 → 轮询自动接管进入 standby
    kwsMocks.available = true
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.service.getStatus().state).toBe('standby')
    expect(
      h.captureCommands.some((c) => c.action === 'start' && c.sessionId === 'voice-assistant:kws'),
    ).toBe(true)
  })

  it('M2 安装等待超上限（10 分钟）→ 提示手动处理，且只报一次', async () => {
    kwsMocks.available = false
    const h = createHarness()
    h.setInstallImpl(async () => ({
      success: false,
      message: '语音包正在安装中，请稍候',
      status: { downloading: true },
    }))
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      alwaysListening: true,
    })
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(120 * 5_000 + 10)
    const errEvents = h.stateEvents.filter((e) => e.reason === 'error')
    expect(errEvents.length).toBe(1)
    expect(errEvents[0]?.detail).toContain('等待超时')
  })

  it('M2 等待期间关闭常驻聆听 → 取消等待，就绪后也不自动启动', async () => {
    kwsMocks.available = false
    const h = createHarness()
    h.setInstallImpl(async () => ({
      success: false,
      message: '语音包正在安装中，请稍候',
      status: { downloading: true },
    }))
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      alwaysListening: true,
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.installCalls.length).toBe(1)
    // 等待期间关闭常驻聆听
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      alwaysListening: false,
    })
    await vi.advanceTimersByTimeAsync(10)
    // 模型随后就绪：等待已被取消，不自动进 standby
    kwsMocks.available = true
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.service.getStatus().state).toBe('idle')
    expect(
      h.captureCommands.some((c) => c.action === 'start' && c.sessionId === 'voice-assistant:kws'),
    ).toBe(false)
  })

  it('M3 审批桥：轮次中审批 → 念问题 → 听「同意」→ resolveApproval(allow)', async () => {
    const h = createHarness()
    // 建立语音轮次
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '删掉那个文件',
    })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(1)
    // 权限审批请求到达（sessionId 匹配 activeTurn）
    const engaged = h.service.handleApprovalRequest({
      requestId: 'req-1',
      sessionId: 'session-voice-1',
      toolName: 'Bash',
      action: 'rm -rf build',
      riskLevel: 'high',
    })
    expect(engaged).toBe(true)
    // 念问题 → speaking；全部句子播完自动进入聆听
    await vi.advanceTimersByTimeAsync(20)
    expect(h.service.getStatus().state).toBe('speaking')
    const question = h.playCommands.filter((c) => c.kind === 'play')
    expect(question.length).toBeGreaterThanOrEqual(1)
    for (const command of question) {
      if (command.kind === 'play') {
        h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: command.sentenceId })
      }
    }
    expect(h.service.getStatus().state).toBe('listening')
    // 说「同意」
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '同意' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.approvals).toEqual([{ requestId: 'req-1', decision: 'allow' }])
    // 确认播报（已同意，继续执行）不产生新轮次
    expect(h.submitted.length).toBe(1)
  })

  it('M3 审批桥：非语音轮次的请求不接手；说「拒绝」→ resolveApproval(deny)', async () => {
    const h = createHarness()
    // 无 activeTurn：不接手
    expect(
      h.service.handleApprovalRequest({
        requestId: 'req-x',
        sessionId: 'session-voice-1',
        toolName: 'Bash',
        action: '',
        riskLevel: 'low',
      }),
    ).toBe(false)
    // 建轮次后接手 + 拒绝
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '执行命令' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(
      h.service.handleApprovalRequest({
        requestId: 'req-2',
        sessionId: 'session-voice-1',
        toolName: 'Write',
        action: '',
        riskLevel: 'medium',
      }),
    ).toBe(true)
    await vi.advanceTimersByTimeAsync(20)
    const q = h.playCommands.filter((c) => c.kind === 'play')
    for (const command of q) {
      if (command.kind === 'play') {
        h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: command.sentenceId })
      }
    }
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '拒绝' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.approvals).toEqual([{ requestId: 'req-2', decision: 'deny' }])
  })

  it('M3 连续对话：轮次播完 → 自动回聆听', async () => {
    const h = createHarness({ continuousMode: true })
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '讲个笑话' })
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      mode: 'complete',
      content: '程序员最讨厌的两件事。',
      provider: 'p',
      isFinal: true,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    const plays = h.playCommands.filter((c) => c.kind === 'play')
    if (plays[0]?.kind === 'play') {
      h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: plays[0].sentenceId })
    }
    // 播完 → idle → 800ms 后自动 listening
    await vi.advanceTimersByTimeAsync(900)
    expect(h.service.getStatus().state).toBe('listening')
    // 快捷键打断取消续听
    h.service.wake()
    expect(h.service.getStatus().state).toBe('idle')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.service.getStatus().state).toBe('idle')
  })
})
