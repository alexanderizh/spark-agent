/**
 * Spark Agent 轻量日志模块
 *
 * 约束：
 *   - 禁止在日志中输出 API Key 明文，必须先经过 maskSecret()
 *   - 生产环境日志级别默认为 'warn'
 *   - 开发环境日志级别默认为 'debug'
 *
 * 文件落盘（可选）：
 *   - 调用 initFileLogger(logDir) 后，所有 createLogger 产出的日志会同时写入
 *     <logDir>/main.log；未初始化时维持纯 console 行为（零回归）。
 *   - 单文件达到 maxSizeBytes（默认 5MB）时轮转：main.log → main.1.log → ...，
 *     保留最近 maxFiles 份（默认 5 份）。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

type ProcessLike = {
  env?: Record<string, string | undefined>
}

const nodeEnv = (globalThis as typeof globalThis & { process?: ProcessLike }).process?.env?.['NODE_ENV']

let currentLevel: LogLevel = nodeEnv === 'production' ? 'warn' : 'debug'

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel]
}

function formatMessage(level: LogLevel, namespace: string, message: string): string {
  const ts = new Date().toISOString()
  return `[${ts}] [${level.toUpperCase()}] [${namespace}] ${message}`
}

// ─── 敏感字段脱敏 ──────────────────────────────────────────────────────────────
// 对 console/文件写入前的 args 做轻量脱敏：识别常见敏感键名，掩盖其字符串值。
// 仅覆盖最常见场景，不做递归深扫——保持轻量，与"轻量日志器"定位一致。
const SENSITIVE_KEY = /^(authorization|api[_-]?key|secret|token|password|pwd|bearer)$/i

function maskValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // 字符串里若疑似长密钥（sk-/Bearer/长度≥32 的连续字符），只保留前 4 位
    if (value.length >= 32 && /^(sk-|bearer\s|Bearer\s)/i.test(value)) {
      return value.slice(0, 4) + '*'.repeat(Math.min(value.length - 4, 16))
    }
    return value
  }
  return value
}

function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg, i) => {
    // 形如 { api_key: "xxx" } 的对象，掩盖敏感键的值
    if (arg != null && typeof arg === 'object' && !Array.isArray(arg)) {
      const obj = arg as Record<string, unknown>
      let touched = false
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(obj)) {
        if (SENSITIVE_KEY.test(key)) {
          out[key] = '****'
          touched = true
        } else {
          out[key] = obj[key]
        }
      }
      return touched ? out : arg
    }
    // 形如 "api_key=xxx" 或 "Authorization: Bearer xxx" 的字符串片段
    if (typeof arg === 'string' && SENSITIVE_KEY.test(arg.split(/[=:]\s*/)[0] ?? '')) {
      return arg.replace(/([=:]\s*).+$/, '$1****')
    }
    return maskValue(arg)
  })
}

// ─── 文件落盘 ─────────────────────────────────────────────────────────────────
// 采用同步写入（fs.appendFileSync），保证"写完即可读"——这对设置页实时查看
// 日志至关重要。日志是低频操作，同步开销可忽略。
type FileLoggerState = {
  dir: string
  currentPath: string
  maxSizeBytes: number
  maxFiles: number
  bytesWritten: number
} | null

let fileState: FileLoggerState = null

function getFs(): typeof import('node:fs') | null {
  try {
    // logger 运行在主进程（Node 环境），但避免在渲染进程/打包边界硬依赖
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:fs')
  } catch {
    return null
  }
}

function getPath(): typeof import('node:path') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:path')
  } catch {
    return null
  }
}

function rotateIfNeeded(): void {
  if (!fileState) return
  if (fileState.bytesWritten < fileState.maxSizeBytes) return
  const fs = getFs()
  const path = getPath()
  if (!fs || !path) return

  // 旋转：main.<N>.log → main.<N+1>.log，最旧的删除
  for (let i = fileState.maxFiles - 1; i >= 1; i--) {
    const src = path.join(fileState.dir, `main.${i}.log`)
    const dst = path.join(fileState.dir, `main.${i + 1}.log`)
    try {
      if (fs.existsSync(src)) {
        if (i + 1 >= fileState.maxFiles) {
          fs.unlinkSync(src) // 超出保留份数，删除
        } else {
          fs.renameSync(src, dst)
        }
      }
    } catch {
      /* 单个轮转失败不阻塞整体 */
    }
  }
  // main.log → main.1.log
  try {
    if (fs.existsSync(fileState.currentPath)) {
      fs.renameSync(fileState.currentPath, path.join(fileState.dir, 'main.1.log'))
    }
  } catch {
    /* ignore */
  }
  // 重置计数，后续写入会重新创建 main.log
  fileState.bytesWritten = 0
}

/** 确保日志目录存在，并刷新 bytesWritten 为当前文件实际大小。 */
function syncFileSize(): void {
  const fs = getFs()
  if (!fs || !fileState) return
  try {
    if (!fs.existsSync(fileState.dir)) {
      fs.mkdirSync(fileState.dir, { recursive: true })
    }
    const stat = fs.statSync(fileState.currentPath)
    fileState.bytesWritten = stat.size
  } catch {
    fileState.bytesWritten = 0
  }
}

