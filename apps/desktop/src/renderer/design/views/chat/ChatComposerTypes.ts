import type { ReactNode } from 'react'
import type {
  SessionAgentAdapter,
  SessionAttachment,
  SessionChatMode,
  CliSparkOverride,
  SessionPermissionMode,
  SessionReasoningEffort,
  WorkspaceGitBranch,
} from '@spark/protocol'

export type BranchState = {
  currentBranch: string | null
  /** true 时 currentBranch 为分离头指针指向的 tag 名或短 SHA，而非分支名。 */
  detachedHead?: boolean | undefined
  branches: string[]
  branchDetails?: WorkspaceGitBranch[] | undefined
}
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
  cliSparkOverride?: CliSparkOverride | null
}

export type QueuedMessage = {
  id: string
  turnId: string
  content: string
  enqueuedAt: string
  attachments: ComposerAttachment[]
  sessionReferences: ComposerSessionReference[]
  /** Internal queued prompts stay controllable but cannot be copied into the user composer. */
  editable: boolean
}

export type ComposerAttachment = SessionAttachment & {
  id: string
  name: string
  previewPath?: string
  previewUrl?: string
}

export type ComposerSessionReference = {
  referenceId?: string
  sourceSessionId: string
  title: string
  snapshotSeq?: number
  projectId?: string | null
  turnCount?: number
  status?: 'active' | 'revoked' | 'unavailable' | string
}

export type ComposerDraftSnapshot = {
  value: string
  attachments: ComposerAttachment[]
  sessionReferences: ComposerSessionReference[]
  manualExpanded: boolean
}

export const EMPTY_COMPOSER_DRAFT: ComposerDraftSnapshot = {
  value: '',
  attachments: [],
  sessionReferences: [],
  manualExpanded: false,
}

export type MessageAttachment = {
  type: 'image' | 'file' | 'directory'
  path: string
  name?: string
  /** Renderer-only local preview. Never forwarded to the Agent SDK. */
  previewPath?: string
  /** Renderer-only URL that can be displayed immediately. */
  previewUrl?: string
}

export type ComposerPrefillPayload = {
  text: string
  attachments: MessageAttachment[]
  sessionReferences?: ComposerSessionReference[]
  agentId?: string
}

export type ComposerInputSelection = {
  start: number
  end: number
}

export type ComposerInputHandle = {
  focus(): void
  getValue(): string
  getSelection(): ComposerInputSelection
  setSelectionRange(start: number, end: number): void
  select(): void
  replaceSelection(text: string): void
  getElement(): HTMLElement | null
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
  target: ComposerInputHandle
  hasSelection: boolean
  isEditable: boolean
}
