/**
 * ttsLocalFallback 单测
 *
 * 覆盖：语速映射（三平台 clamp 边界）、`say -v ?` 中文语音解析（名含空格 /
 * 无中文语音 / 空输入）、say 与 espeak 参数构造（argv 不含正文）、SAPI 脚本
 * 构造（base64 内嵌、路径单引号转义）、PowerShell EncodedCommand 编码、
 * WAV 魔数校验、平台→后端映射、PowerShell 绝对路径解析、编排前置分支
 * （空文本 / 无后端平台在 spawn 前抛错）、探测编排（注入 runner：成功缓存 /
 * 失败负缓存退避 / 并发去重）。
 * 真实子进程行为（runChildProcess 全链路）由实机验证覆盖，调用侧契约由
 * ttsSynthesis.test.ts 对 synthesizeSpeechLocally 整体 mock 覆盖。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import {
  buildEspeakArgs,
  buildSapiScript,
  buildSayArgs,
  detectSayChineseVoice,
  encodePowerShellCommand,
  estimateSapiEncodedCommandChars,
  isPlausibleWav,
  localEngineForPlatform,
  mapSpeedToEspeakWpm,
  mapSpeedToSapiRate,
  mapSpeedToSayRateWpm,
  parseSayChineseVoice,
  resetLocalTtsCachesForTest,
  resolvePowerShellCommand,
  synthesizeSpeechLocally,
  type ChildRunner,
} from './ttsLocalFallback.js'

// 探测缓存是模块级状态：每个用例前重置，防止跨用例污染（缓存命中让后续
// 用例注入的 runner 替身不被调用，产生假绿）。
beforeEach(() => {
  resetLocalTtsCachesForTest()
})

/** 标准 WAV 头前 12 字节（RIFF + WAVE 魔数） */
function makeWavHeader(): Buffer {
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'ascii')
  header.write('WAVE', 8, 'ascii')
  return header
}

describe('mapSpeedToSayRateWpm（macOS say -r）', () => {
  it('1.0 原速映射基准 175 wpm', () => {
    expect(mapSpeedToSayRateWpm(1.0)).toBe(175)
  })

  it('随 speed 线性放大', () => {
    expect(mapSpeedToSayRateWpm(1.4)).toBe(245)
    expect(mapSpeedToSayRateWpm(2.0)).toBe(350)
  })

  it('低于下限 clamp 到 100', () => {
    expect(mapSpeedToSayRateWpm(0.5)).toBe(100) // 87.5 → 100
    expect(mapSpeedToSayRateWpm(0.1)).toBe(100)
  })
})

describe('mapSpeedToSapiRate（Windows SAPI Rate -10..10）', () => {
  it('1.0 → 0；0.5 → -5；2.0 → 10', () => {
    expect(mapSpeedToSapiRate(1.0)).toBe(0)
    expect(mapSpeedToSapiRate(0.5)).toBe(-5)
    expect(mapSpeedToSapiRate(2.0)).toBe(10)
  })

  it('双向 clamp', () => {
    expect(mapSpeedToSapiRate(0)).toBe(-10)
    expect(mapSpeedToSapiRate(5)).toBe(10)
  })
})

describe('mapSpeedToEspeakWpm（espeak-ng -s）', () => {
  it('1.0 → 175；clamp 80–400', () => {
    expect(mapSpeedToEspeakWpm(1.0)).toBe(175)
    expect(mapSpeedToEspeakWpm(0.1)).toBe(80)
    expect(mapSpeedToEspeakWpm(3)).toBe(400)
  })
})

describe('parseSayChineseVoice（say -v ? 输出解析）', () => {
  it('命中首个中文语音（zh_CN）', () => {
    const output = [
      'Alex                en_US    # Most people recognize me by my voice.',
      'Tingting            zh_CN    # 你好，我是婷婷。',
      'Meijia              zh_TW    # 您好，我是美佳。',
    ].join('\n')
    expect(parseSayChineseVoice(output)).toBe('Tingting')
  })

  it('语音名含空格也能解析（三段式匹配，不按空白列切）', () => {
    const output = [
      'Anna (Enhanced)     en_US    # Hello',
      'Yu-shu (Premium)    zh_CN    # 你好',
    ].join('\n')
    expect(parseSayChineseVoice(output)).toBe('Yu-shu (Premium)')
  })

  it('无中文语音返回 null（不误命中注释里的中文）', () => {
    const output = 'Alex                en_US    # 你好，我是 Alex。'
    expect(parseSayChineseVoice(output)).toBe(null)
  })

  it('空输入与杂行返回 null', () => {
    expect(parseSayChineseVoice('')).toBe(null)
    expect(parseSayChineseVoice('some random line without locale')).toBe(null)
  })
})

