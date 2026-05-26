/**
 * Model Profiles 子页面
 *
 * 设计规范：
 *   - 模型列表（名称 + Provider/Model + Capability badges + 价格）
 *   - 新建/编辑模型 Profile 表单
 */

import { ScrollArea, Card, Badge, Button, Input } from '@spark/ui-kit'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'

/* ---- Mock Model 数据 ---- */
const models = [
  { id: '1', name: '快速编码', provider: 'Anthropic', model: 'Claude Sonnet 4.5', capabilities: ['代码', '对话', '分析'], price: '$3/M', status: 'active' as const },
  { id: '2', name: '深度推理', provider: 'Anthropic', model: 'Claude Opus 4', capabilities: ['推理', '分析'], price: '$15/M', status: 'active' as const },
  { id: '3', name: '轻量对话', provider: 'Anthropic', model: 'Claude Haiku 4', capabilities: ['对话', '快速'], price: '$0.25/M', status: 'active' as const },
  { id: '4', name: 'Codex 编程', provider: 'OpenAI', model: 'Codex GPT-5', capabilities: ['代码', 'AGI'], price: '$10/M', status: 'inactive' as const },
  { id: '5', name: '通用助手', provider: 'OpenAI', model: 'GPT-5', capabilities: ['对话', '推理', '分析'], price: '$5/M', status: 'active' as const },
] as const

export function ModelsSubPage() {
  const [search, setSearch] = useState('')

  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        {/* 标题 + 操作 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[var(--font-lg)] font-semibold text-text-strong">
              Model Profiles
            </h2>
            <p className="text-[var(--font-xs)] text-text-muted">
              管理模型配置和 Profile
            </p>
          </div>
          <Button size="sm">
            <Plus size={14} />
            新建 Profile
          </Button>
        </div>

        {/* 搜索栏 */}
        <div className="mb-4">
          <Input
            placeholder="搜索模型..."
            inputSize="sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>

        {/* 模型列表 */}
        <div className="flex flex-col gap-2">
          {models
            .filter((m) => m.name.includes(search) || m.model.includes(search))
            .map((model) => (
              <Card key={model.id} variant="interactive" padding="md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-soft text-[var(--font-xs)] font-semibold text-text-strong">
                      {model.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-[var(--font-sm)] font-medium text-text-strong">
                        {model.name}
                      </p>
                      <p className="text-[var(--font-xs)] text-text-muted">
                        {model.provider} / {model.model}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      {model.capabilities.map((cap) => (
                        <Badge key={cap} variant="info">
                          {cap}
                        </Badge>
                      ))}
                    </div>
                    <span className="text-[var(--font-xs)] text-text-faint">
                      {model.price}
                    </span>
                    <Badge variant={model.status === 'active' ? 'success' : 'default'}>
                      {model.status === 'active' ? '已启用' : '未启用'}
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
        </div>
      </div>
    </ScrollArea>
  )
}
