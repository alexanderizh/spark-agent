/**
 * Skills 子页面
 *
 * 设计规范：
 *   - Skill 列表（名称 + 描述 + 状态 badge）
 *   - 启用/禁用开关
 */

import { ScrollArea, Card, Badge, Button } from '@spark/ui-kit'
import { Plus, Sparkles, ToggleLeft, ToggleRight } from 'lucide-react'

/* ---- Mock Skill 数据 ---- */
const skills = [
  {
    id: '1',
    name: 'browser-use',
    desc: '自动化浏览器交互：网页测试、表单填写、截图',
    enabled: true,
    version: '1.0.0',
  },
  {
    id: '2',
    name: 'code-review',
    desc: '代码审查：检查代码质量、安全漏洞和最佳实践',
    enabled: true,
    version: '1.2.0',
  },
  {
    id: '3',
    name: 'deploy-helper',
    desc: '部署助手：自动化构建、测试和发布流程',
    enabled: false,
    version: '0.8.0',
  },
  {
    id: '4',
    name: 'data-analysis',
    desc: '数据分析：CSV/JSON 处理、可视化图表生成',
    enabled: true,
    version: '2.1.0',
  },
]

export function SkillsSubPage() {
  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        {/* 标题 + 操作 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[var(--font-lg)] font-semibold text-text-strong">
              Skills
            </h2>
            <p className="text-[var(--font-xs)] text-text-muted">
              管理 Agent 可用的技能扩展
            </p>
          </div>
          <Button size="sm">
            <Plus size={14} />
            添加 Skill
          </Button>
        </div>

        {/* Skill 列表 */}
        <div className="flex flex-col gap-3">
          {skills.map((skill) => (
            <Card key={skill.id} variant="interactive" padding="md">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft">
                    <Sparkles size={14} className="text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[var(--font-sm)] font-medium text-text-strong">
                        {skill.name}
                      </p>
                      <Badge variant="default">v{skill.version}</Badge>
                    </div>
                    <p className="mt-0.5 text-[var(--font-xs)] text-text-muted">
                      {skill.desc}
                    </p>
                  </div>
                </div>
                <button className="shrink-0 text-text-muted hover:text-text transition-colors">
                  {skill.enabled ? (
                    <ToggleRight size={20} className="text-primary" />
                  ) : (
                    <ToggleLeft size={20} />
                  )}
                </button>
              </div>
            </Card>
          ))}
        </div>

        {/* 空状态 */}
        {skills.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <Sparkles size={32} strokeWidth={1.2} className="text-text-faint" />
            <p className="mt-3 text-[var(--font-sm)] text-text-muted">
              还没有安装任何 Skill
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