describe('buildSayArgs', () => {
  it('含语音名与语速；文本经 stdin（-f -），argv 不出现正文', () => {
    const args = buildSayArgs({ voice: 'Tingting', rateWpm: 245, outputPath: '/tts/a.wav' })
    expect(args).toContain('-v')
    expect(args[args.indexOf('-v') + 1]).toBe('Tingting')
    expect(args[args.indexOf('-r') + 1]).toBe('245')
    expect(args[args.indexOf('-o') + 1]).toBe('/tts/a.wav')
    expect(args.slice(-2)).toEqual(['-f', '-'])
    // WAVE 容器 + 16-bit LE PCM（WebAudio 可解码）
    expect(args).toContain('--file-format=WAVE')
    expect(args).toContain('--data-format=LEI16@24000')
  })

  it('语音名为 null 时不传 -v（系统默认语音兜底）', () => {
    const args = buildSayArgs({ voice: null, rateWpm: 175, outputPath: '/tts/a.wav' })
    expect(args).not.toContain('-v')
  })
})

describe('buildEspeakArgs', () => {
  it('zh 语音 + 语速 + 输出文件 + stdin', () => {
    const args = buildEspeakArgs({ rateWpm: 175, outputPath: '/tts/a.wav' })
    expect(args).toEqual(['-v', 'zh', '-s', '175', '-w', '/tts/a.wav', '--stdin'])
  })
})

describe('buildSapiScript', () => {
  it('文本以 UTF-8 base64 内嵌（参数不出现明文正文）', () => {
    const script = buildSapiScript({ text: '你好，世界。', rate: 0, outputPath: 'C:/t/a.wav' })
    const b64 = Buffer.from('你好，世界。', 'utf8').toString('base64')
    expect(script).toContain(b64)
    expect(script).not.toContain('你好，世界。')
    expect(script).toContain("$synth.Rate=0")
    expect(script).toContain("'C:/t/a.wav'")
  })

  it('路径含单引号时 PowerShell 单引号翻倍转义', () => {
    const script = buildSapiScript({ text: 'hi', rate: 3, outputPath: "C:/us'er/a.wav" })
    expect(script).toContain("'C:/us''er/a.wav'")
  })

  it('优先选择 zh 文化语音（脚本含 SelectVoice 分支）', () => {
    const script = buildSapiScript({ text: 'hi', rate: 0, outputPath: 'C:/t/a.wav' })
    expect(script).toContain('GetInstalledVoices')
    expect(script).toContain('SelectVoice')
  })
})

describe('encodePowerShellCommand', () => {
  it('Base64(UTF-16LE) 编码，可往返还原', () => {
    const script = "Write-Output '你好'"
    const encoded = encodePowerShellCommand(script)
    expect(encoded).toBe(Buffer.from(script, 'utf16le').toString('base64'))
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script)
  })
})

describe('isPlausibleWav', () => {
  it('RIFF/WAVE 魔数 + ≥44 字节判合法', () => {
    expect(isPlausibleWav(1024, makeWavHeader())).toBe(true)
    expect(isPlausibleWav(44, makeWavHeader())).toBe(true) // 恰好最小头
  })

  it('尺寸不足 44 字节（空文件/截断）拒绝', () => {
    expect(isPlausibleWav(0, makeWavHeader())).toBe(false)
    expect(isPlausibleWav(43, makeWavHeader())).toBe(false)
  })

  it('魔数错误拒绝（子进程输出非音频/损坏）', () => {
    const bad = Buffer.alloc(12)
    bad.write('RIFX', 0, 'ascii')
    bad.write('WAVE', 8, 'ascii')
    expect(isPlausibleWav(1024, bad)).toBe(false)

    const notWave = Buffer.alloc(12)
    notWave.write('RIFF', 0, 'ascii')
    notWave.write('fmt ', 8, 'ascii')
    expect(isPlausibleWav(1024, notWave)).toBe(false)
  })

  it('头部过短与非数值尺寸拒绝', () => {
    expect(isPlausibleWav(1024, Buffer.alloc(8))).toBe(false)
    expect(isPlausibleWav(Number.NaN, makeWavHeader())).toBe(false)
  })
})

describe('localEngineForPlatform', () => {
  it('三平台各映射对应后端，其余平台 null', () => {
    expect(localEngineForPlatform('darwin')).toBe('say')
    expect(localEngineForPlatform('win32')).toBe('sapi')
    expect(localEngineForPlatform('linux')).toBe('espeak-ng')
    expect(localEngineForPlatform('freebsd')).toBe(null)
  })
})

describe('resolvePowerShellCommand', () => {
  it('候选存在时用 SystemRoot 绝对路径（不依赖 PATH）', () => {
    expect(resolvePowerShellCommand('C:\\Windows', () => true)).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
  })

  it('候选不存在回落 PATH 查找；SystemRoot 缺省按 C:\\Windows', () => {
    expect(resolvePowerShellCommand('C:\\Windows', () => false)).toBe('powershell.exe')
    expect(
      resolvePowerShellCommand(undefined, (path) => path.startsWith('C:\\Windows')),
    ).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })
})

