/**
 * Projects 页面 — 占位
 */

import { FolderKanban } from 'lucide-react'

export function ProjectsPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <FolderKanban size={40} strokeWidth={1.2} className="text-text-faint" />
        <p className="text-[var(--font-base)] text-text-muted">项目管理即将上线</p>
      </div>
    </div>
  )
}
