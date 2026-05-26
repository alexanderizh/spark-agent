/**
 * Providers 子页面
 *
 * 设计规范：
 *   - Provider 列表（图标 + 名称 + 状态灯 + Profile chips）
 *   - 添加 Provider 按钮
 *   - 连接测试按钮
 */

import { ScrollArea, Card, Badge, Button } from '@spark/ui-kit'
import { Plus, Wifi, WifiOff, RefreshCw } from 'lucide-react'

/* ---- Mock Provider 数据 ---- */
const providers = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    status: 'online' as const,
    profiles: ['Claude Sonnet 4.5', 'Claude Opus 4', 'Claude Haiku 4'],
    latency: '120ms',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    status: 'online' as const,
    profiles: ['GPT-5', 'Codex GPT-5'],
    latency: '95ms',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    status: 'degraded' as const,
    profiles: ['DeepSeek V3'],
    latency: '350ms',
  },
  {
    id: 'codex',
    name: 'Codex',
    status: 'offline' as const,
    profiles: [] as const,
    latency: '—',
  },
] as const

export function ProvidersSubPage() {
  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        {/* 标题 + 操作 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[var(--font-lg)] font-semibold text-text-strong">
              Providers
            </h2>
            <p className="text-[var(--font-xs)] text-text-muted">
              管理 AI 服务提供商的连接和配置
            </p>
          </div>
          <Button size="sm">
            <Plus size={14} />
            添加 Provider
          </Button>
        </div>

        {/* Provider 列表 */}
        <div className="flex flex-col gap-3">
          {providers.map((provider) => (
            <Card key={provider.id} variant="interactive" padding="md">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {/* 状态灯 */}
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      provider.status === 'online'
                        ? 'bg-success'
                        : provider.status === 'degraded'
                          ? 'bg-warning'
                          : 'bg-text-faint'
                    }`}
                  />
                  <div>
                    <p className="text-[var(--font-sm)] font-medium text-text-strong">
                      {provider.name}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[var(--font-xs)] text-text-muted">
                        {provider.profiles.length} Profiles
                      </span>
                      <span className="text-text-faint">·</span>
                      <span className="text-[var(--font-xs)] text-text-muted">
                        {provider.latency}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      provider.status === 'online'
                        ? 'success'
                        : provider.status === 'degraded'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {provider.status === 'online' ? (
                      <Wifi size={10} />
                    ) : (
                      <WifiOff size={10} />
                    )}
                    {provider.status === 'online'
                      ? '在线'
                      : provider.status === 'degraded'
                        ? '不稳定'
                        : '离线'}
                  </Badge>
                  <Button variant="ghost" size="xs">
                    <RefreshCw size={12} />
                  </Button>
                </div>
              </div>
              {/* Profile chips */}
              {provider.profiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {provider.profiles.map((profile) => (
                    <Badge key={profile} variant="primary">
                      {profile}
                    </Badge>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}