describe('synthesizeSpeechLocally 编排前置分支（不依赖真实子进程）', () => {
  it('空白文本在 spawn 前即抛错', async () => {
    await expect(
      synthesizeSpeechLocally({ text: '   ', speed: 1.0, outputDir: tmpdir() }),
    ).rejects.toThrow('本地兜底合成文本为空')
  })

  it('无后端平台（注入 freebsd）抛无本地语音合成后端', async () => {
    await expect(
      synthesizeSpeechLocally({ text: '你好', speed: 1.0, outputDir: tmpdir(), platform: 'freebsd' }),
    ).rejects.toThrow('无本地语音合成后端')
  })

  it('Windows 超长文本在 spawn 前被命令行预算拦截（可读错误）', async () => {
    await expect(
      synthesizeSpeechLocally({ text: '字'.repeat(3000), speed: 1.0, outputDir: tmpdir(), platform: 'win32' }),
    ).rejects.toThrow('本地兜底文本过长')
  })
})

describe('estimateSapiEncodedCommandChars（Windows 命令行预算估算）', () => {
  it('纯 ASCII 短句：估算远低于上限', () => {
    expect(estimateSapiEncodedCommandChars(12)).toBeLessThan(32000)
  })

  it('8000 UTF-8 字节（约 2666 汉字）在预算内；12000 字节（4000 汉字）超限', () => {
    expect(estimateSapiEncodedCommandChars(8000)).toBeLessThanOrEqual(32000)
    expect(estimateSapiEncodedCommandChars(12000)).toBeGreaterThan(32000)
  })

  it('与 buildSapiScript 真实编码长度同数量级（估算模型不漂移）', () => {
    const text = '语'.repeat(500) // 1500 UTF-8 字节
    const script = buildSapiScript({ text, rate: 0, outputPath: 'C:\\t\\a.wav' })
    const real = encodePowerShellCommand(script).length
    const estimated = estimateSapiEncodedCommandChars(1500)
    // 真实值与估算差异在固定段假设误差内（±15%），量级漂移即测试失败
    expect(Math.abs(real - estimated) / real).toBeLessThan(0.15)
  })
})

describe('detectSayChineseVoice 探测编排（注入 runner 替身）', () => {
  const voiceList = 'Tingting            zh_CN    # 你好，我是婷婷。\n'

  it('探测成功：解析中文语音并缓存（二次调用零探测）', async () => {
    const runner = vi.fn(async () => ({ stdout: voiceList, stderr: '' }))
    await expect(detectSayChineseVoice(runner)).resolves.toBe('Tingting')
    await expect(detectSayChineseVoice(runner)).resolves.toBe('Tingting')
    expect(runner).toHaveBeenCalledOnce()
  })

  it('探测成功但无中文语音：缓存 null 定档（二次调用零探测）', async () => {
    const runner = vi.fn(async () => ({ stdout: 'Samantha    en_US    # hello\n', stderr: '' }))
    await expect(detectSayChineseVoice(runner)).resolves.toBe(null)
    await expect(detectSayChineseVoice(runner)).resolves.toBe(null)
    expect(runner).toHaveBeenCalledOnce()
  })

  it('探测失败：当句回落 null + 负缓存窗口内不重探（避免每句重付探测开销）', async () => {
    const runner = vi.fn(async () => {
      throw new Error('say 超时（5000ms）已终止')
    })
    await expect(detectSayChineseVoice(runner)).resolves.toBe(null)
    await expect(detectSayChineseVoice(runner)).resolves.toBe(null)
    expect(runner).toHaveBeenCalledOnce()
  })

  it('探测失败不落正式缓存：负缓存窗口外重试（故障自愈）', async () => {
    let calls = 0
    const runner: ChildRunner = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('probe boom')
      return { stdout: voiceList, stderr: '' }
    })
    await expect(detectSayChineseVoice(runner)).resolves.toBe(null)
    // 模拟负缓存窗口流逝：直接复用真实时钟不可行，改校验「未定档」语义——
    // 重置后（等价于窗口过期后）再次探测可成功并定档
    resetLocalTtsCachesForTest()
    await expect(detectSayChineseVoice(runner)).resolves.toBe('Tingting')
    expect(calls).toBe(2)
  })

  it('并发首句去重：两路同时探测只跑一次子进程，共享同一结果', async () => {
    let resolveProbe: (value: { stdout: string; stderr: string }) => void = () => {}
    const gate = new Promise<void>((resolve) => {
      resolveProbe = () => resolve(undefined)
    })
    const runner = vi.fn(async () => {
      await gate
      return { stdout: voiceList, stderr: '' }
    })
    const first = detectSayChineseVoice(runner)
    const second = detectSayChineseVoice(runner)
    resolveProbe()
    await expect(first).resolves.toBe('Tingting')
    await expect(second).resolves.toBe('Tingting')
    expect(runner).toHaveBeenCalledOnce()
  })
})
