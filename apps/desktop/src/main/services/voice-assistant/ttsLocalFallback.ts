/**
 * ttsLocalFallback — 本地系统 TTS 兜底合成（主进程）
 *
 * 云端 TTS 不可用（未配置渠道 / 渠道调用失败：网络错误、鉴权失败、限流等）时的
 * 最后防线：调用操作系统自带语音合成落盘 16-bit PCM wav，复用既有播放链路
 * （safe-file 读取 + WebAudio 解码 + 打断/看门狗/HUD 波形，全部原样生效）。
 *
 * 平台后端：
 * - macOS：say（系统自带，与浏览器 speechSynthesis 同一套系统语音；`say -v ?`
 *   探测中文语音，进程内缓存一次）
 * - Windows：System.Speech / SAPI5（PowerShell，系统自带；文本 base64 传参，
 *   规避 stdin 编码与引号转义问题；优先选择已安装的 zh 文化语音）
 * - Linux：espeak-ng（尽力支持，未安装即失败，由调用方回落原错误）
 *
 * 安全与健壮性：文本一律经 stdin / base64 传递（argv 不出现正文，杜绝命令注入）；
 * 单句独立超时 kill；产物文件名随机防并发碰撞；探测结果缓存避免每句开销（探测
 * 失败不落正式缓存、短 TTL 负缓存退避、并发去重，仅成功探测才定档）；成功产物
 * 统一做 RIFF/WAVE 魔数 + 尺寸自洽校验（RIFF/data 声明长度 vs 文件实际长度，
 * 防增量写盘未收尾的截断产物），坏文件当场按失败处理而非把错误推迟到渲染端。
 * 命令构造与解析逻辑均为导出纯函数（buildSayArgs / parseSayChineseVoice /
 * buildSapiScript / mapSpeed* / isPlausibleWav / localEngineForPlatform /
 * resolvePowerShellCommand / estimateSapiEncodedCommandChars），探测编排
 * detectSayChineseVoice 支持注入子进程 runner，便于单测覆盖缓存语义。
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'

const log = createLogger('voice-assistant')

/**
 * 本地兜底单句合成超时：正常秒级完成，超时 SIGKILL 防挂死。预算账：管线层单句
 * 总预算 30s（SYNTHESIS_TIMEOUT_MS，渠道尝试+本地兜底共享）——本地侧最坏
 * 「探测 5s + 合成 15s = 20s」，给渠道失败留 ≥10s 余量（未配置 ~0ms、DNS/TLS/
 * 4xx 类失败通常亚秒到数秒），避免兜底 promise 整体被管线超时掐掉变跳句。渠道
 * 挂起到自身 60s 超时的场景兜底天然赶不上（管线 30s 先到），属设计内边界。
 * 15s 上限对现实句长余量充足：实测 1000 字渲染约 2.5s（离线渲染远快于实时）。
 */
const LOCAL_TTS_TIMEOUT_MS = 15_000
/**
 * `say -v ?` 语音清单探测超时（仅首次触发）。实测冷启亚秒级，5s 是 10 倍余量；
 * 探测挂死被杀后当句回落系统默认语音，不阻断合成。
 */
const SAY_VOICE_PROBE_TIMEOUT_MS = 5_000
/** 探测失败负缓存 TTL：窗口内不重探（回落默认语音），避免 say -v ? 持续挂死时每句重复付出探测开销 */
const SAY_PROBE_NEGATIVE_CACHE_MS = 60_000
/**
 * Windows -EncodedCommand 命令行预算上限（CreateProcess 硬限 32767 UTF-16 字符，
 * 留余量给 powershell 路径与其余 argv）。超限 spawn 直接 EINVAL，报错含混且晚，
 * 不如提前拦截给出可读错误（正常句长远达不到：渲染端已按句切分）。
 */
const WINDOWS_COMMAND_LINE_LIMIT = 32_000

/**
 * 估算 SAPI 分支最终 -EncodedCommand 参数的字符数（纯函数）：文本 UTF-8 base64
 * 内嵌脚本（固定段约 600 字符）→ 整脚本 UTF-16LE 编码 → base64。
 */
export function estimateSapiEncodedCommandChars(textUtf8Bytes: number): number {
  const scriptChars = 600 + Math.ceil(textUtf8Bytes / 3) * 4
  return Math.ceil((scriptChars * 2) / 3) * 4
}
/** macOS say 默认语速（words per minute），ttsSpeed 1.0 的锚点 */
const SAY_BASE_WPM = 175

