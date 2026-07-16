import type { LogLevel, LogReadRequest } from '@spark/protocol'

export type LogViewerScope = 'all' | 'canvas'
export type LogViewerLevel = 'all' | LogLevel

export function buildLogReadRequest(scope: LogViewerScope, level: LogViewerLevel): LogReadRequest {
  return {
    maxLines: 500,
    ...(scope === 'canvas' ? { scope } : {}),
    ...(level === 'all' ? {} : { levels: [level] }),
  }
}
