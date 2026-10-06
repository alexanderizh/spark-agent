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
import {
  DEFAULT_VOICE_ASSISTANT_SETTINGS,
  VOICE_ASSISTANT_INTERNAL_OWNER_ID,
} from '@spark/protocol'

vi.mock('../VoiceRecognitionService.js', () => ({
  startVoiceSession: vi.fn(() => ({
    success: true,
    sessionId: 'voice-100-1',
    error: null,
  })),
  stopVoiceSession: vi.fn(() => false),
  feedVoiceAudio: vi.fn(),
  // standby 空闲期识别器预热：mock 下恒 true（命中缓存），预热行为语义由
  // VoiceRecognitionService 侧单测锁定
  warmupVoiceRecognizer: vi.fn((): boolean => true),
  // 按轮区间精修链路：默认无音频游标（null → 跳过精修直接提交流式），
  // 精修专项用例里按需 mockImplementation 覆盖
  getVoiceSessionSampleCursor: vi.fn((): number | null => null),
  refineVoiceSessionInterval: vi.fn(async () => null),
  // 全双工长会话的缓存裁剪：mock 下恒 false（无裁剪发生），行为语义由
  // VoiceRecognitionService 侧单测锁定
  trimVoiceSessionPcmCache: vi.fn((): boolean => false),
}))

// TTS 产物目录操作走内存 fake（真实 fs promise 在 fake timers 下不会推进）
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  // 云转写 writePcmWav 的 WAV 落盘：fake 之（真实写盘在 fake timers 下同样不推进）
  writeFile: vi.fn(async () => undefined),
}))

