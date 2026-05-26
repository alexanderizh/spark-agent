/**
 * Rules 子页面
 *
 * 设计规范：
 *   - 6 层规则树（System → Team → User → Project → Workflow → Agent）
 *   - 来源标注，冲突高亮
 *   - 规则列表：优先级 + 内容 + 来源层级
 */

import { ScrollArea, Card, Badge, Button } from '@spark/ui-kit'
import { Plus, ChevronRight } from 'lucide-react'

/* ---- 规则层级 ---- */
const ruleLayers = [
  { key: 'system', label: 'System', desc: '系统级规则，全局生效', count: 3 },
  { key: 'team', label: 'Team', desc: '团队共享规则', count: 5 },
  { key: 'user', label: 'User', desc: '用户个人规则', count: 2 },
  { key: 'project', label: 'Project', desc: '项目级规则', count: 8 },
  { key: 'workflow', label: 'Workflow', desc: '工作流级规则', count: 1 },
  { key: 'agent', label: 'Agent', desc: 'Agent 专属规则', count: 4 },
] as const

/* ---- Mock 规则数据 ---- */
const rules = [
  { id: '1', content: '使用 TypeScript strict mode 进行代码编写', layer: 'system', source: '系统默认' },
  { id: '2', content: '所有 PR 必须包含至少一个测试用例', layer: 'team', source: '团队规范' },
  { id: '3', content: '回复使用中文，代码注释使用英文', layer: 'user', source: '个人偏好' },
  { id: '4', content: '使用 React 函数组件 + hooks 模式', layer: 'project', source: 'spark-core' },
  { id: '5', content: '优先使用 Radix UI 无头组件', layer: 'project', source: 'spark-core' },
  { id: '6', content: '运行前检查所有文件依赖关系', layer: 'workflow', source: 'deploy.yml' },
  { id: '7', content: '仅操作指定目录下的文件', layer: 'agent', source: 'code-reviewer' },
] as const

const layerColors: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'danger' | 'default'> = {
  system: 'danger',
  team: 'warning',
  user: 'primary',
  project: 'info',
  workflow: 'success',
  agent: 'default',
}

export function RulesSubPage() {
  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        {/* 标题 + 操作 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[var(--font-lg)] font-semibold text-text-strong">
              Rules
            </h2>
            <p className="text-[var(--font-xs)] text-text-muted">
              管理 Agent 行为规则，按层级覆盖
            </p>
          </div>
          <Button size="sm">
            <Plus size={14} />
            添加规则
          </Button>
        </div>

        {/* 层级概览 */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          {ruleLayers.map((layer) => (
            <Card key={layer.key} padding="sm" className="cursor-pointer hover:bg-hover transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[var(--font-sm)] font-medium text-text-strong">
                    {layer.label}
                  </p>
                  <p className="text-[var(--font-xs)] text-text-muted">
                    {layer.desc}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant={layerColors[layer.key] ?? 'default'}>
                    {layer.count}
                  </Badge>
                  <ChevronRight size={14} className="text-text-faint" />
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* 规则列表 */}
        <h3 className="mb-2 text-[var(--font-sm)] font-medium text-text-strong">
          所有规则
        </h3>
        <Card padding="none">
          {rules.map((rule, idx) => (
            <div
              key={rule.id}
              className={`flex items-start gap-3 px-3 py-2.5 ${
                idx > 0 ? 'border-t border-divider' : ''
              } hover:bg-hover transition-colors cursor-pointer`}
            >
              <Badge variant={layerColors[rule.layer] ?? 'default'} className="mt-0.5 shrink-0">
                {rule.layer}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-[var(--font-sm)] text-text truncate">
                  {rule.content}
                </p>
                <p className="text-[var(--font-xs)] text-text-faint">
                  来源：{rule.source}
                </p>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </ScrollArea>
  )
}
