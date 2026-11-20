export interface BridgeApprovalItem {
  requestId: string
  sessionId: string
  toolName: string
  /** 权限动作分类（file_write / command_exec / …） */
  action: string
  riskLevel: 'low' | 'medium' | 'high'
  toolInput: Record<string, unknown>
  /** ISO；旧版桌面端缺省为空串 */
  createdAt: string
  defaultToNo?: boolean
}

export interface BridgeQuestionOption {
  label: string
  description?: string
  value?: string
  allowsFreeText?: boolean
  freeTextPlaceholder?: string
}

export interface BridgeQuestionPrompt {
  id?: string
  question: string
  header: string
  type?: 'single_choice' | 'multi_choice' | 'text'
  required?: boolean
  placeholder?: string
  multiline?: boolean
  allowSkip?: boolean
  allowOther?: boolean
  otherOptionLabel?: string
  otherPlaceholder?: string
  options?: BridgeQuestionOption[]
  multiSelect?: boolean
}

export interface BridgeQuestionItem {
  questionId: string
  sessionId: string
  createdAt: string
  questions: BridgeQuestionPrompt[]
}

export interface BridgeInteractions {
  approvals: BridgeApprovalItem[]
  questions: BridgeQuestionItem[]
}

export type BridgeApprovalDecision = 'allow-once' | 'allow-session' | 'deny'
