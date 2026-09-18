/**
 * Clipboard image reading without third-party dependencies.
 *
 * Every supported platform already ships a way to hand a pasted picture to a
 * script, so the engine shells out to the platform tool instead of pulling a
 * native clipboard binding into the CLI package. Each platform reports the
 * same failure vocabulary (`ImageReadFailureCode`), which the TUI renders as an
 * actionable one-line hint.
 *
 * macOS reads the pasteboard through JXA/AppKit (PNG → JPEG → copied file →
 * TIFF converted in process), Linux uses wl-paste/xclip, and Windows/WSL run a
 * STA PowerShell script. Nothing is written to disk on any path.
 */
import { spawn } from 'node:child_process'

import type { RuntimeLogger } from '../observability/logger.js'
import {
  IMAGE_LIMITS,
  detectImageMediaType,
  formatImageBytes,
  readImageDimensions,
  type ImageReadResult,
  type TurnImageAttachment,
} from './attachments.js'

/** Hard ceiling for a clipboard read; a bigger picture is rejected, not buffered. */
const READ_TIMEOUT_MS = 5_000
const MAX_STDOUT_BYTES = Math.ceil((IMAGE_LIMITS.maxBytesPerImage * 4) / 3) + 64 * 1_024

export type ClipboardPlatform = 'darwin' | 'linux-wayland' | 'linux-x11' | 'wsl' | 'windows'

export interface CommandResult {
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: string
  /** True when the child was killed for exceeding the byte budget. */
  readonly overflow: boolean
  /** True when the child was killed by the read timeout. */
  readonly timedOut: boolean
  /** Set when the process could not be spawned at all (e.g. ENOENT). */
  readonly spawnError?: string
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: {
      readonly timeoutMs: number
      readonly maxStdoutBytes: number
      readonly signal?: AbortSignal
    },
  ): Promise<CommandResult>
}

export interface ReadClipboardImageOptions {
  readonly platform?: NodeJS.Platform
  readonly environment?: NodeJS.ProcessEnv
  readonly run?: CommandRunner
  readonly signal?: AbortSignal
  readonly logger?: RuntimeLogger
  /**
   * Used when the pasteboard hands over a copied file instead of image data
   * (Finder copy): the original file keeps its full quality.
   */
  readonly readFile?: (path: string) => Promise<ImageReadResult>
}

/** Resolves the platform-specific clipboard strategy, or undefined when unsupported. */
export function detectClipboardPlatform(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): ClipboardPlatform | undefined {
  if (platform === 'darwin') return 'darwin'
  if (platform === 'win32') return 'windows'
  if (platform !== 'linux') return undefined
  if (environment.WSL_DISTRO_NAME !== undefined || environment.WSL_INTEROP !== undefined) {
    return 'wsl'
  }
  return environment.WAYLAND_DISPLAY !== undefined ? 'linux-wayland' : 'linux-x11'
}

export async function readClipboardImage(
  options: ReadClipboardImageOptions = {},
): Promise<ImageReadResult> {
  const platform = detectClipboardPlatform(
    options.platform ?? process.platform,
    options.environment ?? process.env,
  )
  if (platform === undefined) {
    return {
      ok: false,
      code: 'unsupported-platform',
      message: `当前平台暂不支持读取剪贴板图片，可改用 -i <图片路径> 附加图片文件。`,
    }
  }

  const run = options.run ?? defaultCommandRunner
  const startedAt = Date.now()
  const result =
    platform === 'darwin'
      ? await readViaAppleScript(run, options.signal, options.readFile)
      : platform === 'windows' || platform === 'wsl'
        ? await readViaPowerShell(run, platform, options.signal)
        : await readViaLinuxTool(run, platform, options.signal)

  options.logger?.debug(
    `clipboard read platform=${platform} ok=${result.ok} elapsedMs=${Date.now() - startedAt}` +
      (result.ok ? ` bytes=${result.image.bytes.byteLength}` : ` code=${result.code}`),
  )
  return result
}

