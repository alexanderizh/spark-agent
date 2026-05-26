/**
 * About 子页面
 *
 * 设计规范：
 *   - 应用信息（名称、版本、构建号）
 *   - 技术栈信息
 *   - 系统信息（Electron 版本、Node 版本、Chrome 版本）
 */

import { Card, Badge } from '@spark/ui-kit'
import { Sparkles } from 'lucide-react'

/* ---- 应用信息 ---- */
const appInfo = [
  { key: '应用名称', value: 'Spark Agent' },
  { key: '版本', value: '0.1.0' },
  { key: '构建号', value: 'dev-build' },
  { key: '许可证', value: 'MIT' },
] as const

const techStack = [
  { key: 'Electron', value: '31.x' },
  { key: 'React', value: '19.x' },
  { key: 'TypeScript', value: '5.5+' },
  { key: 'Tailwind CSS', value: '4.x' },
  { key: 'Radix UI', value: '最新' },
  { key: 'SQLite', value: 'better-sqlite3' },
] as const

const systemInfo = [
  { key: 'Node.js', value: '22.x' },
  { key: 'Chrome', value: '126.x' },
  { key: 'V8', value: '12.x' },
  { key: 'OS', value: navigator?.platform ?? 'Unknown' },
] as const

export function AboutSubPage() {
  return (
    <div className="h-full overflow-y-auto p-5">
      {/* Logo 和应用名称 */}
      <div className="mb-6 flex flex-col items-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-primary shadow-md">
          <Sparkles size={28} className="text-primary-fg" />
        </div>
        <h2 className="text-[var(--font-xl)] font-bold text-text-strong">
          Spark Agent
        </h2>
        <p className="text-[var(--font-sm)] text-text-muted">
          Local-first AI Agent Desktop Workbench
        </p>
        <Badge variant="primary" className="mt-2">
          v0.1.0-beta
        </Badge>
      </div>

      {/* 应用信息 */}
      <Card padding="md" className="mb-4">
        <h3 className="mb-2 text-[var(--font-sm)] font-semibold text-text-strong">
          应用信息
        </h3>
        <div className="flex flex-col gap-1.5">
          {appInfo.map((item) => (
            <div key={item.key} className="flex items-center justify-between">
              <span className="text-[var(--font-xs)] text-text-muted">{item.key}</span>
              <span className="text-[var(--font-xs)] text-text">{item.value}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 技术栈 */}
      <Card padding="md" className="mb-4">
        <h3 className="mb-2 text-[var(--font-sm)] font-semibold text-text-strong">
          技术栈
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {techStack.map((tech) => (
            <Badge key={tech.key} variant="default">
              {tech.key} {tech.value}
            </Badge>
          ))}
        </div>
      </Card>

      {/* 系统信息 */}
      <Card padding="md">
        <h3 className="mb-2 text-[var(--font-sm)] font-semibold text-text-strong">
          系统信息
        </h3>
        <div className="flex flex-col gap-1.5">
          {systemInfo.map((item) => (
            <div key={item.key} className="flex items-center justify-between">
              <span className="text-[var(--font-xs)] text-text-muted">{item.key}</span>
              <span className="text-[var(--font-xs)] text-text">{item.value}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