export interface InitFileLoggerOptions {
  /** 单文件最大字节数，超过则轮转。默认 5MB。 */
  maxSizeBytes?: number
  /** 保留的日志文件份数（含当前 main.log）。默认 5。 */
  maxFiles?: number
  /** 日志文件名（不含目录）。默认 'main.log'。 */
  filename?: string
}

/**
 * 初始化文件日志。调用后，所有 createLogger 产出的日志会同步写入文件。
 * 重复调用会替换既有状态（重新打开目标文件）。
 * 仅在 Node 主进程可用；在不可用环境（如渲染进程）调用为 no-op。
 */
export function initFileLogger(logDir: string, opts: InitFileLoggerOptions = {}): void {
  const fs = getFs()
  const path = getPath()
  if (!fs || !path) return

  const filename = opts.filename ?? 'main.log'
  const maxSizeBytes = opts.maxSizeBytes ?? 5 * 1024 * 1024
  const maxFiles = Math.max(1, opts.maxFiles ?? 5)

  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
  } catch {
    return
  }

  fileState = {
    dir: logDir,
    currentPath: path.join(logDir, filename),
    maxSizeBytes,
    maxFiles,
    bytesWritten: 0,
  }
  syncFileSize()
}

function writeToFile(formatted: string, args: unknown[]): void {
  if (!fileState) return
  const fs = getFs()
  if (!fs) return
  const line = args.length > 0 ? `${formatted} ${safeStringify(args)}` : formatted
  const chunk = `${line}\n`
  try {
    fs.appendFileSync(fileState.currentPath, chunk, 'utf8')
    fileState.bytesWritten += Buffer.byteLength(chunk)
    if (fileState.bytesWritten >= fileState.maxSizeBytes) {
      rotateIfNeeded()
    }
  } catch {
    /* 文件写入失败不影响应用 */
  }
}

function safeStringify(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack ?? arg.message
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

export function createLogger(namespace: string) {
  return {
    debug(message: string, ...args: unknown[]) {
      if (!shouldLog('debug')) return
      const safeArgs = sanitizeArgs(args)
      const formatted = formatMessage('debug', namespace, message)
      console.debug(formatted, ...safeArgs)
      writeToFile(formatted, safeArgs)
    },
    info(message: string, ...args: unknown[]) {
      if (!shouldLog('info')) return
      const safeArgs = sanitizeArgs(args)
      const formatted = formatMessage('info', namespace, message)
      console.info(formatted, ...safeArgs)
      writeToFile(formatted, safeArgs)
    },
    warn(message: string, ...args: unknown[]) {
      if (!shouldLog('warn')) return
      const safeArgs = sanitizeArgs(args)
      const formatted = formatMessage('warn', namespace, message)
      console.warn(formatted, ...safeArgs)
      writeToFile(formatted, safeArgs)
    },
    error(message: string, ...args: unknown[]) {
      if (!shouldLog('error')) return
      const safeArgs = sanitizeArgs(args)
      const formatted = formatMessage('error', namespace, message)
      console.error(formatted, ...safeArgs)
      writeToFile(formatted, safeArgs)
    },
  }
}

export type Logger = ReturnType<typeof createLogger>

// ─── 日志读取与管理（供 IPC 调用）──────────────────────────────────────────────

export interface LogFileInfo {
  filePath: string
  sizeBytes: number
}

/** 返回当前日志文件路径；未初始化文件 logger 时返回 null。 */
export function getLogFilePath(): string | null {
  return fileState?.currentPath ?? null
}

/**
 * 读取日志文件尾部最近 maxLines 行。
 * levelFilter 不为空时，只返回包含指定级别的行。
 * 未初始化文件 logger 时返回空数组。
 */
export function readLogTail(maxLines = 500, levelFilter?: LogLevel[]): string[] {
  const fs = getFs()
  if (!fs || !fileState) return []
  let content: string
  try {
    content = fs.readFileSync(fileState.currentPath, 'utf8')
  } catch {
    return []
  }
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0)
  const filtered = levelFilter && levelFilter.length > 0 ? filterByLevel(lines, levelFilter) : lines
  return filtered.slice(-maxLines)
}

function filterByLevel(lines: string[], levels: LogLevel[]): string[] {
  const levelSet = new Set(levels.map((l) => l.toUpperCase()))
  return lines.filter((line) => {
    const match = line.match(/\]\s*\[(DEBUG|INFO|WARN|ERROR)\]\s*\[/)
    const lvl = match?.[1]
    return lvl != null && levelSet.has(lvl)
  })
}

/** 返回当前日志文件大小（字节）；不可用时返回 0。 */
export function getLogFileSize(): number {
  const fs = getFs()
  if (!fs || !fileState) return 0
  try {
    return fs.statSync(fileState.currentPath).size
  } catch {
    return 0
  }
}

/** 返回当前日志文件信息；未初始化时返回 null。 */
export function getLogInfo(): LogFileInfo | null {
  const p = getLogFilePath()
  if (!p) return null
  return { filePath: p, sizeBytes: getLogFileSize() }
}

/**
 * 清空当前日志文件内容。
 * @returns 成功与否
 */
export function clearLogFile(): boolean {
  const fs = getFs()
  if (!fs || !fileState) return false
  try {
    fs.writeFileSync(fileState.currentPath, '')
    fileState.bytesWritten = 0
    return true
  } catch {
    return false
  }
}