export type LocalTtsEngine = 'say' | 'sapi' | 'espeak-ng'

export interface LocalTtsSynthesisResult {
  filePath: string
  engine: LocalTtsEngine
}

/** ttsSpeed（0.5–2.0）→ say -r 语速（words per minute，clamp 100–400） */
export function mapSpeedToSayRateWpm(speed: number): number {
  const rate = Math.round(SAY_BASE_WPM * speed)
  return Math.min(400, Math.max(100, rate))
}

/** ttsSpeed（0.5–2.0）→ SAPI SpeechSynthesizer.Rate（-10–10，1.0 → 0） */
export function mapSpeedToSapiRate(speed: number): number {
  return Math.min(10, Math.max(-10, Math.round((speed - 1) * 10)))
}

/** ttsSpeed（0.5–2.0）→ espeak-ng -s 语速（words per minute，clamp 80–400） */
export function mapSpeedToEspeakWpm(speed: number): number {
  return Math.min(400, Math.max(80, Math.round(SAY_BASE_WPM * speed)))
}

/**
 * 经典优质中文语音（按简→繁→粤优先）：婷婷/美佳/善怡是 Apple 长期维护的标准
 * 中文音色。macOS 13+ 的 `say -v ?` 清单按字母序排列，首个 zh 语音常是 novelty
 * 搞笑/机器人音色（如 Eddy），首-match 策略会让所有现代 macOS 兜底都选中机械
 * 变声音色——与「可懂兜底」意图相悖，故优先白名单。
 */
const PREFERRED_ZH_VOICE_BASENAMES = ['Tingting', 'Meijia', 'Sinji']
/**
 * macOS novelty/机器人音色基础名（去尾部括注后比对）。清单按字母序时它们常排在
 * 标准 zh 语音之前；Eddy/Flo/Grandma/Grandpa/Reed/Rocko/Sandy/Shelley 为
 * Ventura+ 新增多语言 novelty 音色（会注册 zh_CN locale），其余为经典英文
 * novelty（防御性收录）。
 */
const NOVELTY_VOICE_BASENAMES = new Set([
  'Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley',
  'Eaton', 'Jacqui', 'Tinker', 'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing',
  'Bubbles', 'Cellos', 'Deranged', 'Good News', 'Hysterical', 'Junior',
  'Pipe Organ', 'Princess', 'Ralph', 'Trinoids', 'Whisper', 'Zarvox',
])

/** 语音显示名 → 基础名（去掉尾部 ASCII 括注，如 "Tingting (中文…)" → "Tingting"） */
function voiceBaseName(name: string): string {
  const cut = name.replace(/\(.*\)$/, '').trim()
  return cut.length > 0 ? cut : name
}

/**
 * 解析 `say -v ?` 输出中的中文语音名。行格式：
 * `Tingting            zh_CN    # 你好，我是婷婷。`
 * 语音名可含空格（如 "Yu-shu (Premium)"），按「名称 + zh locale + # 注释」
 * 三段式匹配。择音三级策略：① 经典优质中文语音白名单优先；② 排除 novelty
 * 搞笑/机器人音色取首个；③ 全部都是 novelty 时取首个（有总比没有强）。
 * 找不到中文语音返回 null（调用方回落系统默认语音，尽力朗读）。
 */
export function parseSayChineseVoice(voiceListOutput: string): string | null {
  const zhVoices: string[] = []
  for (const rawLine of voiceListOutput.split('\n')) {
    const match = /^(\S.*?)\s+(zh[-_][A-Za-z]+)\s+#/.exec(rawLine)
    const name = match?.[1]
    if (name != null && name.length > 0) zhVoices.push(name.trim())
  }
  if (zhVoices.length === 0) return null
  for (const preferred of PREFERRED_ZH_VOICE_BASENAMES) {
    const hit = zhVoices.find((voice) => voiceBaseName(voice) === preferred)
    if (hit != null) return hit
  }
  return zhVoices.find((voice) => !NOVELTY_VOICE_BASENAMES.has(voiceBaseName(voice))) ?? zhVoices[0] ?? null
}

/** 构造 macOS say 参数（文本经 stdin 传入：`-f -`，argv 不出现正文） */
export function buildSayArgs(options: {
  voice: string | null
  rateWpm: number
  outputPath: string
}): string[] {
  const args: string[] = []
  if (options.voice != null && options.voice.length > 0) args.push('-v', options.voice)
  args.push('-r', String(options.rateWpm))
  args.push('-o', options.outputPath)
  // 显式 WAVE 容器 + 16-bit LE PCM 24kHz：WebAudio decodeAudioData 可直接解码
  args.push('--file-format=WAVE', '--data-format=LEI16@24000')
  args.push('-f', '-')
  return args
}

