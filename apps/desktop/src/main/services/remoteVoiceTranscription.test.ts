import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRemoteVoiceTranscriber,
  type RemoteVoiceTranscriptionDeps,
} from './remoteVoiceTranscription.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

async function createWorkDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-voice-'))
  temporaryDirectories.push(dir)
  return dir
}

/** 构造可注入依赖：默认云端路由/渠道全部空缺，解码与本地识别按用例注入 */
function buildDeps(overrides: {
  decodeAudioToPcm?: (input: string, outputPath: string) => Promise<void>
  transcribePcm?: (samples: Int16Array) => Promise<string | null>
  providers?: Array<Record<string, unknown>>
  invoke?: ReturnType<typeof vi.fn>
}): RemoteVoiceTranscriptionDeps & { invoke: ReturnType<typeof vi.fn> } {
  const invoke =
    overrides.invoke ??
    vi.fn(async () => ({
      output: {
        provider: 'openai',
        model: 'whisper-1',
        mode: 'sync' as const,
        assets: [{ type: 'text' as const, contentText: '云端转写文本' }],
      },
      providerProfileId: 'p1',
    }))
  return {
    resolveMediaProviders: async () =>
      (overrides.providers ?? [{ id: 'p1', name: 'OpenAI', defaultModel: 'whisper-1', apiKey: 'k' }]) as never,
    mediaRouter: { invoke },
    workDir: '/tmp/unused',
    ...(overrides.decodeAudioToPcm != null ? { decodeAudioToPcm: overrides.decodeAudioToPcm } : {}),
    ...(overrides.transcribePcm != null ? { transcribePcm: overrides.transcribePcm } : {}),
    invoke,
  }
}

/** 模拟 ffmpeg 解码：写入一小段合法 PCM（1024 个零采样） */
async function fakeDecode(input: string, outputPath: string): Promise<void> {
  expect(input).toBe('/voice/input.ogg')
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, new Int16Array(1024))
}

describe('createRemoteVoiceTranscriber', () => {
  it('prefers local SenseVoice transcription when available', async () => {
    const deps = buildDeps({
      decodeAudioToPcm: fakeDecode,
      transcribePcm: async () => '  本地转写文本  ',
    })
    const transcriber = createRemoteVoiceTranscriber(deps)
    const outcome = await transcriber.transcribe({ audioPath: '/voice/input.ogg' })
    expect(outcome).toEqual({ kind: 'ok', text: '本地转写文本', engine: 'local' })
    expect(deps.invoke).not.toHaveBeenCalled()
  })

  it('falls back to cloud transcription when local model is unavailable', async () => {
    const deps = buildDeps({
      decodeAudioToPcm: fakeDecode,
      transcribePcm: async () => null,
    })
    const transcriber = createRemoteVoiceTranscriber(deps)
    const outcome = await transcriber.transcribe({ audioPath: '/voice/input.ogg' })
    expect(outcome).toEqual({ kind: 'ok', text: '云端转写文本', engine: 'cloud' })
    expect(deps.invoke).toHaveBeenCalledTimes(1)
  })

  it('falls back to cloud when local decode fails, uploading the original file', async () => {
    const deps = buildDeps({
      decodeAudioToPcm: async () => {
        throw new Error('ffmpeg 未安装')
      },
    })
    const transcriber = createRemoteVoiceTranscriber(deps)
    const outcome = await transcriber.transcribe({
      audioPath: '/voice/input.ogg',
      mimeType: 'audio/ogg',
    })
    expect(outcome).toEqual({ kind: 'ok', text: '云端转写文本', engine: 'cloud' })
    const call = deps.invoke.mock.calls[0]?.[0] as {
      inputFiles: Array<{ path?: string }>
    }
    expect(call.inputFiles[0]?.path).toBe('/voice/input.ogg')
  })

  it('returns failure with reasons and setup guidance when both engines are unavailable', async () => {
    const deps = buildDeps({
      decodeAudioToPcm: fakeDecode,
      transcribePcm: async () => {
        throw new Error('离线识别模型（SenseVoice）未安装')
      },
      providers: [],
    })
    const transcriber = createRemoteVoiceTranscriber(deps)
    const outcome = await transcriber.transcribe({ audioPath: '/voice/input.ogg' })
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') {
      expect(outcome.message).toContain('离线识别模型（SenseVoice）未安装')
      expect(outcome.message).toContain('未配置任何多媒体渠道')
      expect(outcome.message).toContain('语音助手')
      expect(outcome.message).toContain('语音转写')
    }
  })

  it('reports cloud transcription errors with setup guidance', async () => {
    const deps = buildDeps({
      decodeAudioToPcm: fakeDecode,
      transcribePcm: async () => null,
      invoke: vi.fn(async () => {
        throw new Error('401 Unauthorized')
      }),
    })
    const transcriber = createRemoteVoiceTranscriber(deps)
    const outcome = await transcriber.transcribe({ audioPath: '/voice/input.ogg' })
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') {
      expect(outcome.message).toContain('401 Unauthorized')
      expect(outcome.message).toContain('配置指引')
    }
  })

  it('rejects voice longer than the local transcription limit', async () => {
    const workDir = await createWorkDir()
    const deps = buildDeps({
      decodeAudioToPcm: async (_input, outputPath) => {
        await fs.mkdir(workDir, { recursive: true })
        await fs.writeFile(outputPath, new Int16Array(16000 * 601))
      },
      transcribePcm: async () => '不应到达这里',
    })
    deps.workDir = workDir
    const transcriber = createRemoteVoiceTranscriber(deps)
    const outcome = await transcriber.transcribe({ audioPath: '/voice/input.ogg' })
    // 超限走云端兜底而非直接失败
    expect(outcome).toEqual({ kind: 'ok', text: '云端转写文本', engine: 'cloud' })
  })
})
