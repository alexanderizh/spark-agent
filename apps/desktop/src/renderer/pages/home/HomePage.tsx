/**
 * Home 页面
 *
 * 设计规范（参考设计稿 Spark-Agent-Standalone.html）：
 *   - 全局栏：工作区名称 + 搜索框
 *   - 欢迎区：用户问候 + 运行状态摘要
 *   - 指标卡：四宫格（今日 Token / 今日成本 / 运行任务 / 沙箱等级）
 *   - 快捷操作：横向卡片组（新建聊天 / 打开项目 / 运行工作流 / 连接 MCP）
 *   - 最近会话：列表（标题 + 模型标签 + 状态 + 时间）
 *   - Provider 状态：在线状态灯 + 配置入口
 */

import {
  MessageSquare,
  FolderKanban,
  Workflow,
  Plug,
  Zap,
  DollarSign,
  Activity,
  Shield,
  ArrowRight,
} from 'lucide-react'
import { Card, Badge, Button, ScrollArea } from '@spark/ui-kit'

/* ---- 快捷操作数据 ---- */
const quickActions = [
  { icon: MessageSquare, label: '新建聊天', desc: '开始一段新的对话', color: 'text-primary' },
  { icon: FolderKanban, label: '打开项目', desc: '选择工作目录', color: 'text-success' },
  { icon: Workflow, label: '运行工作流', desc: '自动化任务流程', color: 'text-info' },
  { icon: Plug, label: '连接 MCP', desc: '扩展 Agent 能力', color: 'text-warning' },
] as const

/* ---- 指标数据（mock）---- */
const metrics = [
  { icon: Zap, label: '今日 Token', value: '12.4K', color: 'text-primary' },
  { icon: DollarSign, label: '今日成本', value: '$0.38', color: 'text-success' },
  { icon: Activity, label: '运行任务', value: '0', color: 'text-info' },
  { icon: Shield, label: '沙箱等级', value: 'Standard', color: 'text-warning' },
] as const

/* ---- 最近会话（mock）---- */
const recentSessions = [
  { title: '重构用户认证模块', project: 'spark-core', model: 'Claude Sonnet 4.5', time: '2 分钟前', status: 'success' as const },
  { title: '修复登录页面 Bug', project: 'spark-web', model: 'Codex GPT-5', time: '1 小时前', status: 'success' as const },
  { title: '添加单元测试覆盖', project: 'spark-core', model: 'DeepSeek V3', time: '昨天', status: 'warning' as const },
]

export function HomePage() {
  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        {/* ====== 欢迎区 ====== */}
        <div className="mb-6">
          <h1 className="text-[var(--font-2xl)] font-bold text-text-strong">
            欢迎回来
          </h1>
          <p className="mt-1 text-[var(--font-base)] text-text-muted">
            Claude Sonnet 4.5 · Codex GPT-5 已就绪
          </p>
        </div>

        {/* ====== 指标卡（四宫格）======= */}
        <div className="mb-6 grid grid-cols-4 gap-3">
          {metrics.map(({ icon: Icon, label, value, color }) => (
            <Card key={label} padding="md">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-bg-soft ${color}`}>
                  <Icon size={16} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-[var(--font-xs)] text-text-muted">{label}</p>
                  <p className="text-[var(--font-lg)] font-semibold text-text-strong">
                    {value}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* ====== 快捷操作 ====== */}
        <div className="mb-6">
          <h2 className="mb-3 text-[var(--font-base)] font-medium text-text-strong">
            快捷操作
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {quickActions.map(({ icon: Icon, label, desc, color }) => (
              <Card
                key={label}
                variant="interactive"
                padding="md"
                className="group"
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-bg-soft ${color}`}>
                    <Icon size={16} strokeWidth={1.8} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[var(--font-sm)] font-medium text-text-strong">
                      {label}
                    </p>
                    <p className="text-[var(--font-xs)] text-text-muted">
                      {desc}
                    </p>
                  </div>
                  <ArrowRight
                    size={14}
                    className="mt-1 text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text-muted"
                  />
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* ====== 最近会话 ====== */}
        <div className="mb-6">
          <h2 className="mb-3 text-[var(--font-base)] font-medium text-text-strong">
            最近会话
          </h2>
          <Card padding="none">
            {recentSessions.map((session, idx) => (
              <div
                key={session.title}
                className={`flex items-center gap-3 px-3 py-2.5 ${
                  idx > 0 ? 'border-t border-divider' : ''
                } hover:bg-hover transition-colors cursor-pointer`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--font-sm)] font-medium text-text truncate">
                    {session.title}
                  </p>
                  <p className="text-[var(--font-xs)] text-text-muted">
                    {session.project}
                  </p>
                </div>
                <Badge variant={session.status === 'success' ? 'success' : 'warning'}>
                  {session.model}
                </Badge>
                <span className="text-[var(--font-xs)] text-text-faint whitespace-nowrap">
                  {session.time}
                </span>
              </div>
            ))}
          </Card>
        </div>

        {/* ====== Provider 状态 ====== */}
        <div>
          <h2 className="mb-3 text-[var(--font-base)] font-medium text-text-strong">
            Provider 状态
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: 'Anthropic', models: 3, status: 'success' as const, latency: '120ms' },
              { name: 'OpenAI', models: 2, status: 'success' as const, latency: '95ms' },
              { name: 'DeepSeek', models: 1, status: 'warning' as const, latency: '350ms' },
              { name: 'Codex', models: 1, status: 'default' as const, latency: '—' },
            ].map((provider) => (
              <Card key={provider.name} variant="interactive" padding="md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        provider.status === 'success'
                          ? 'bg-success'
                          : provider.status === 'warning'
                            ? 'bg-warning'
                            : 'bg-text-faint'
                      }`}
                    />
                    <span className="text-[var(--font-sm)] font-medium text-text-strong">
                      {provider.name}
                    </span>
                  </div>
                  <Button variant="ghost" size="xs">
                    配置
                  </Button>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[var(--font-xs)] text-text-muted">
                  <span>{provider.models} Profiles</span>
                  <span>·</span>
                  <span>{provider.latency}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
