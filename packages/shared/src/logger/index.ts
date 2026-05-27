/**
 * Spark Agent 轻量日志模块
 *
 * 约束：
 *   - 禁止在日志中输出 API Key 明文，必须先经过 maskSecret()
 *   - 生产环境日志级别默认为 'warn'
 *   - 开发环境日志级别默认为 'debug'
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

export function createLogger(namespace: string) {
  return {
    debug(message: string, ...args: unknown[]) {
      if (shouldLog('debug')) console.debug(formatMessage('debug', namespace, message), ...args)
    },
    info(message: string, ...args: unknown[]) {
      if (shouldLog('info')) console.info(formatMessage('info', namespace, message), ...args)
    },
    warn(message: string, ...args: unknown[]) {
      if (shouldLog('warn')) console.warn(formatMessage('warn', namespace, message), ...args)
    },
    error(message: string, ...args: unknown[]) {
      if (shouldLog('error')) console.error(formatMessage('error', namespace, message), ...args)
    },
  }
}

export type Logger = ReturnType<typeof createLogger>
