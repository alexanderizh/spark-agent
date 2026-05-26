/**
 * Workflows 页面 — 占位
 */

import { Workflow } from 'lucide-react'

export function WorkflowsPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Workflow size={40} strokeWidth={1.2} className="text-text-faint" />
        <p className="text-[var(--font-base)] text-text-muted">工作流编排即将上线</p>
      </div>
    </div>
  )
}