/** macOS: one JXA/AppKit read that never touches the filesystem. */
async function readViaAppleScript(
  run: CommandRunner,
  signal: AbortSignal | undefined,
  readFile: ((path: string) => Promise<ImageReadResult>) | undefined,
): Promise<ImageReadResult> {
  const result = await runCommand(run, 'osascript', ['-l', 'JavaScript', '-e', MACOS_SCRIPT], signal)
  if (result.spawnError !== undefined) {
    return {
      ok: false,
      code: 'clipboard-unavailable',
      message: '无法调用 osascript 读取剪贴板，请确认系统工具可用。',
    }
  }
  if (result.timedOut) {
    return { ok: false, code: 'clipboard-unavailable', message: '读取剪贴板超时，请重试。' }
  }
  if (result.overflow) return tooLargeResult()
  const payload = parseJsonPayload(result.stdout)
  if (payload?.kind === 'none') {
    return {
      ok: false,
      code: 'no-image',
      message: '剪贴板里没有图片；先截图或复制一张图片再试。',
    }
  }
  if (payload?.kind === 'file' && typeof payload.path === 'string') {
    if (readFile === undefined) {
      return { ok: false, code: 'decode-failed', message: '剪贴板里是图片文件路径，但当前无法读取文件。' }
    }
    return readFile(payload.path)
  }
  if (payload?.kind !== 'image' || typeof payload.data !== 'string') {
    return { ok: false, code: 'decode-failed', message: '剪贴板图片解析失败，请重新复制后再试。' }
  }
  return toImageResult(payload.data)
}

/** Linux: prefer the session's own compositor tool, fall back to the other one. */
async function readViaLinuxTool(
  run: CommandRunner,
  platform: Extract<ClipboardPlatform, 'linux-wayland' | 'linux-x11'>,
  signal: AbortSignal | undefined,
): Promise<ImageReadResult> {
  const candidates =
    platform === 'linux-wayland'
      ? ([linuxCandidate('wl-paste'), linuxCandidate('xclip')] as const)
      : ([linuxCandidate('xclip'), linuxCandidate('wl-paste')] as const)
  let sawNoImage = false
  let sawConnectionProblem = false
  let missing: string[] = []
  let overflow = false
  let timedOut = false
  // A tool that actually ran already told us something; a missing sibling
  // tool must not turn its "no image" answer into "clipboard unavailable".
  let ranAny = false

  for (const candidate of candidates) {
    const result = await runCommand(run, candidate.command, candidate.args, signal)
    if (result.spawnError !== undefined) {
      missing = [...missing, candidate.command]
      continue
    }
    ranAny = true
    if (result.timedOut) {
      timedOut = true
      continue
    }
    if (result.overflow) {
      overflow = true
      continue
    }
    if (result.code !== 0) {
      if (looksLikeDisplayFailure(result.stderr)) sawConnectionProblem = true
      else sawNoImage = true
      continue
    }
    if (result.stdout.byteLength === 0) {
      sawNoImage = true
      continue
    }
    return toImageResult(result.stdout.toString('base64'))
  }

  if (overflow) return tooLargeResult()
  if (timedOut) {
    return { ok: false, code: 'clipboard-unavailable', message: '读取剪贴板超时，请重试。' }
  }
  if (!ranAny) {
    return {
      ok: false,
      code: 'clipboard-unavailable',
      message: `未找到剪贴板工具 ${missing.join('/')}；Wayland 请安装 wl-clipboard，X11 请安装 xclip，或改用 -i <图片路径>。`,
    }
  }
  if (sawConnectionProblem && !sawNoImage) {
    return {
      ok: false,
      code: 'clipboard-unavailable',
      message: '无法连接显示服务器读取剪贴板；请在图形会话内运行，或改用 -i <图片路径>。',
    }
  }
  return {
    ok: false,
    code: 'no-image',
    message: '剪贴板里没有图片；先截图或复制一张图片再试。',
  }
}