/** 构造 Linux espeak-ng 参数（文本经 stdin 传入） */
export function buildEspeakArgs(options: { rateWpm: number; outputPath: string }): string[] {
  return ['-v', 'zh', '-s', String(options.rateWpm), '-w', options.outputPath, '--stdin']
}

/**
 * 构造 Windows SAPI 合成脚本（PowerShell）。文本以 UTF-8 base64 内嵌：
 * 参数不出现明文正文（防注入），且规避 PowerShell 参数/编码的引号转义问题；
 * 优先选择已安装的 zh 文化语音，没有则 SAPI 默认语音尽力朗读。
 */
export function buildSapiScript(options: { text: string; rate: number; outputPath: string }): string {
  const textB64 = Buffer.from(options.text, 'utf8').toString('base64')
  // PowerShell 单引号字符串内单引号翻倍转义（userData 路径一般无引号，防御性处理）
  const escapedPath = options.outputPath.replace(/'/g, "''")
  return [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Speech',
    `$text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${textB64}'))`,
    '$synth=New-Object System.Speech.Synthesis.SpeechSynthesizer',
    // Enabled 过滤：GetInstalledVoices() 按微软文档返回含 Enabled=false 的已禁用
    // 语音；选中禁用语音会让 SelectVoice/Speak 抛错，该用户每句兜底全失败
    '$zh=$synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like "zh*" } | Select-Object -First 1',
    'if ($zh) { $null=$synth.SelectVoice($zh.VoiceInfo.Name) }',
    `$synth.Rate=${options.rate}`,
    `$synth.SetOutputToWaveFile('${escapedPath}')`,
    '$synth.Speak($text)',
    '$synth.Dispose()',
  ].join('\n')
}

/** PowerShell -EncodedCommand 要求 Base64(UTF-16LE(script)) */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * WAV 产物最小合法性（纯函数）：魔数 + 尺寸字段自洽，防「退出码 0 但产物截断」。
 * 实测 say 增量写盘、RIFF/data 尺寸字段仅在收尾回填（CoreAudio 布局为
 * fmt → FLLR(4044) → data）：早杀产物 filesize=4096 且 RIFF 等式碰巧自洽但
 * dataSize=0；晚杀产物 RIFF size 停留在首块占位值。正常收尾产物两个等式均
 * 精确成立（实测 say；SAPI/espeak-ng 为标准 data 收尾布局）。坏文件交给渲染端
 * 会在 WebAudio 解码层炸出难归因的错误，这里当场按合成失败处理。
 */
export function isPlausibleWav(size: number, header: Buffer): boolean {
  if (!Number.isFinite(size) || size < 44 || header.length < 12) return false
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return false
  // 截断检测①：RIFF 声明长度与文件实际长度一致（抓晚杀：size 字段停在占位值）
  if (header.readUInt32LE(4) + 8 !== size) return false
  // 截断检测②：走 chunk 链找 data，声明尺寸 >0 且结束位置与文件长度一致
  // （抓早杀：等式碰巧自洽但 dataSize 仍是 0 占位）。data 为最后一个 chunk 是
  // 三平台写入器的共同行为；chunk 尺寸奇数时按规范 pad 1 字节对齐。
  let offset = 12
  while (offset + 8 <= header.length) {
    const chunkSize = header.readUInt32LE(offset + 4)
    if (header.toString('ascii', offset, offset + 4) === 'data') {
      return chunkSize > 0 && offset + 8 + chunkSize === size
    }
    offset += 8 + chunkSize + (chunkSize & 1)
  }
  return false
}

/** 读产物头部做 WAV 校验，不达标抛错（走既有失败清理与上抛路径） */
async function assertWavOutput(filePath: string): Promise<void> {
  const { size } = await stat(filePath)
  const handle = await open(filePath, 'r')
  try {
    // 窗口 8192 覆盖 say 的 FLLR 布局（data 头在 offset 4088）；读不满时零填充，
    // 链解析自然失败。SAPI/espeak-ng 的 data 在头部 ~44 偏移，远在窗口内
    const header = Buffer.alloc(8192)
    // 注意：fs/promises 无模块级 read（FileHandle.read 才是正确姿势——模块级
    // read 仅存在于回调版 node:fs，命名导入在真实运行时必炸 undefined）
    await handle.read(header, 0, 8192, 0)
    if (!isPlausibleWav(size, header)) {
      throw new Error(`本地合成产物校验失败（非 WAVE 或已截断，size=${size}）`)
    }
  } finally {
    await handle.close()
  }
}

interface ChildRunResult {
  stdout: string
  stderr: string
}

/** spawn + stdin 喂文本 + 超时 SIGKILL + 退出码校验（非零/启动失败/超时均 reject） */
function runChildProcess(
  command: string,
  args: string[],
  stdinText: string,
  timeoutMs: number,
): Promise<ChildRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    // 累积 Buffer、close 时一次性解码：data 边界跟随子进程 write 而非 UTF-8 序列，
    // 逐块 toString 会把切在多字节序列中间的字符变 U+FFFD——语音名一旦损坏
    // 并被缓存，之后每句 say -v <坏名> 都失败，兜底整体劣化为持续失效
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })
    child.on('error', (error) => {
      // 命令不存在 / 无法启动
      settle(() => reject(error))
    })
    child.on('close', (code) => {
      settle(() => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8')
        const stderr = Buffer.concat(stderrChunks).toString('utf8')
        if (timedOut) {
          reject(new Error(`${command} 超时（${timeoutMs}ms）已终止`))
        } else if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          const detail = stderr.trim().length > 0 ? `：${stderr.trim().slice(0, 200)}` : ''
          reject(new Error(`${command} 退出码 ${code}${detail}`))
        }
      })
    })
    // EPIPE（子进程提前退出）由 close 统一收口，这里仅防 unhandled error 崩进程
    child.stdin.on('error', () => {})
    child.stdin.end(stdinText, 'utf8')
  })
}

