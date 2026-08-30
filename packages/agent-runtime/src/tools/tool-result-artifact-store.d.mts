import type { AgentEvent, ToolResultEvent } from '@spark/protocol'

export const TOOL_RESULT_INLINE_CHAR_LIMIT: number
export const TOOL_RESULT_PREVIEW_CHAR_LIMIT: number
export const TOOL_RESULT_READ_CHAR_LIMIT: number
export const TOOL_RESULT_ARTIFACT_MAX_BYTES: number

export interface ToolResultEnvelope {
  kind: 'spark.tool_result_envelope'
  version: 1
  toolName?: string
  toolCallId?: string
  status: string
  preview: {
    strategy: 'full' | 'error-context-and-boundaries' | 'head-and-tail' | 'sanitized-and-boundaries'
    truncated: boolean
    text: string
  }
  artifact:
    | {
        available: true
        artifactId: string
        sha256: string
        format: 'text' | 'json'
        mimeType: string
        bytes: number
        characters: number
        relativePath: string
        reused: boolean
      }
    | {
        available: false
        reason: string
        format: 'text' | 'json'
        mimeType: string
        bytes: number
        characters: number
      }
  continuation: null | {
    listTool: string
    readTool: string
    searchTool: string
  }
}

export function governMcpToolResult(
  result: Record<string, unknown>,
  options: { workspaceRoot: string; toolName?: string; toolCallId?: string },
): Record<string, unknown>

export function governAgentToolResultEvent(
  event: ToolResultEvent,
  workspaceRoot: string,
): ToolResultEvent
export function governAgentToolResultEvent(event: AgentEvent, workspaceRoot: string): AgentEvent

export function readToolResultArtifact(
  workspaceRoot: string,
  artifactId: string,
  options?: { offset?: number; limit?: number },
): {
  artifactId: string
  format: 'text' | 'json'
  offset: number
  limit: number
  content: string
  nextOffset: number | null
  totalCharacters: number
  bytes: number
  eof: boolean
}

export function searchToolResultArtifact(
  workspaceRoot: string,
  artifactId: string,
  query: string,
  options?: { caseSensitive?: boolean; maxMatches?: number; contextChars?: number },
): {
  artifactId: string
  query: string
  caseSensitive: boolean
  matches: Array<{ offset: number; start: number; end: number; snippet: string }>
  totalMatches: number
  truncated: boolean
}

export function listToolResultArtifacts(
  workspaceRoot: string,
  options?: { limit?: number },
): Array<{
  artifactId: string
  format: 'text' | 'json'
  bytes: number
  updatedAt: string
}>