/** Windows and WSL: a STA PowerShell read, encoded to avoid quoting problems. */
async function readViaPowerShell(
  run: CommandRunner,
  platform: Extract<ClipboardPlatform, 'windows' | 'wsl'>,
  signal: AbortSignal | undefined,
): Promise<ImageReadResult> {
  const command = platform === 'wsl' ? 'powershell.exe' : 'powershell'
  const result = await runCommand(
    run,
    command,
    ['-STA', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(POWERSHELL_SCRIPT)],
    signal,
  )
  if (result.spawnError !== undefined) {
    return {
      ok: false,
      code: 'clipboard-unavailable',
      message:
        platform === 'wsl'
          ? '无法调用 powershell.exe 读取 Windows 剪贴板；请确认在 WSL 内可执行 Windows 命令。'
          : '无法调用 PowerShell 读取剪贴板。',
    }
  }
  if (result.timedOut) {
    return { ok: false, code: 'clipboard-unavailable', message: '读取剪贴板超时，请重试。' }
  }
  if (result.overflow) return tooLargeResult()
  const payload = parseJsonPayload(result.stdout)
  if (payload?.kind === 'none') {
    return {
      ok: false,
      code: 'no-image',
      message: '剪贴板里没有图片；先截图或复制一张图片再试。',
    }
  }
  if (payload?.kind !== 'image' || typeof payload.data !== 'string') {
    return { ok: false, code: 'decode-failed', message: '剪贴板图片解析失败，请重新复制后再试。' }
  }
  return toImageResult(payload.data)
}

interface JsonPayload {
  readonly kind?: string
  readonly mediaType?: string
  readonly data?: string
  readonly path?: string
}

/** Uses a global flag and zero-width lookbehind on 512x512 tiles. */
function parseJsonPayload(stdout: Buffer): JsonPayload | undefined {
  const text = stdout.toString('utf8').trim()
  if (text === '') return undefined
  const lastLine = text.slice(text.lastIndexOf('\n') + 1)
  try {
    const parsed: unknown = JSON.parse(lastLine)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Decodes base64, then re-sniffs the container instead of trusting the tool:
 * a platform script may hand back JPEG when PNG was requested.
 */
function toImageResult(base64: string): ImageReadResult {
  const trimmed = base64.trim()
  if (trimmed === '') {
    return { ok: false, code: 'decode-failed', message: '剪贴板图片为空，请重新复制后再试。' }
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(trimmed, 'base64')
  } catch {
    return { ok: false, code: 'decode-failed', message: '剪贴板图片解析失败，请重新复制后再试。' }
  }
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'decode-failed', message: '剪贴板图片解析失败，请重新复制后再试。' }
  }
  if (bytes.byteLength > IMAGE_LIMITS.maxBytesPerImage) return tooLargeResult()
  const mediaType = detectImageMediaType(bytes)
  if (mediaType === undefined) {
    return {
      ok: false,
      code: 'decode-failed',
      message: '剪贴板图片格式不受支持（仅支持 PNG/JPEG/WEBP/GIF）。',
    }
  }
  const dimensions = readImageDimensions(bytes, mediaType)
  const image: TurnImageAttachment = {
    bytes: new Uint8Array(bytes),
    mediaType,
    ...(dimensions === undefined ? {} : { width: dimensions.width, height: dimensions.height }),
  }
  return { ok: true, image }
}

function tooLargeResult(): ImageReadResult {
  return {
    ok: false,
    code: 'too-large',
    message: `剪贴板图片超过 ${formatImageBytes(IMAGE_LIMITS.maxBytesPerImage)} 上限，无法附加。`,
  }
}

interface LinuxCandidate {
  readonly command: string
  readonly args: readonly string[]
}

function linuxCandidate(command: 'wl-paste' | 'xclip'): LinuxCandidate {
  return command === 'wl-paste'
    ? { command, args: ['--type', 'image/png'] }
    : { command, args: ['-selection', 'clipboard', '-t', 'image/png', '-o'] }
}

function looksLikeDisplayFailure(stderr: string): boolean {
  return /can't open display|unable to open display|no display|wl_display|compositor|not running|failed to connect/i.test(
    stderr,
  )
}