/**
 * `say -v ?` 中文语音探测缓存：undefined=未探测；null=探测成功但无中文语音。
 * 探测失败（子进程异常/超时）不写正式缓存：与「确无中文语音」区分开，避免一次
 * 瞬时失败让进程存活期内永久降级到英文音念中文；但会落一个短 TTL 负缓存
 * （SAY_PROBE_NEGATIVE_CACHE_MS）——探测持续挂死的故障态下，每句都重付一次
 * 探测开销会把「渠道失败+探测+合成」顶破管线 30s 预算，负缓存让窗口内的句子
 * 直接回落系统默认语音，窗口过后自动重探（自愈）。
 */
let sayChineseVoiceCache: string | null | undefined
/** 探测失败负缓存到期时间戳（Date.now 口径）；0 = 无负缓存 */
let sayProbeFailedUntil = 0
/** 探测并发去重：流水线并发 2 句同时首次兜底时只探测一次 */
let sayVoiceProbeInflight: Promise<string | null> | null = null

/** 单测用：重置探测缓存 */
export function resetLocalTtsCachesForTest(): void {
  sayChineseVoiceCache = undefined
  sayProbeFailedUntil = 0
  sayVoiceProbeInflight = null
}

/** 子进程执行器（导出类型仅供测试注入替身） */
export type ChildRunner = (
  command: string,
  args: string[],
  stdinText: string,
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string }>

/**
 * `say -v ?` 中文语音探测（runner 可注入供单测；缓存/负缓存/并发去重都在这里）。
 */
export async function detectSayChineseVoice(runner: ChildRunner = runChildProcess): Promise<string | null> {
  if (sayChineseVoiceCache !== undefined) return sayChineseVoiceCache
  if (Date.now() < sayProbeFailedUntil) return null
  if (sayVoiceProbeInflight != null) return sayVoiceProbeInflight
  sayVoiceProbeInflight = (async () => {
    try {
      const { stdout } = await runner('say', ['-v', '?'], '', SAY_VOICE_PROBE_TIMEOUT_MS)
      sayChineseVoiceCache = parseSayChineseVoice(stdout)
      if (sayChineseVoiceCache != null) {
        log.info(`[voice-assistant] local tts voice resolved: ${sayChineseVoiceCache}`)
      } else {
        log.info('[voice-assistant] local tts: no zh voice found, using system default')
      }
      return sayChineseVoiceCache
    } catch (error) {
      // 探测失败不阻断合成（当句回落系统默认语音）；负缓存窗口内跳过重探
      sayProbeFailedUntil = Date.now() + SAY_PROBE_NEGATIVE_CACHE_MS
      log.warn(
        `[voice-assistant] say voice probe failed (retry in ${Math.round(SAY_PROBE_NEGATIVE_CACHE_MS / 1000)}s): ${String(error)}`,
      )
      return null
    } finally {
      sayVoiceProbeInflight = null
    }
  })()
  return sayVoiceProbeInflight
}

