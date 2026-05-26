/**
 * Permissions 子页面
 *
 * 设计规范：
 *   - 权限策略列表（文件/命令/网络/MCP/Git 五类）
 *   - 审批模式下拉
 *   - 策略详情：类型 + 策略名 + 审批模式 + 描述
 */

import { ScrollArea, Card, Badge, Button } from '@spark/ui-kit'
import { Plus, FileText, Terminal, Globe, Plug, GitBranch } from 'lucide-react'

/* ---- 权限类别 ---- */
const permissionCategories = [
  { key: 'file', label: '文件操作', icon: FileText, desc: '读写文件、目录权限', count: 4 },
  { key: 'command', label: '命令执行', icon: Terminal, desc: 'Shell 命令执行权限', count: 3 },
  { key: 'network', label: '网络访问', icon: Globe, desc: 'HTTP 请求、WebSocket 连接', count: 2 },
  { key: 'mcp', label: 'MCP 工具', icon: Plug, desc: 'MCP 服务器工具调用权限', count: 5 },
  { key: 'git', label: 'Git 操作', icon: GitBranch, desc: 'Git commit、push 等操作', count: 2 },
] as const

/* ---- 审批模式 ---- */
type ApprovalMode = 'auto' | 'ask' | 'deny'

/* ---- Mock 策略数据 ---- */
const policies = [
  { id: '1', category: 'file', name: '读取工作区文件', mode: 'auto' as ApprovalMode, desc: '允许读取工作区内任意文件' },
  { id: '2', category: 'file', name: '写入工作区文件', mode: 'ask' as ApprovalMode, desc: '写入工作区文件前需确认' },
  { id: '3', category: 'file', name: '读取工作区外文件', mode: 'deny' as ApprovalMode, desc: '禁止读取工作区外的文件' },
  { id: '4', category: 'command', name: '运行 npm 脚本', mode: 'auto' as ApprovalMode, desc: '允许运行 package.json 中定义的脚本' },
  { id: '5', category: 'command', name: '执行任意 Shell 命令', mode: 'ask' as ApprovalMode, desc: '执行自定义命令需逐次确认' },
  { id: '6', category: 'network', name: 'API 请求', mode: 'auto' as ApprovalMode, desc: '允许向已配置的 API 端点发送请求' },
  { id: '7', category: 'git', name: 'Git Commit', mode: 'ask' as ApprovalMode, desc: '提交代码前需确认' },
  { id: '8', category: 'git', name: 'Git Push', mode: 'ask' as ApprovalMode, desc: '推送代码前需确认' },
] as const

const modeConfig: Record<ApprovalMode, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  auto: { label: '自动', variant: 'success' },
  ask: { label: '询问', variant: 'warning' },
  deny: { label: '拒绝', variant: 'danger' },
}

export function PermissionsSubPage() {
  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        {/* 标题 + 操作 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[var(--font-lg)] font-semibold text-text-strong">
              Permissions
            </h2>
            <p className="text-[var(--font-xs)] text-text-muted">
              管理 Agent 的操作权限和审批策略
            </p>
          </div>
          <Button size="sm">
            <Plus size={14} />
            添加策略
          </Button>
        </div>

        {/* 权限类别概览 */}
        <div className="mb-4 grid grid-cols-5 gap-2">
          {permissionCategories.map((cat) => (
            <Card key={cat.key} padding="sm" className="cursor-pointer hover:bg-hover transition-colors">
              <div className="flex flex-col items-center gap-1.5 text-center">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-soft text-text-muted">
                  <cat.icon size={14} strokeWidth={1.8} />
                </div>
                <p className="text-[var(--font-xs)] font-medium text-text-strong">
                  {cat.label}
                </p>
                <Badge variant="default">{cat.count}</Badge>
              </div>
            </Card>
          ))}
        </div>

        {/* 策略列表 */}
        <h3 className="mb-2 text-[var(--font-sm)] font-medium text-text-strong">
          权限策略
        </h3>
        <Card padding="none">
          {policies.map((policy, idx) => {
            const mode = modeConfig[policy.mode]
            return (
              <div
                key={policy.id}
                className={`flex items-center gap-3 px-3 py-2.5 ${
                  idx > 0 ? 'border-t border-divider' : ''
                } hover:bg-hover transition-colors cursor-pointer`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--font-sm)] font-medium text-text">
                    {policy.name}
                  </p>
                  <p className="text-[var(--font-xs)] text-text-muted">
                    {policy.desc}
                  </p>
                </div>
                <Badge variant={mode.variant}>
                  {mode.label}
                </Badge>
              </div>
            )
          })}
        </Card>
      </div>
    </ScrollArea>
  )
}
