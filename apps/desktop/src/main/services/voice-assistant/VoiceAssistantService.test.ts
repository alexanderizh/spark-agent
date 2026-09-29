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

import { VoiceAssistantService } from './VoiceAssistantService.js'
import type { VoiceAssistantRouteBinding } from './VoiceRouteBinding.js'

interface Harness {
  service: VoiceAssistantService
  stateEvents: VoiceAssistantStateEvent[]
  captureCommands: VoiceAssistantCaptureCommand[]
  playCommands: VoiceAssistantPlayCommand[]
  submitted: Array<{ sessionId: string; message: string; display: string }>
  cancelledSessions: string[]
  recovered: Array<{ sessionId: string; turnId: string }>
  createdSessions: string[]
  route: VoiceAssistantRouteBinding
  installCalls: number[]
  setInstallImpl: (
    impl: () => Promise<{
      success: boolean
      message: string
      status?: { downloading?: boolean }
    }>,
  ) => void
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createHarness(settingsPatch: Partial<VoiceAssistantSettings> = {}): Harness {
  const stateEvents: VoiceAssistantStateEvent[] = []
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
  const bindingUpdates: Array<Record<string, unknown>> = []
  const approvals: Array<{ requestId: string; decision: 'allow' | 'deny' }> = []
  const installCalls: number[] = []
  let installImpl: (() => Promise<{
    success: boolean
    message: string
    status?: { downloading?: boolean }
  }>) | null = null
  let settings: VoiceAssistantSettings = { ...DEFAULT_VOICE_ASSISTANT_SETTINGS, ...settingsPatch }

  const route: VoiceAssistantRouteBinding = {
    current: { defaultSessionId: 'session-voice-1' },
    ensureSession: async () => ({ sessionId: 'session-voice-1', created: false }),
    createNewSession: async () => {
      createdSessions.push('session-voice-new')
      return { sessionId: 'session-voice-new' }
    },
    updateBinding: (patch) => {
      bindingUpdates.push(patch as Record<string, unknown>)
    },
    clearSession: () => undefined,
  } as unknown as VoiceAssistantRouteBinding

  let turnCounter = 0
  const service = new VoiceAssistantService({
    readSettings: () => settings,
    writeSettings: (value) => {
      settings = value
    },
    shortcutRegistrar: {
      register: () => true,
      unregister: () => undefined,
    },
    resolveMediaProviders: async () => [
      { id: 'p1', name: 'fake-tts', defaultModel: 'tts-1', apiKey: 'k' },
    ] as never,
    mediaRouter: {
      invoke: async () => ({
        output: {
          provider: 'fake-tts',
          model: 'tts-1',
          mode: 'sync',
          assets: [{ type: 'audio', filePath: `/tmp/va-tts-${Date.now()}-${Math.random()}.mp3` }],
        },
        providerProfileId: 'p1',
      }),
    } as never,
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
    registerCleanup: () => undefined,
    ttsDir: '/tmp/voice-assistant-test-tts',
    runtimeDir: '/tmp/voice-assistant-test-runtime',
    installVoicePack: async () => {
      installCalls.push(1)
      return installImpl != null
        ? installImpl()
        : { success: true, message: 'ok' }
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
    resolveApproval: (requestId, decision) => {
      approvals.push({ requestId, decision })
      return true
    },
  })

  return {
    service,
    stateEvents,
    captureCommands,
    playCommands,
    submitted,
    cancelledSessions,
    recovered,
    createdSessions,
    listedRecent,
    listedWorkspaces,
    bindingUpdates,
    approvals,
    route,
    installCalls,
    setInstallImpl: (
      impl: () => Promise<{ success: boolean; message: string; status?: { downloading?: boolean } }>,
    ) => {
      installImpl = impl
    },
  }
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
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '今天天气怎么样' })
    expect(h.service.getStatus().state).toBe('listening')
    expect(h.stateEvents.some((e) => e.reason === 'confirm')).toBe(true)
    // 确认窗口内持续静默 → 到期收口 → thinking → flush 收尾
    await vi.advanceTimersByTimeAsync(1250)
    expect(h.service.getStatus().state).toBe('thinking')
    expect(h.captureCommands.some((c) => c.action === 'stop')).toBe(true)
    // flush 尾句并入
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '适合出行吗' })
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

  it('防抖：final 后确认窗口内继续说话 → 撤销收口拼接，多段合并提交', async () => {
    const h = createHarness()
    h.service.wake()
    // 第一段说完（VAD final）→ 进入确认窗口
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '帮我查一下' })
    expect(h.service.getStatus().state).toBe('listening') // 仍聆听，未收口
    expect(h.captureCommands.some((c) => c.action === 'stop')).toBe(false) // 采集未停
    // 窗口内用户继续开口（partial）→ 撤销收口
    h.service.handleRecognitionEvent({ type: 'partial', sessionId: 'voice-100-1', text: '明天北京的' })
    expect(h.service.getStatus().state).toBe('listening')
    // 第二段说完 → 窗口重新计时
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '明天北京的天气' })
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

  it('15s 无转写 → 超时收口 + 失效提示音', async () => {
    const h = createHarness()
    h.service.wake()
    await vi.advanceTimersByTimeAsync(15_100)
    // stopVoiceSession(flush) 后需送 session-stopped 才收口
    await vi.advanceTimersByTimeAsync(1250) // 说完确认窗口到期
    h.service.handleRecognitionEvent({ type: 'session-stopped', sessionId: 'voice-100-1' })
    expect(h.service.getStatus().state).toBe('idle')
    expect(h.stateEvents.at(-1)).toMatchObject({ state: 'idle', reason: 'timeout' })
    expect(h.playCommands.some((c) => c.kind === 'cue' && c.cue === 'fail')).toBe(true)
    expect(h.submitted.length).toBe(0)
  })

  it('speaking 态打断 → cancelTurn + 停播 + idle(cancelled)', async () => {
    const h = createHarness()
    h.service.wake()
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '随便说点什么' })
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
      wakeShortcut: 'CommandOrControl+Shift+V',
    })
    // 无异常且设置生效即可（注册器为 fake）
    expect(h.service.getSettings().wakeShortcut).toBe('CommandOrControl+Shift+V')
  })

  it('M2 常驻聆听：开启 → standby + KWS 采集指令；关闭 → 释放', async () => {
    const h = createHarness()
    h.service.updateSettings({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
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
    h.service.updateSettings({ ...DEFAULT_VOICE_ASSISTANT_SETTINGS, alwaysListening: false })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.service.getStatus().state).toBe('idle')
    expect(
      h.captureCommands.some(
        (c) => c.sessionId === 'voice-assistant:kws' && c.action === 'stop',
      ),
    ).toBe(true)
  })

  it('M2 常驻对话收尾后自动回 standby', async () => {
    const h = createHarness()
    h.service.updateSettings({ ...DEFAULT_VOICE_ASSISTANT_SETTINGS, alwaysListening: true })
    await vi.advanceTimersByTimeAsync(10)
    h.service.handleRendererEvent({ type: 'capture-started', sessionId: 'voice-assistant:kws' })
    // 快捷键唤醒（复用常驻采集，不应对话采集 start）
    h.service.wake()
    expect(h.service.getStatus().state).toBe('listening')
    expect(
      h.captureCommands.some((c) => c.action === 'start' && c.mode === 'dialogue'),
    ).toBe(false)
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
        (patch) => patch.defaultWorkspaceId === 'ws-1' && patch.defaultSessionId === 'session-in-ws1',
      ),
    ).toBe(true)
  })

  it('M2 KWS 采集断流 → 自动重试重启', async () => {
    const h = createHarness({ alwaysListening: true })
    h.service.updateSettings({ ...DEFAULT_VOICE_ASSISTANT_SETTINGS, alwaysListening: true })
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
    h.service.updateSettings({ ...DEFAULT_VOICE_ASSISTANT_SETTINGS, alwaysListening: true })
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
    h.service.updateSettings({ ...DEFAULT_VOICE_ASSISTANT_SETTINGS, alwaysListening: true })
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
    h.service.updateSettings({ ...DEFAULT_VOICE_ASSISTANT_SETTINGS, alwaysListening: true })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.installCalls.length).toBe(1)
    // 等待期间关闭常驻聆听
    h.service.updateSettings({ ...DEFAULT_VOICE_ASSISTANT_SETTINGS, alwaysListening: false })
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
    h.service.handleRecognitionEvent({ type: 'final', sessionId: 'voice-100-1', text: '删掉那个文件' })
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