/** 平台 → 本地合成后端（无后端平台返回 null） */
export function localEngineForPlatform(platform: NodeJS.Platform): LocalTtsEngine | null {
  if (platform === 'darwin') return 'say'
  if (platform === 'win32') return 'sapi'
  if (platform === 'linux') return 'espeak-ng'
  return null
}

/**
 * Windows PowerShell 命令解析：优先 SystemRoot 绝对路径（GUI 启动的进程 PATH
 * 环境可能受限），候选不存在时回落 PATH 查找。参数注入便于单测。
 */
export function resolvePowerShellCommand(
  systemRoot: string | undefined,
  exists: (path: string) => boolean,
): string {
  const root = systemRoot ?? 'C:\\Windows'
  const candidate = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  return exists(candidate) ? candidate : 'powershell.exe'
}

/**
 * 本地系统 TTS 合成一段文本为 wav 文件（落在 outputDir 内，随机文件名防并发碰撞）。
 * 失败抛错由调用方决定后续（ttsSynthesis 组合渠道原始错误上报）；残留半成品文件
 * 尽力清理。platform 参数供测试注入，缺省 process.platform。成功路径统一做
 * WAV 魔数校验（assertWavOutput）。
 */
export async function synthesizeSpeechLocally(options: {
  text: string
  /** ttsSpeed 口径（0.5–2.0，1.0 原速），映射到各平台语速参数 */
  speed: number
  outputDir: string
  platform?: NodeJS.Platform
}): Promise<LocalTtsSynthesisResult> {
  const platform = options.platform ?? process.platform
  const engine = localEngineForPlatform(platform)
  if (options.text.trim().length === 0) throw new Error('本地兜底合成文本为空')
  // speed 有限性自防御：NaN 会穿透 Math.min/max 映射链产出 "-r NaN" 类 argv
  // （macOS say 静默容错，但 Windows $synth.Rate=NaN 会稳定失败）。当前唯一调用
  // 方的 speed 来自协议层 readNumber 归一化（不可能非有限），这里防未来新调用
  // 方绕过协议层时静默劣化为必败。
  const speed = Number.isFinite(options.speed) ? options.speed : 1.0
  await mkdir(options.outputDir, { recursive: true })
  const outputPath = join(options.outputDir, `local-${randomUUID()}.wav`)
  const startedAt = Date.now()
  try {
    if (engine == null) {
      throw new Error(`当前平台（${platform}）无本地语音合成后端`)
    }
    if (engine === 'say') {
      const voice = await detectSayChineseVoice()
      await runChildProcess(
        'say',
        buildSayArgs({ voice, rateWpm: mapSpeedToSayRateWpm(speed), outputPath }),
        options.text,
        LOCAL_TTS_TIMEOUT_MS,
      )
    } else if (engine === 'sapi') {
      // 命令行长度预算拦截（超限 spawn EINVAL 且报错误导；约对应 2600+ 汉字）
      const textUtf8Bytes = Buffer.byteLength(options.text, 'utf8')
      if (estimateSapiEncodedCommandChars(textUtf8Bytes) > WINDOWS_COMMAND_LINE_LIMIT) {
        throw new Error(
          `本地兜底文本过长：Windows 语音合成经命令行传参，单句约支持 2600 个汉字（当前 ${textUtf8Bytes} UTF-8 字节）`,
        )
      }
      const script = buildSapiScript({
        text: options.text,
        rate: mapSpeedToSapiRate(speed),
        outputPath,
      })
      await runChildProcess(
        resolvePowerShellCommand(process.env.SystemRoot, (path) => existsSync(path)),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShellCommand(script)],
        '',
        LOCAL_TTS_TIMEOUT_MS,
      )
    } else {
      await runChildProcess(
        'espeak-ng',
        buildEspeakArgs({ rateWpm: mapSpeedToEspeakWpm(speed), outputPath }),
        options.text,
        LOCAL_TTS_TIMEOUT_MS,
      )
    }
    await assertWavOutput(outputPath)
    return { filePath: outputPath, engine }
  } catch (error) {
    // 失败残留清理（半成品 wav 留在 ttsDir 也无害——启动 sweep 会清扫，但即时清更干净）
    await unlink(outputPath).catch(() => {})
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    log.info(
      `[voice-assistant] local tts attempt finished in ${Date.now() - startedAt}ms (${
        engine ?? 'none'
      }, ${options.text.length} chars)`,
    )
  }
}
