import type { SDKExecutorConfig } from './types.js'

export type CodexSandboxMode = 'workspace-write' | 'danger-full-access'
export type CodexApprovalPolicy = 'never' | 'on-request'
export type CodexApprovalsReviewer = 'auto_review'

export interface CodexPermissionPolicy {
  sandboxMode: CodexSandboxMode
  approvalPolicy: CodexApprovalPolicy
  approvalsReviewer?: CodexApprovalsReviewer
}

export function resolveCodexPermissionPolicy(
  mode: SDKExecutorConfig['permissionMode'],
  unattended: boolean,
): CodexPermissionPolicy {
  if (mode === 'codex-full-access') {
    return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' }
  }
  if (mode === 'codex-auto-review') {
    return {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    }
  }
  return {
    sandboxMode: 'workspace-write',
    approvalPolicy: unattended ? 'never' : 'on-request',
  }
}
