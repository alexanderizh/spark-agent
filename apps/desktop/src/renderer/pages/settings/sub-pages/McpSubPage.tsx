/**
 * MCP 子页面
 *
 * 设计规范：
 *   - MCP 服务器连接列表
 *   - 连接状态灯 + 工具数量 + 一键配置
 */

import { ScrollArea, Card, Badge, Button } from '@spark/ui-kit'
import { Plus, Plug, Settings, Trash2 } from 'lucide-react'

/* ---- Mock MCP 服务器数据 ---- */
const mcpServers = [
  {
    id: '1',
    name: 'filesystem',
    transport: 'stdio',
    status: 'connected' as const,
    tools: 8,
    command: 'npx @anthropic/mcp-filesystem',
  },
  {
    id: '2',
    name: 'github',
    transport: 'stdio',
    status: 'connected' as const,
    tools: 12,
    command: 'npx @anthropic/mcp-github',
  },
  {
    id: '3',
    name: 'postgres',
    transport: 'sse',
    status: 'disconnected' as const,
    tools: 0,
    command: 'http://localhost:3001/mcp',
  },
]

export function McpSubPage() {
  return (
    <ScrollArea className="h-full">
      <div className="p-5">
        {/* 标题 + 操作 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-[var(--font-lg)] font-semibold text-text-strong">
              MCP 服务器
            </h2>
            <p className="text-[var(--font-xs)] text-text-muted">
              管理 Model Context Protocol 服务器连接
            </p>
          </div>
          <Button size="sm">
            <Plus size={14} />
            添加服务器
          </Button>
        </div>

        {/* 服务器列表 */}
        <div className="flex flex-col gap-3">
          {mcpServers.map((server) => (
            <Card key={server.id} variant="interactive" padding="md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      server.status === 'connected' ? 'bg-success' : 'bg-text-faint'
                    }`}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[var(--font-sm)] font-medium text-text-strong">
                        {server.name}
                      </p>
                      <Badge variant="default">
                        <Plug size={9} />
                        {server.transport}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[var(--font-xs)] text-text-muted font-mono">
                      {server.command}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[var(--font-xs)] text-text-muted">
                    {server.tools} 工具
                  </span>
                  <Badge variant={server.status === 'connected' ? 'success' : 'default'}>
                    {server.status === 'connected' ? '已连接' : '未连接'}
                  </Badge>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="xs">
                      <Settings size={12} />
                    </Button>
                    <Button variant="ghost" size="xs">
                      <Trash2 size={12} className="text-danger" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* 空状态提示 */}
        {mcpServers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <Plug size={32} strokeWidth={1.2} className="text-text-faint" />
            <p className="mt-3 text-[var(--font-sm)] text-text-muted">
              还没有连接任何 MCP 服务器
            </p>
            <Button variant="secondary" size="sm" className="mt-3">
              添加第一个服务器
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
