import type { ReactNode } from 'react'
import type {
  SessionAgentAdapter,
  SessionAttachment,
  SessionChatMode,
  SessionPermissionMode,
  SessionReasoningEffort,
} from '@spark/protocol'

export type BranchState = { currentBranch: string | null; branches: string[] }
export type AgentAdapter = SessionAgentAdapter
export type PermissionModeChoice = SessionPermissionMode
export type ComposerOptionTone = 'default' | 'auto' | 'danger'

export type ComposerMenuOption = {
  value: string
  label: string
  description?: string
  icon?: ReactNode
  tone?: ComposerOptionTone
}

export type ComposerPrefs = {
  adapter?: AgentAdapter
  providerProfileId?: string
  modelId?: string
  permissionMode?: PermissionModeChoice
  reasoningEffort?: SessionReasoningEffort
  agentId?: string
  teamHostAgentId?: string
  teamMemberAgentIds?: string[]
}

export type SessionRuntimePatch = {
  providerProfileId?: string
  modelId?: string | null
  agentId?: string
  agentAdapter?: AgentAdapter
  permissionMode?: PermissionModeChoice
  chatMode?: SessionChatMode
  reasoningEffort?: SessionReasoningEffort
  debugMode?: boolean
}

export type QueuedMessage = {
  id: string
  turnId: string
  content: string
  enqueuedAt: string
  attachments: ComposerAttachment[]
}

export type ComposerAttachment = SessionAttachment & {
  id: string
  name: string
  previewPath?: string
  previewUrl?: string
}

export type ComposerDraftSnapshot = {
  value: string
  attachments: ComposerAttachment[]
  manualExpanded: boolean
}

export const EMPTY_COMPOSER_DRAFT: ComposerDraftSnapshot = {
  value: '',
  attachments: [],
  manualExpanded: false,
}

export type MessageAttachment = {
  type: 'image' | 'file' | 'directory'
  path: string
  name?: string
}

export type ComposerPrefillPayload = {
  text: string
  attachments: MessageAttachment[]
  agentId?: string
}

export type ContextMenuItem = {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
}

export type ReplyToState = {
  messageId: string
  role: 'user' | 'assistant' | 'selection'
  agentId?: string
  agentName?: string
  contentPreview: string
}

export type TextEditMenuState = {
  x: number
  y: number
  target: HTMLTextAreaElement | HTMLInputElement
  hasSelection: boolean
  isEditable: boolean
}
