import type { LogLevel } from '@spark/shared'

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])

export function resolveTelemetryLogLevel(value: unknown): LogLevel {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    const configured = (value as { logLevel?: unknown }).logLevel
    if (typeof configured === 'string' && LOG_LEVELS.has(configured as LogLevel)) {
      return configured as LogLevel
    }
  }
  return 'info'
}
