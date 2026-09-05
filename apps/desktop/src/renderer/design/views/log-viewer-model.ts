import type { LogLevel, LogReadRequest } from '@spark/protocol'

export type LogViewerScope = 'all' | 'canvas' | 'tools'
export type LogViewerLevel = 'all' | LogLevel

export function buildLogReadRequest(scope: LogViewerScope, level: LogViewerLevel): LogReadRequest {
  return {
    maxLines: 500,
    ...(scope === 'all' ? {} : { scope }),
    ...(level === 'all' ? {} : { levels: [level] }),
  }
}