// KWS 检测器整体 mock（真实模型加载依赖已安装的语音包）；
// vi.hoisted 避免 mock 工厂提升后引用未初始化变量
const kwsMocks = vi.hoisted(() => ({
  feed: vi.fn(),
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  /** 模拟 KWS 模型是否已安装（安装等待场景需要动态切换） */
  available: true,
  /** 构造时捕获的唤醒命中回调（模拟唤醒词命中路径用） */
  onHit: null as ((keyword: string) => void) | null,
}))
vi.mock('./WakeWordDetector.js', () => ({
  WakeWordDetector: class {
    isActive(): boolean {
      return true
    }
    start = kwsMocks.start
    stop = kwsMocks.stop
    feed = kwsMocks.feed
    constructor(options: { onHit: (keyword: string) => void }) {
      kwsMocks.onHit = options.onHit
    }
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
import { stopVoiceSession } from '../VoiceRecognitionService.js'
import type { VoiceAssistantRouteBinding } from '@spark/protocol'
import type { VoiceRouteBinding } from './VoiceRouteBinding.js'

interface Harness {
  service: VoiceAssistantService
  stateEvents: VoiceAssistantStateEvent[]
  sessionFocusEvents: VoiceAssistantSessionFocusEvent[]
  captureCommands: VoiceAssistantCaptureCommand[]
  playCommands: VoiceAssistantPlayCommand[]
  /** 送 TTS 合成的句子文本（经 mediaRouter.invoke 的 prompt 捕获，播报断言用） */
  ttsPrompts: string[]
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
  const ttsPrompts: string[] = []
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
    // 既有用例锚定半双工契约（确认窗口 1800ms + stopCaptureAndAsr 收口链路）；
    // 全双工行为由「全双工对话窗口」专项 describe 覆盖（patch fullDuplex: true）
    fullDuplex: false,
    // 半双工契约下的端点节奏 = relaxed 档（2000+1800ms，长停顿容忍优先）
    utteranceEndpointProfile: 'relaxed',
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
      invoke: async (request: { prompt?: string }) => {
        ttsPrompts.push(request.prompt ?? '')
        return {
          output: {
            provider: 'fake-tts',
            model: 'tts-1',
            mode: 'sync',
            assets: [{ type: 'audio', filePath: `/tmp/va-tts-${Date.now()}-${Math.random()}.mp3` }],
          },
          providerProfileId: 'p1',
        }
      },
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
      return { models: ['claude-sonnet-4-5', 'gpt-4o-mini'] }
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
    ttsPrompts,
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
  await vi.advanceTimersByTimeAsync(1850)
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
    kwsMocks.onHit = null
  })

  it('就绪门：capture-started 到达才播 wake 提示音并置就绪（丢首字修复）', () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    expect(h.service.getStatus().state).toBe('listening')
    // 提示音=「可以说了」发令枪：麦克风真正开门（渲染端 capture-started）前不播
    expect(h.playCommands.length).toBe(0)
    expect(h.service.getStatus().captureReady).toBe(false)
    h.service.handleRendererEvent({
      type: 'capture-started',
      sessionId: h.captureCommands[0]!.sessionId,
    })
    expect(h.playCommands[0]).toEqual({ kind: 'cue', cue: 'wake' })
    expect(h.service.getStatus().captureReady).toBe(true)
  })

  it('就绪门兜底：capture-started 迟滞时超时后强行解锁提示音', async () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    expect(h.playCommands.length).toBe(0)
    await vi.advanceTimersByTimeAsync(1499)
    expect(h.playCommands.length).toBe(0)
    await vi.advanceTimersByTimeAsync(2)
    expect(h.playCommands[0]).toEqual({ kind: 'cue', cue: 'wake' })
  })

  it('就绪门兜底与 HUD 同口径：超时解锁同时置 captureReady 并广播状态', async () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    expect(h.service.getStatus().captureReady).toBe(false)
    await vi.advanceTimersByTimeAsync(1501)
    // 只播提示音不解锁 HUD 会让准备态文案与「可以说了」的提示音自相矛盾
    expect(h.playCommands[0]).toEqual({ kind: 'cue', cue: 'wake' })
    expect(h.service.getStatus().captureReady).toBe(true)
  })

  it('就绪门兜底后迟到的 capture-started 幂等：不二次播提示音', async () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    await vi.advanceTimersByTimeAsync(1501)
    expect(h.playCommands.length).toBe(1)
    h.service.handleRendererEvent({
      type: 'capture-started',
      sessionId: h.captureCommands[0]!.sessionId,
    })
    // 兜底已置就绪标记：迟到上报被 sessionId 守卫挡住，无双重提示音
    expect(h.playCommands.length).toBe(1)
    expect(h.service.getStatus().captureReady).toBe(true)
  })

  it('就绪门等待期取消：超时到点不补播提示音（cue 语义已失效）', async () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    h.service.interrupt()
    await vi.advanceTimersByTimeAsync(1600)
    expect(h.playCommands.length).toBe(0)
  })

  it('KWS 唤醒词路径不预播提示音：cue 统一由就绪门在 capture-started 后发令', async () => {
    const h = createHarness()
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      voiceFocus: 'off',
      alwaysListening: true,
    })
    await vi.advanceTimersByTimeAsync(10)
    h.service.handleRendererEvent({ type: 'capture-started', sessionId: 'voice-assistant:kws' })
    expect(h.service.getStatus().state).toBe('standby')
    expect(h.playCommands.length).toBe(0)
    // 唤醒词命中：KWS 常驻流复用，渲染端对 dialogue 会话近乎即时回报
    // capture-started——预播 + 就绪门再播会构成双响（回归缺陷）
    kwsMocks.onHit?.('嘿 Spark')
    await vi.advanceTimersByTimeAsync(1)
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.playCommands.length).toBe(0) // 唤醒瞬间不预播
    const dialogueStart = h.captureCommands.find(
      (c) => c.action === 'start' && c.mode === 'dialogue',
    )
    expect(dialogueStart).toBeDefined()
    h.service.handleRendererEvent({
      type: 'capture-started',
      sessionId: dialogueStart!.sessionId,
    })
    expect(h.playCommands.length).toBe(1) // 仅就绪门一响
    expect(h.playCommands[0]).toEqual({ kind: 'cue', cue: 'wake' })
  })

  it('完整链路：唤醒→聆听→VAD final→提交→逐句播报→完成回 idle', async () => {
    const h = createHarness()
    expect(h.service.wake().ok).toBe(true)
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.captureCommands[0]?.action).toBe('start')
    // 唤醒提示音：就绪门延迟至 capture-started（丢首字修复，见上方就绪门用例）
    h.service.handleRendererEvent({
      type: 'capture-started',
      sessionId: h.captureCommands[0]!.sessionId,
    })
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
    await vi.advanceTimersByTimeAsync(1850)
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

  it('等待播报卡死兜底：渲染端 ended 全丢失，看门狗宽限满后自动收口回 idle', async () => {
    const h = createHarness()
    await driveAssistantSpeech(h)
    // 权威全文 + 轮次终态（与完整链路一致，此后只等播放回收）
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      mode: 'complete',
      content: '这是播报的第一句。',
      provider: 'p',
      isFinal: true,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    h.service.handleTurnEvent({
      type: 'agent_status',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      status: 'completed',
    } as never)
    await vi.advanceTimersByTimeAsync(400)
    expect(h.service.getStatus().state).toBe('speaking')

    // 现场复刻：渲染端 ended 事件全部丢失（播放悬挂/主进程阻塞后事件被丢）——
    // 不回发任何 playback-ended，推进超过看门狗宽限（120s）
    await vi.advanceTimersByTimeAsync(119_800)
    // 看门狗回收丢失句 → allPlayed → 状态机脱离 speaking 卡死
    expect(h.stateEvents.some((e) => e.state === 'idle' && e.reason === 'completed')).toBe(true)
    expect(['idle', 'listening', 'standby']).toContain(h.service.getStatus().state)
    // 回收路径补发带淡出的停播指令（复位渲染端播放态）
    const fadeStop = h.playCommands.filter((c) => c.kind === 'stop').find((c) => c.fadeMs != null)
    expect(fadeStop).toBeDefined()
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
    await vi.advanceTimersByTimeAsync(1850)
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
    // 推进 1000ms（不到 1800ms 窗口）→ 仍未收口
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.service.getStatus().state).toBe('listening')
    // 再推进 850ms → 窗口到期 → thinking → flush 收口
    await vi.advanceTimersByTimeAsync(850)
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

  it('防抖：端点档位设置生效（standard 1200ms vs relaxed 1800ms 确认窗口）', async () => {
    const h = createHarness({ utteranceEndpointProfile: 'relaxed' })
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '慢速说话' })
    // 推进 1200ms（standard 档时长）→ relaxed 档尚未到期
    await vi.advanceTimersByTimeAsync(1200)
    expect(h.service.getStatus().state).toBe('listening')
    // 推进到 1900ms → 到期收口
    await vi.advanceTimersByTimeAsync(700)
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
    await vi.advanceTimersByTimeAsync(1850)
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
    await vi.advanceTimersByTimeAsync(1850)
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
    await vi.advanceTimersByTimeAsync(1850)
    expect(h.service.getStatus().state).toBe('thinking')
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(1)
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('现在帮你查询')
  })

  it('收口兜底：精修后仅剩标点 → 恢复聆听而非提交', async () => {
    const h = createHarness()
    h.service.wake()
    // 流式转写含有效字（「帮我看下」），不触发确认窗口的纯语气字退化过滤；
    // 纯语气字碎片（「嗯，啊」类）在确认窗口已被丢弃，到不了精修环节
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '嗯，帮我看下',
    })
    await vi.advanceTimersByTimeAsync(1850)
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

  it('纯语气字碎片不提交：「我 我」类瞬态噪音碎片确认窗口到期继续聆听', async () => {
    const h = createHarness()
    h.service.wake()
    // 日志实锤形态：鼠标点击被 ASR 硬解成「我 我」（2 字，恰在孤立单字 <2
    // 过滤的空档），退化判定补上这个空档
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '我 我' })
    await vi.advanceTimersByTimeAsync(1850)
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.captureCommands.some((c) => c.action === 'stop')).toBe(false)
    expect(h.submitted.length).toBe(0)
    expect(h.stateEvents.some((e) => e.state === 'thinking')).toBe(false)
    // 多段碎片拼接（3 字仍 ≤4 上限）同样拦截
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '嗯嗯 嗯' })
    await vi.advanceTimersByTimeAsync(1850)
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.submitted.length).toBe(0)
    // 随后真实内容照常收口提交（过滤只是一次性丢弃，不损伤后续输入）
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '现在帮你查询',
    })
    await vi.advanceTimersByTimeAsync(1850)
    expect(h.service.getStatus().state).toBe('thinking')
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(1)
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('现在帮你查询')
  })

  it('真实短答不误伤：「好的」正常提交（好/对 不在退化语气字集合）', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '好的' })
    await vi.advanceTimersByTimeAsync(1850)
    expect(h.service.getStatus().state).toBe('thinking')
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(1)
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('好的')
    // 「对」单字在无挂起态下由既有孤立单字过滤（<2 有效字）处理——退化集合
    // 「对」永不命中，纯函数层已断言（speechify.test.ts），本过滤不改变其行为
  })

  it('挂起选择态例外：说「嗯」不按噪音丢弃，正常到达命令解析（铁笼语义接管）', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换模型' })
    await vi.advanceTimersByTimeAsync(1850)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('speaking') // 候选列表播报中（挂起态已建立）
    h.service.interrupt() // 打断播报不作废候选
    expect(h.service.getStatus().state).toBe('idle')
    h.service.wake()
    // 挂起选择态等待序号短答：「嗯」（单字 + 退化语气字）不被确认窗口噪音过滤
    // 吞掉——例外放行保证短答总能到达命令解析（序号/取消短语依赖同一通道）
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '嗯' })
    await vi.advanceTimersByTimeAsync(1850)
    // 未被丢弃：收口进入 thinking（若退化过滤误杀会停留 listening）
    expect(h.service.getStatus().state).toBe('thinking')
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    // 既有铁笼语义：非序号文本按 select-model 名称尝试，「嗯」未命中候选 →
    // 播报未匹配提示并清挂起态，不按普通输入提交（提交「嗯」反而是幻影输入）
    expect(h.submitted.length).toBe(0)
    expect(h.service.getStatus().state).toBe('speaking')
    // 播报文本是未匹配提示（名称未命中 → 清挂起态 → 播报，同一分支收口）
    expect(h.ttsPrompts.join('')).toContain('没有匹配的模型')
    // 挂起态已清理：「第1个」不再进选择通道（选择态铁笼已解除），按普通输入
    // 提交且不触发模型切换——若挂起态未清，「第1个」会命中序号选择改模型
    h.service.interrupt()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第1个' })
    await vi.advanceTimersByTimeAsync(1850)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.modelUpdates).toEqual([])
    expect(h.submitted.map((s) => s.userMessageDisplayContent)).toContain('第1个')
  })

  it('语音命令「停止」放行：确认窗口到期直接执行收口，不经噪音过滤', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '停止' })
    await vi.advanceTimersByTimeAsync(1850)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.captureCommands.filter((c) => c.action === 'stop').length).toBeGreaterThan(0)
    expect(h.submitted.length).toBe(0)
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850)
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
    await vi.advanceTimersByTimeAsync(1850)
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    // 快捷键唤醒（常驻采集在线：下发带 replayPreRoll 的对话 start——渲染端据此
    // 复用常驻流不重起 getUserMedia，仅回放 pre-roll 补齐唤醒切换空窗的字头）
    h.service.wake()
    expect(h.service.getStatus().state).toBe('listening')
    const dialogueStart = h.captureCommands.find(
      (c) => c.action === 'start' && c.mode === 'dialogue',
    )
    expect(dialogueStart?.replayPreRoll).toBe(true)
    expect(dialogueStart?.sessionId).not.toBe('voice-assistant:kws')
    // 说话 → 提交 → isFinal → 播完
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '说点什么',
    })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0)
    expect(h.service.getStatus().state).toBe('speaking')
    // 选择态回应「第1个」
    h.service.wake() // speaking 态唤醒 = 打断，回到 idle 后再听
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第1个' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0) // 命中命令不进会话
    expect(h.listedModels).toEqual(['session-voice-1']) // 候选取自语音绑定会话
    expect(h.service.getStatus().state).toBe('speaking') // 念候选列表
    // 选择态回应「第2个」
    h.service.wake() // speaking 态唤醒 = 打断，回到 idle 后再听
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第2个' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0)
    expect(h.bindingUpdates.length).toBe(0) // 只念列表，未改绑
    expect(h.service.getStatus().state).toBe('speaking')
    // 选择态回应项目名称「个人项目」（ws-2 无最近会话 → 新建）
    h.service.wake() // speaking 态唤醒 = 打断，回到 idle 后再听
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '个人项目' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('speaking') // 候选列表播报中（挂起态已建立）
    h.service.interrupt() // 打断 TTS 只停播，不作废挂起候选（打断后说序号仍可选择）
    expect(h.service.getStatus().state).toBe('idle')
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第2个' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.modelUpdates).toEqual([{ sessionId: 'session-voice-1', modelId: 'gpt-4o-mini' }])
    expect(h.submitted.length).toBe(0) // 选择命中不进会话
  })

  it('M4 挂起选择态：说「算了」作废候选，下一句回普通对话', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换模型' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('speaking') // 候选列表播报中（挂起态已建立）
    h.service.wake() // speaking 态唤醒 = 打断，回到 idle 后再听
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '算了' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0) // 「算了」= stop-listening 命令，清挂起态
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '今天天气怎么样',
    })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    // 挂起态已清，不再被解析成 select-model，正常提交轮次
    expect(h.submitted.length).toBe(1)
    expect(h.modelUpdates).toEqual([])
  })

  it('M4 挂起选择态：说「不切了」取消选择回到聊天（不关语音）', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换模型' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('speaking') // 候选列表播报中（挂起态已建立）
    h.service.wake() // speaking 态唤醒 = 打断，回到 idle 后再听
    h.service.wake()
    const playMark = h.playCommands.length // 取消播报这批 play 的起点（此前是候选列表播报）
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '不切了' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(0) // cancel-selection 命令不进会话
    expect(h.modelUpdates).toEqual([]) // 未发生模型切换
    // 播报「好，不切了」→ 收尾后自动续听（连续对话链路），语音未被关闭。
    // 多轮 sentenceId 已不撞号，须按批标记后逐句回收（而非从头取第一个）
    const cancelPlays = h.playCommands
      .slice(playMark)
      .filter((c): c is Extract<VoiceAssistantPlayCommand, { kind: 'play' }> => c.kind === 'play')
    for (const play of cancelPlays) {
      h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: play.sentenceId })
    }
    expect(cancelPlays.length).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(900) // 播完 → idle → 800ms 后自动 listening
    expect(h.service.getStatus().state).toBe('listening')
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '今天天气怎么样',
    })
    await vi.advanceTimersByTimeAsync(1850)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    // 挂起态已清 + 逃生门不放行普通对话，正常提交轮次
    expect(h.submitted.length).toBe(1)
  })

  it('stop-listening 命令完全收口：停采集停识别再转 idle', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '取消' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('idle')
    // A3：stop-listening 需真正拆除采集（发 stop 指令），而非仅收状态机
    const stopCommands = h.captureCommands.filter((c) => c.action === 'stop')
    expect(stopCommands.length).toBeGreaterThan(0)
  })

  it('会话聚焦：唤醒预跳 + 提交轮次 → emitSessionFocus 驱动 UI 跳转', async () => {
    const h = createHarness()
    h.service.wake()
    await vi.advanceTimersByTimeAsync(10)
    // 唤醒即预跳绑定会话（说话时转写直接出现在眼前）
    expect(h.sessionFocusEvents).toEqual([{ sessionId: 'session-voice-1', cause: 'wake' }])

    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '你好' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.sessionFocusEvents.some((e) => e.cause === 'turn')).toBe(true)
  })

  it('会话聚焦：语音命令新开会话/选择会话/切工作区 → 跳转到改绑后的会话', async () => {
    const h = createHarness()
    // 新开会话 → command-new
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '新开会话' })
    await vi.advanceTimersByTimeAsync(1850)
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
    await vi.advanceTimersByTimeAsync(1850)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    h.service.wake() // speaking 打断 → idle
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第1个' })
    await vi.advanceTimersByTimeAsync(1850)
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
    await vi.advanceTimersByTimeAsync(1850)
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.approvals).toEqual([{ requestId: 'req-2', decision: 'deny' }])
  })

  it('M3 连续对话：轮次播完 → 自动回聆听', async () => {
    const h = createHarness({ continuousMode: true })
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '讲个笑话' })
    await vi.advanceTimersByTimeAsync(1850) // 说完确认窗口到期
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