async function runCommand(
  run: CommandRunner,
  command: string,
  args: readonly string[],
  signal: AbortSignal | undefined,
): Promise<CommandResult> {
  return run.run(command, args, {
    timeoutMs: READ_TIMEOUT_MS,
    maxStdoutBytes: MAX_STDOUT_BYTES,
    ...(signal === undefined ? {} : { signal }),
  })
}

/**
 * Minimal spawn wrapper: fixed argv (never a shell string), bounded stdout,
 * a hard timeout, and abort support so a slow clipboard never blocks the TUI.
 */
const defaultCommandRunner: CommandRunner = {
  run: (command, args, options) =>
    new Promise<CommandResult>((resolve) => {
      const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      const chunks: Buffer[] = []
      let captured = 0
      let overflow = false
      let timedOut = false
      let stderr = ''
      let settled = false

      const finish = (result: CommandResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const kill = (): void => {
        if (!child.killed) child.kill('SIGKILL')
      }
      const timer = setTimeout(() => {
        timedOut = true
        kill()
      }, options.timeoutMs)
      const onAbort = (): void => {
        overflow = false
        timedOut = true
        kill()
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })

      child.stdout.on('data', (chunk: Buffer) => {
        captured += chunk.byteLength
        if (captured > options.maxStdoutBytes) {
          overflow = true
          kill()
          return
        }
        chunks.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 4_096) stderr += chunk.toString('utf8')
      })
      child.on('error', (error: Error) => {
        finish({ code: -1, stdout: Buffer.alloc(0), stderr, overflow, timedOut, spawnError: error.message })
      })
      child.on('close', (code) => {
        finish({ code: code ?? -1, stdout: Buffer.concat(chunks), stderr, overflow, timedOut })
      })
    }),
}

/** Encodes a PowerShell script the way `-EncodedCommand` expects (UTF-16LE). */
function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * AppleScript/JXA pasteboard read: PNG, then JPEG, then a copied image file,
 * then TIFF converted to PNG in process. The result is one JSON line so the
 * Node side never has to parse raw binary.
 */
export const MACOS_SCRIPT = `ObjC.import('AppKit')
const pb = $.NSPasteboard.generalPasteboard
const base64 = (data) => ObjC.unwrap(data.base64EncodedStringWithOptions(0))
function readPasteboard() {
  const fileUrl = pb.dataForType('public.file-url')
  if (!fileUrl.isNil()) {
    const text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(fileUrl, $.NSUTF8StringEncoding))
    const path = text.startsWith('file://') ? decodeURIComponent(text.slice(7)) : text
    const lower = path.toLowerCase()
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.gif')
    ) {
      return { kind: 'file', path }
    }
  }
  const png = pb.dataForType('public.png')
  if (!png.isNil()) return { kind: 'image', mediaType: 'image/png', data: base64(png) }
  const jpeg = pb.dataForType('public.jpeg')
  if (!jpeg.isNil()) return { kind: 'image', mediaType: 'image/jpeg', data: base64(jpeg) }
  const tiff = pb.dataForType('public.tiff')
  if (!tiff.isNil()) {
    const rep = $.NSBitmapImageRep.imageRepWithData(tiff)
    if (!rep.isNil()) {
      const converted = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $())
      if (!converted.isNil()) return { kind: 'image', mediaType: 'image/png', data: base64(converted) }
    }
  }
  return { kind: 'none' }
}
// The final expression is what osascript writes to stdout; JXA's console.log
// goes to stderr, where the Node side never looks for the payload.
JSON.stringify(readPasteboard())`

/**
 * PowerShell clipboard read. `GetImage` needs an STA thread, which the caller
 * requests with `-STA`; the PNG is re-encoded in memory and printed as base64.
 */
export const POWERSHELL_SCRIPT = `$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $image = [System.Windows.Forms.Clipboard]::GetImage()
  if ($null -eq $image) {
    Write-Output '{"kind":"none"}'
  } else {
    $stream = New-Object System.IO.MemoryStream
    $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $data = [Convert]::ToBase64String($stream.ToArray())
    Write-Output ('{"kind":"image","mediaType":"image/png","data":"' + $data + '"}')
  }
} catch {
  Write-Output '{"kind":"none"}'
}`
