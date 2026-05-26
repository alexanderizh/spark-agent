import type { ReactElement } from 'react'

export function App(): ReactElement {
  return (
    <div className="flex h-screen items-center justify-center bg-bg text-text">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-[var(--font-2xl)] font-bold text-text-strong">
          Spark Agent
        </h1>
        <p className="text-[var(--font-base)] text-text-muted">
          Local-first AI Agent Desktop Workbench
        </p>
        <p className="text-[var(--font-xs)] text-text-faint">
          v0.1.0 — P0-03 Design System Ready
        </p>
      </div>
    </div>
  )
}