// ─── M5 全双工（对话窗口 / 插话队列 / 抢占 / graceful） ─────────────────────

describe('VoiceAssistantService 全双工对话窗口', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** 全双工 harness（标准端点档 1500+1200ms） */
  function createDuplexHarness(patch: Partial<VoiceAssistantSettings> = {}): Harness {
    return createHarness({ fullDuplex: true, utteranceEndpointProfile: 'standard', ...patch })
  }

  /** 驱动一轮完整对话到 speaking（提交 + 首句播放指令下发） */
  async function driveToSpeaking(h: Harness, text = '今天天气怎么样'): Promise<void> {
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text })
    await vi.advanceTimersByTimeAsync(1250) // standard 档确认窗口
    expect(h.service.getStatus().state).toBe('thinking')
    expect(h.submitted.length).toBe(1)
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
  }

  it('窗口内提交不停采集不停 ASR（纯流式直接提交，duplexActive 广播）', async () => {
    const h = createDuplexHarness()
    h.service.wake()
    expect(h.service.getStatus().duplexActive).toBe(false) // listening 态不算插话窗口
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '查个日程' })
    await vi.advanceTimersByTimeAsync(1250)
    // 全双工：确认到期直接提交，不 stopCaptureAndAsr
    expect(h.service.getStatus().state).toBe('thinking')
    expect(h.service.getStatus().duplexActive).toBe(true)
    expect(h.captureCommands.some((c) => c.action === 'stop')).toBe(false)
    expect(h.submitted.length).toBe(1)
  })

  it('thinking 期插话 → 确认窗口 → 入队（queuedInputs 广播，容量语义）', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    // thinking/speaking 期插话（speaking 态）：final → draft → 确认 → 入队
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '顺便帮我查下明天的日程安排',
    })
    expect(h.service.getStatus().queueDraft).toEqual({ text: '顺便帮我查下明天的日程安排' })
    await vi.advanceTimersByTimeAsync(1250)
    const queued = h.service.getStatus().queuedInputs
    expect(queued.length).toBe(1)
    expect(queued[0]).toMatchObject({
      text: '顺便帮我查下明天的日程安排',
      capturedState: 'speaking',
    })
    expect(h.service.getStatus().queueDraft).toBeNull()
  })

  it('插话确认窗口内继续说 → 撤销拼接为一条', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '等一下' })
    await vi.advanceTimersByTimeAsync(300)
    // 窗口内继续说（partial 撤销计时 + 新 final 拼接）
    h.service.handleRecognitionEvent({
      type: 'partial',
      sessionId: 'voice-100-1',
      text: '换个话题',
    })
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '换个话题' })
    await vi.advanceTimersByTimeAsync(1250)
    const queued = h.service.getStatus().queuedInputs
    expect(queued.length).toBe(1)
    expect(queued[0]?.text).toBe('等一下 换个话题')
  })

  it('回声守卫：speaking 期 final 与在播 TTS 文本一致 → 静默丢弃不入队', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h) // 在播「今天晴，气温二十五度。」
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '今天晴，气温二十五度。',
    })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().queuedInputs.length).toBe(0)
    expect(h.service.getStatus().queueDraft).toBeNull()
  })

  it('thinking 期退化碎片 final「我 我」→ 不开草稿不入队，轮次不受扰动', async () => {
    const h = createDuplexHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '今天天气怎么样',
    })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().state).toBe('thinking')
    expect(h.submitted.length).toBe(1)
    // thinking 期插话噪声碎片（日志实锤 viq-8/9/11/14 全为 thinking 期入队）：
    // 播报活跃与时间窗判据都不在场，退化判定须全时段生效
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '我 我' })
    expect(h.service.getStatus().queueDraft).toBeNull()
    await vi.advanceTimersByTimeAsync(1250) // 若误开草稿，此处会确认入队
    expect(h.service.getStatus().queuedInputs.length).toBe(0)
    expect(h.service.getStatus().queueDraft).toBeNull()
    // 原轮次不受扰动：正常进 speaking
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
    expect(h.submitted.length).toBe(1)
  })

  it('语音命令旁路：speaking 期说「切换会话」→ 不入队直接执行', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换会话' })
    await vi.advanceTimersByTimeAsync(1250)
    // 命令立即执行（念列表），无排队输入
    expect(h.listedRecent.length).toBe(1)
    expect(h.service.getStatus().queuedInputs.length).toBe(0)
  })

  it('队列自动派发（completed 先到，播报未完 → graceful 接管）', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '再查下湿度',
    })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().queuedInputs.length).toBe(1)
    // 生成完成（播报未完）：completed → 300ms 回捞 → 队列派发（graceful）
    h.service.handleTurnEvent({
      type: 'agent_status',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      status: 'completed',
    } as never)
    await vi.advanceTimersByTimeAsync(400)
    expect(h.submitted.length).toBe(2)
    expect(h.submitted[1]?.userMessageDisplayContent).toBe('再查下湿度')
    // graceful 停止指令（非硬停）：stop 带 graceful 标记
    const gracefulStop = h.playCommands.find((c) => c.kind === 'stop' && c.graceful === true)
    expect(gracefulStop).toBeDefined()
    // 队列已清空
    expect(h.service.getStatus().queuedInputs.length).toBe(0)
  })

  it('graceful 接管完成即冲掉 queue-dispatch 衔接态（takeover-live 同态广播）', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '再查下湿度',
    })
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleTurnEvent({
      type: 'agent_status',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      status: 'completed',
    } as never)
    await vi.advanceTimersByTimeAsync(400)
    expect(h.stateEvents.some((e) => e.reason === 'queue-dispatch')).toBe(true)
    expect(h.stateEvents.some((e) => e.reason === 'takeover-live')).toBe(false) // 新首句未开播
    // 新代首句 delta → 合成 → play 指令 → takeover-live 同态广播（HUD 衔接态翻篇）
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-2',
      sessionId: 'session-voice-1',
      mode: 'delta',
      content: '湿度百分之六十。',
      provider: 'p',
      isFinal: false,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    expect(h.stateEvents.some((e) => e.reason === 'takeover-live')).toBe(true)
    const live = h.stateEvents.find((e) => e.reason === 'takeover-live')
    expect(live).toMatchObject({ state: 'speaking', previous: 'speaking' })
    // 桥接标志只触发一次：后续句子开播不重复广播
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-2',
      sessionId: 'session-voice-1',
      mode: 'delta',
      content: '适合晾晒衣服。',
      provider: 'p',
      isFinal: false,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    expect(h.stateEvents.filter((e) => e.reason === 'takeover-live').length).toBe(1)
  })

  it('命令确认播报期非选择插话只入队不起聊天轮（C3：announcing 冻结 graceful）', async () => {
    const h = createDuplexHarness()
    // 首句即命令（无轮次、无挂起选择态）：新建会话 → 播报确认（announcing）
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '新建会话' })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.createdSessions.length).toBe(1)
    expect(h.submitted.length).toBe(0)
    expect(h.service.getStatus().state).toBe('speaking')
    // 确认播报期间说聊天内容：应入队（等播报完 listen-resume 派发），
    // 不当场起聊天轮砍断播报（graceful 分支被 announcing 守卫拦下）
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '顺便讲个笑话吧',
    })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.submitted.length).toBe(0)
    expect(h.service.getStatus().queuedInputs.length).toBe(1)
    expect(h.service.getStatus().queuedInputs[0]).toMatchObject({ text: '顺便讲个笑话吧' })
  })

  it('立即发送抢占作废挂起选择态（抢占后残留候选会误解析后续插话）', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    // 轮次生成中（activeTurn busy）→ 聊天插话入队
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '先回答刚才的问题',
    })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().queuedInputs.length).toBe(1)
    // 命令旁路（不排队直接执行）：念模型候选 → 挂起选择态 + 队列仍有条目
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '切换模型' })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.listedModels.length).toBe(1)
    expect(h.service.getStatus().queuedInputs.length).toBe(1)
    // 立即发送抢占：作废挂起选择态 + 提交排队输入
    await h.service.dispatchQueued()
    expect(h.submitted.length).toBe(2)
    expect(h.submitted[1]?.userMessageDisplayContent).toBe('先回答刚才的问题')
    // 抢占后说「第二个」：挂起选择已作废 → 不再按模型序号执行
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '第二个' })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.modelUpdates.length).toBe(0)
  })

  it('队列自动派发（allPlayed 路径：生成中入队，播完 0ms 派发不续听）', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    // 生成仍在跑（activeTurn busy）→ 插话入队
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '查下湿度' })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().queuedInputs.length).toBe(1)
    // isFinal 收口（不经 completed 的 300ms 回捞）→ 播完 → allPlayed → 0ms 派发
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      mode: 'complete',
      content: '今天晴，气温二十五度。',
      provider: 'p',
      isFinal: true,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    const plays = h.playCommands.filter((c) => c.kind === 'play')
    for (const command of plays) {
      if (command.kind === 'play') {
        h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: command.sentenceId })
      }
    }
    // allPlayed 后队列非空立即派发（不进 800ms 续听）
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(2)
    expect(h.stateEvents.some((e) => e.reason === 'queue-dispatch')).toBe(true)
  })

  it('队列派发状态对齐：allPlayed 触发进入 thinking，首 delta 后正常转 speaking', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '查下湿度' })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().queuedInputs.length).toBe(1)
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      mode: 'complete',
      content: '今天晴，气温二十五度。',
      provider: 'p',
      isFinal: true,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    const plays = h.playCommands.filter((c) => c.kind === 'play')
    for (const command of plays) {
      if (command.kind === 'play') {
        h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: command.sentenceId })
      }
    }
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(2)
    // 原缺陷：派发轮卡在 idle——回声门控不武装、插话丢失、HUD 错态
    expect(h.service.getStatus().state).toBe('thinking')
    // 派发轮首个 delta → speaking（原缺陷：maybeTransitionSpeaking 只认 thinking，永不迁移）
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-2',
      sessionId: 'session-voice-1',
      mode: 'delta',
      content: '湿度百分之四十。',
      provider: 'p',
      isFinal: false,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    expect(h.service.getStatus().state).toBe('speaking')
  })

  it('立即发送（抢占）：cancelTurn + TTS 淡出 + 新提交 + ack', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '马上回答我',
    })
    await vi.advanceTimersByTimeAsync(1250)
    const queued = h.service.getStatus().queuedInputs
    expect(queued.length).toBe(1)
    const result = await h.service.dispatchQueued(queued[0]?.id)
    expect(result.ok).toBe(true)
    // 旧轮被取消（cancelTurn）
    expect(h.cancelledSessions).toContain('session-voice-1')
    // 新轮提交（抢占语义：不等旧轮）
    expect(h.submitted.length).toBe(2)
    expect(h.submitted[1]?.userMessageDisplayContent).toBe('马上回答我')
    // TTS 立即淡出（stop 带 fadeMs）
    const fadeStop = h.playCommands.filter((c) => c.kind === 'stop').find((c) => c.fadeMs != null)
    expect(fadeStop).toBeDefined()
    // 抢占状态事件
    expect(h.stateEvents.some((e) => e.reason === 'preempt')).toBe(true)
    // ack cue（首响反馈默认 cue）
    expect(h.playCommands.some((c) => c.kind === 'cue' && c.cue === 'ack')).toBe(true)
  })

  it('打断保留队列：interrupt 后条目仍在，唤醒续听时补发', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '别忘了查日程',
    })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().queuedInputs.length).toBe(1)
    // 用户打断（E9：打断的是播报，不是「我说过的话」）
    h.service.interrupt()
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.service.getStatus().queuedInputs.length).toBe(1)
    // 再次唤醒进入对话 → 队首补发（提交链微任务落定后断言）
    h.service.wake()
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(2)
    expect(h.submitted[1]?.userMessageDisplayContent).toBe('别忘了查日程')
  })

  it('停止聆听命令清空队列（E8）', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '排队的话' })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().queuedInputs.length).toBe(1)
    h.service.interrupt()
    // 唤醒 → 队列派发（listen-resume）→ listening；说「停止」走命令路径清空
    h.service.wake()
    await vi.advanceTimersByTimeAsync(10)
    expect(h.submitted.length).toBe(2) // 队首「排队的话」已补发
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '停止' })
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.service.getStatus().queuedInputs.length).toBe(0)
  })

  it('忙碌期聚合：连说多段并成队尾同一条（一句话不拆成 N 个轮次）', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    // agent 仍在生成（activeTurn 忙）：每段静默收口后不再各开一条，
    // 追加到队尾同一条，派发时一轮发完
    for (const text of ['第一条排队', '第二条排队', '第三条排队', '第四条排队']) {
      h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text })
      await vi.advanceTimersByTimeAsync(1250)
    }
    const queued = h.service.getStatus().queuedInputs
    expect(queued.length).toBe(1)
    expect(queued[0]?.text).toBe('第一条排队 第二条排队 第三条排队 第四条排队')
  })

  it('全双工续听复用 ASR 会话（duplex listening resumed，无重复 start 指令）', async () => {
    const h = createDuplexHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '你好' })
    await vi.advanceTimersByTimeAsync(1250)
    h.service.handleTurnEvent({
      type: 'assistant_message',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      mode: 'complete',
      content: '你好，有什么可以帮你？',
      provider: 'p',
      isFinal: true,
    } as never)
    await vi.advanceTimersByTimeAsync(20)
    h.service.handleTurnEvent({
      type: 'agent_status',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      status: 'completed',
    } as never)
    await vi.advanceTimersByTimeAsync(400)
    const plays = h.playCommands.filter((c) => c.kind === 'play')
    for (const command of plays) {
      if (command.kind === 'play') {
        h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: command.sentenceId })
      }
    }
    // 播完 → 续听（800ms 后）→ 复用窗口（不重发 capture start）
    await vi.advanceTimersByTimeAsync(900)
    expect(h.service.getStatus().state).toBe('listening')
    const starts = h.captureCommands.filter((c) => c.action === 'start')
    expect(starts.length).toBe(1)
  })

  it('云引擎强制半双工：fullDuplex=true 但 recognitionEngine=cloud → 不开窗口', async () => {
    const h = createDuplexHarness({ recognitionEngine: 'cloud' })
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '云转写' })
    await vi.advanceTimersByTimeAsync(1250)
    // cloud 引擎：确认到期走 stopCaptureAndAsr（半双工收口链路）
    expect(h.captureCommands.some((c) => c.action === 'stop')).toBe(true)
    expect(h.service.getStatus().duplexActive).toBe(false)
  })

  it('云转写渠道/模型设置透传：显式 sttProviderProfileId/sttModelId 下发 invoke 锁定', async () => {
    const invokeCalls: Array<{
      request: Record<string, unknown>
      options: Record<string, unknown>
    }> = []
    const h = createHarness(
      {
        recognitionEngine: 'cloud',
        sttProviderProfileId: 'p-asr',
        sttModelId: 'whisper-large',
      },
      false,
      {
        providers: [{ id: 'p-asr', name: 'fake-asr', defaultModel: 'whisper-large', apiKey: 'k' }],
        mediaRouter: {
          supports: () => true,
          invoke: async (request: Record<string, unknown>, options: Record<string, unknown>) => {
            invokeCalls.push({ request, options })
            return {
              output: {
                provider: 'fake-asr',
                model: 'whisper-large',
                mode: 'sync',
                assets: [{ type: 'text', contentText: '云端转写的结果文本' }],
              },
              providerProfileId: 'p-asr',
            }
          },
        },
      },
    )
    h.service.wake()
    // 聆听期喂 0.6s 音频（≥0.3s 阈值，触发整段上传转写）：handleAudioChunk 校验的
    // 是采集会话 id（start 指令下发值），传 ASR 会话 id 会被会话校验丢弃
    h.service.handleAudioChunk(
      h.captureCommands.find((c) => c.action === 'start' && c.mode === 'dialogue')?.sessionId ?? '',
      new Int16Array(9600),
    )
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '本地流式兜底',
    })
    await vi.advanceTimersByTimeAsync(3900)
    // mock 的 stopVoiceSession 不回调事件：与既有用例同模式手动补发 session-stopped
    // 驱动收尾 flush（真实实现里 stopVoiceSession 异步 flush 后回调）
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(invokeCalls.length).toBe(1)
    expect(invokeCalls[0]?.request.operation).toBe('audio_transcribe')
    expect(invokeCalls[0]?.options.providerProfileId).toBe('p-asr')
    expect(invokeCalls[0]?.options.modelId).toBe('whisper-large')
    // 云端文本替换本地流式兜底提交
    expect(h.submitted.length).toBe(1)
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('云端转写的结果文本')
  })

  it('云转写未指定渠道/模型：invoke 不携带锁定字段，由路由器自动选路', async () => {
    const invokeCalls: Array<{ options: Record<string, unknown> }> = []
    const h = createHarness({ recognitionEngine: 'cloud' }, false, {
      providers: [{ id: 'p-any', name: 'fake-asr', defaultModel: 'whisper-1', apiKey: 'k' }],
      mediaRouter: {
        supports: () => true,
        invoke: async (_request: unknown, options: Record<string, unknown>) => {
          invokeCalls.push({ options })
          return {
            output: {
              provider: 'fake-asr',
              model: 'whisper-1',
              mode: 'sync',
              assets: [{ type: 'text', contentText: '自动选路转写' }],
            },
            providerProfileId: 'p-any',
          }
        },
      },
    })
    h.service.wake()
    // 采集会话 id 同上：从 start 指令提取
    h.service.handleAudioChunk(
      h.captureCommands.find((c) => c.action === 'start' && c.mode === 'dialogue')?.sessionId ?? '',
      new Int16Array(9600),
    )
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '本地流式兜底',
    })
    await vi.advanceTimersByTimeAsync(3900)
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(invokeCalls.length).toBe(1)
    const autoRouteOptions = invokeCalls[0]?.options ?? {}
    expect('providerProfileId' in autoRouteOptions).toBe(false)
    expect('modelId' in autoRouteOptions).toBe(false)
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('自动选路转写')
  })

  it('全双工按轮精修：区间音频离线重识别成功 → 精修文本整体替换流式结果提交', async () => {
    const { getVoiceSessionSampleCursor, refineVoiceSessionInterval } =
      await import('../VoiceRecognitionService.js')
    // 本轮区间 3 秒音频（0 → 48000 samples @16k）
    let cursor = 0
    vi.mocked(getVoiceSessionSampleCursor).mockImplementation(() => cursor)
    vi.mocked(refineVoiceSessionInterval).mockImplementation(async () => '今天天气怎么样？')
    const h = createDuplexHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '今天天起怎么样',
    })
    cursor = 48_000
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.submitted.length).toBe(1)
    // 精修结果替换了流式的错字（天起 → 天气，补全标点）
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('今天天气怎么样？')
    // 区间精修只认本轮音频：owner = 内部通道哨兵，fromSample = 轮起始游标
    expect(vi.mocked(refineVoiceSessionInterval)).toHaveBeenCalledWith(
      'voice-100-1',
      VOICE_ASSISTANT_INTERNAL_OWNER_ID,
      0,
    )
    vi.mocked(getVoiceSessionSampleCursor).mockImplementation(() => null)
    vi.mocked(refineVoiceSessionInterval).mockImplementation(async () => null)
  })

  it('全双工按轮精修：精修失败/超时 → 自动回退流式结果，不阻断提交', async () => {
    const { getVoiceSessionSampleCursor, refineVoiceSessionInterval } =
      await import('../VoiceRecognitionService.js')
    let cursor = 0
    vi.mocked(getVoiceSessionSampleCursor).mockImplementation(() => cursor)
    vi.mocked(refineVoiceSessionInterval).mockImplementation(async () => null)
    const h = createDuplexHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '流式识别的原句',
    })
    cursor = 48_000
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.submitted.length).toBe(1)
    expect(h.submitted[0]?.userMessageDisplayContent).toBe('流式识别的原句')
    vi.mocked(getVoiceSessionSampleCursor).mockImplementation(() => null)
    vi.mocked(refineVoiceSessionInterval).mockImplementation(async () => null)
  })

  it('播报期门控由播放相位驱动武装（合成完成晚于 transition(speaking) 不漏整场）', async () => {
    const { feedVoiceAudio } = await import('../VoiceRecognitionService.js')
    const feedMock = vi.mocked(feedVoiceAudio)
    feedMock.mockClear()
    const h = createDuplexHarness()
    const captureId = () =>
      h.captureCommands.find((c) => c.action === 'start' && c.mode === 'dialogue')?.sessionId ?? ''

    // 对照：listening 态（无播报、门控未武装）高能量音频原样直通 ASR
    h.service.wake()
    await vi.advanceTimersByTimeAsync(10) // flush startListening 的微任务（capture/asr 会话建立）
    const loud = new Int16Array(1600).fill(20000)
    h.service.handleAudioChunk(captureId(), loud)
    const fedBefore = feedMock.mock.calls.at(-1)?.[1] as Int16Array
    expect(fedBefore?.every((s) => s !== 0)).toBe(true)

    // 驱动到 speaking 且首句合成完成（play 已下发）：transition('speaking') 早于
    // 合成完成，此时门控武装只能来自管线的播放相位翻转回调（缺陷回归点）
    h.service.handleRecognitionEvent({
      type: 'final',
      sessionId: 'voice-100-1',
      text: '今天天气怎么样',
    })
    await vi.advanceTimersByTimeAsync(1250)
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
    expect(h.playCommands.some((c) => c.kind === 'play')).toBe(true)

    // 播报期喂高能量 chunk：门控已武装（warmup 期不放行）→ 等长置零压制
    feedMock.mockClear()
    h.service.handleAudioChunk(captureId(), loud)
    const fedDuring = feedMock.mock.calls.at(-1)?.[1] as Int16Array
    expect(fedDuring?.length).toBe(1600)
    expect(fedDuring?.every((s) => s === 0)).toBe(true)

    // 播放全部结束（相位翻 false）→ 门控解除；回到 listening 后恢复原样直通
    for (const command of h.playCommands) {
      if (command.kind === 'play') {
        h.service.handleRendererEvent({ type: 'playback-ended', sentenceId: command.sentenceId })
      }
    }
    h.service.handleTurnEvent({
      type: 'agent_status',
      turnId: 'turn-1',
      sessionId: 'session-voice-1',
      status: 'completed',
    } as never)
    await vi.advanceTimersByTimeAsync(1500) // 回捞兜底 300ms + 续听延迟 800ms（嵌套计时器）
    feedMock.mockClear()
    h.service.handleAudioChunk(captureId(), loud)
    const fedAfter = feedMock.mock.calls.at(-1)?.[1] as Int16Array
    expect(fedAfter?.every((s) => s !== 0)).toBe(true)
  })

  it('打断彻底收口：speaking 态 interrupt 释放双工采集/ASR，残留定时器不再拉起状态机', async () => {
    const h = createDuplexHarness()
    await driveToSpeaking(h)
    const captureStopsBefore = h.captureCommands.filter((c) => c.action === 'stop').length
    vi.mocked(stopVoiceSession).mockClear()

    h.service.interrupt()
    expect(h.service.getStatus().state).toBe('idle')
    // 全双工下 thinking/speaking 期采集与 ASR 在线（插话聆听）：打断 = 用户显式
    // 结束对话循环，麦克风与会话必须同步释放（旧实现只在 listening 态收）
    expect(h.captureCommands.filter((c) => c.action === 'stop').length).toBe(captureStopsBefore + 1)
    expect(vi.mocked(stopVoiceSession)).toHaveBeenCalledWith(
      'voice-100-1',
      VOICE_ASSISTANT_INTERNAL_OWNER_ID,
      'flush',
    )
    expect(h.service.getStatus().duplexActive).toBe(false)

    // 无差别清定时器回归：推进跨过全部对话定时器周期（空转 20s / 硬上限 120s /
    // 续听 800ms），打断后的状态机不得被残留定时器拉回对话态或误报 error
    await vi.advanceTimersByTimeAsync(130_000)
    expect(['idle', 'standby']).toContain(h.service.getStatus().state)
    expect(h.stateEvents.some((e) => e.reason === 'error')).toBe(false)
  })
})
