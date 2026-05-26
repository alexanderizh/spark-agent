/**
 * Chat 页面
 *
 * 设计规范：
 *   - 左侧：会话列表面板（搜索框 + 新建按钮 + 会话列表）
 *     - 每条会话：标题 + 模型标签 + 时间 + 选中态高亮
 *   - 右侧：消息区 / 空状态
 *     - 空状态：品牌图标 + 引导文案
 *     - 消息区：消息流 + 输入框（Phase 1 实现）
 */

import { useState } from 'react'
import { ScrollArea, Card, Badge, Button, Input, Separator } from '@spark/ui-kit'
import {
  MessageSquare,
  Plus,
  Search,
  MoreHorizontal,
  Send,
  Bot,
  User,
  Code,
  Copy,
  Check,
} from 'lucide-react'

/* ---- Mock 会话数据 ---- */
interface Session {
  id: string
  title: string
  model: string
  time: string
  preview: string
  status: 'active' | 'archived'
}

const mockSessions: Session[] = [
  {
    id: '1',
    title: '重构用户认证模块',
    model: 'Claude Sonnet 4.5',
    time: '2 分钟前',
    preview: '我来看看这个模块的代码结构...',
    status: 'active',
  },
  {
    id: '2',
    title: '修复登录页面 Bug',
    model: 'Codex GPT-5',
    time: '1 小时前',
    preview: '问题定位到了，是 CSS 层叠优先级...',
    status: 'active',
  },
  {
    id: '3',
    title: '添加单元测试覆盖',
    model: 'DeepSeek V3',
    time: '昨天',
    preview: '已为 auth 模块添加了 12 个测试用例...',
    status: 'active',
  },
  {
    id: '4',
    title: 'API 接口文档生成',
    model: 'Claude Opus 4',
    time: '3 天前',
    preview: '接口文档已按 OpenAPI 3.0 格式生成...',
    status: 'archived',
  },
  {
    id: '5',
    title: '性能优化分析报告',
    model: 'Claude Sonnet 4.5',
    time: '上周',
    preview: '分析完成，主要瓶颈在数据库查询...',
    status: 'archived',
  },
]

/* ---- Mock 消息数据 ---- */
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  time: string
}

const mockMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'user',
    content: '帮我重构 src/auth 目录下的用户认证模块，目前代码耦合太严重了',
    time: '14:32',
  },
  {
    id: '2',
    role: 'assistant',
    content:
      '我来看看这个模块的代码结构。分析完成后，我建议将认证逻辑拆分为以下几个模块：\n\n1. **AuthService** — 核心认证逻辑（登录/注册/Token 刷新）\n2. **SessionManager** — 会话管理（创建/销毁/续期）\n3. **PermissionGuard** — 权限校验中间件\n4. **AuthProvider** — React Context 统一注入\n\n这样的拆分可以让每个模块职责单一，也方便后续扩展 OAuth 等第三方登录。',
    time: '14:32',
  },
  {
    id: '3',
    role: 'user',
    content: '按这个方案来，先从 AuthService 开始',
    time: '14:33',
  },
  {
    id: '4',
    role: 'assistant',
    content:
      '好的，开始重构 AuthService。主要改动：\n\n```typescript\n// src/auth/auth-service.ts\nexport class AuthService {\n  private readonly tokenKey = "auth_token";\n\n  constructor(\n    private readonly http: HttpClient,\n    private readonly crypto: CryptoService,\n  ) {}\n\n  async login(credentials: LoginDTO): Promise<AuthResult> {\n    const response = await this.http.post("/auth/login", credentials);\n    await this.storeToken(response.token);\n    return response;\n  }\n}\n```\n\n改动完成，TypeScript 编译 0 错误。',
    time: '14:34',
  },
]

export function ChatPage() {
  const [selectedId, setSelectedId] = useState<string | null>('1')
  const [searchQuery, setSearchQuery] = useState('')
  const [inputValue, setInputValue] = useState('')

  const filteredSessions = mockSessions.filter(
    (s) =>
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.model.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const selectedSession = mockSessions.find((s) => s.id === selectedId)

  return (
    <div className="flex h-full">
      {/* ====== 左侧：会话列表 ====== */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-border bg-bg-soft">
        {/* 搜索栏 + 新建按钮 */}
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
            />
            <Input
              placeholder="搜索会话..."
              inputSize="sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button size="sm" className="shrink-0">
            <Plus size={14} />
          </Button>
        </div>

        {/* 会话列表 */}
        <ScrollArea className="flex-1">
          <div className="flex flex-col p-1.5">
            {filteredSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setSelectedId(session.id)}
                className={`flex flex-col gap-1 rounded-sm px-3 py-2.5 text-left transition-colors ${
                  selectedId === session.id
                    ? 'bg-primary-soft'
                    : 'hover:bg-hover'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`truncate text-[var(--font-sm)] font-medium ${
                      selectedId === session.id ? 'text-primary' : 'text-text-strong'
                    }`}
                  >
                    {session.title}
                  </p>
                  <MoreHorizontal
                    size={14}
                    className="shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </div>
                <p className="truncate text-[var(--font-xs)] text-text-muted">
                  {session.preview}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="text-[10px]">
                    {session.model}
                  </Badge>
                  <span className="text-[var(--font-xs)] text-text-faint">
                    {session.time}
                  </span>
                </div>
              </button>
            ))}

            {/* 空搜索结果 */}
            {filteredSessions.length === 0 && (
              <div className="flex flex-col items-center py-8">
                <Search size={24} strokeWidth={1.2} className="text-text-faint" />
                <p className="mt-2 text-[var(--font-xs)] text-text-muted">
                  没有匹配的会话
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 底部统计 */}
        <div className="border-t border-border px-3 py-2">
          <p className="text-[var(--font-xs)] text-text-faint">
            {mockSessions.length} 个会话
          </p>
        </div>
      </div>

      {/* ====== 右侧：消息区 / 空状态 ====== */}
      {selectedSession ? (
        <div className="flex flex-1 flex-col">
          {/* 消息头部 */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <h3 className="text-[var(--font-sm)] font-semibold text-text-strong">
                {selectedSession.title}
              </h3>
              <Badge variant="info">{selectedSession.model}</Badge>
            </div>
            <Button variant="ghost" size="xs">
              <MoreHorizontal size={14} />
            </Button>
          </div>

          {/* 消息流 */}
          <ScrollArea className="flex-1">
            <div className="mx-auto max-w-[720px] px-4 py-4">
              {mockMessages.map((msg, idx) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${idx > 0 ? 'mt-4' : ''}`}
                >
                  {/* 头像 */}
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                      msg.role === 'assistant'
                        ? 'bg-primary-soft text-primary'
                        : 'bg-bg-soft text-text-muted'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <Bot size={14} />
                    ) : (
                      <User size={14} />
                    )}
                  </div>

                  {/* 消息内容 */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-[var(--font-xs)] font-medium text-text-strong">
                        {msg.role === 'assistant' ? 'Assistant' : 'You'}
                      </span>
                      <span className="text-[var(--font-xs)] text-text-faint">
                        {msg.time}
                      </span>
                    </div>
                    <div className="text-[var(--font-sm)] leading-relaxed text-text">
                      <MessageContent content={msg.content} />
                    </div>

                    {/* 操作按钮 */}
                    {msg.role === 'assistant' && (
                      <div className="mt-2 flex items-center gap-1">
                        <CopyButton text={msg.content} />
                        <Button variant="ghost" size="xs">
                          <Code size={12} />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* 输入区 */}
          <div className="border-t border-border p-3">
            <div className="mx-auto max-w-[720px]">
              <div className="flex items-end gap-2 rounded-md border border-border bg-panel px-3 py-2 focus-within:border-primary transition-colors">
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="输入消息..."
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-[var(--font-sm)] text-text placeholder:text-text-faint outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      // Phase 1: 仅 UI，不实际发送
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={!inputValue.trim()}
                  className="shrink-0"
                >
                  <Send size={14} />
                </Button>
              </div>
              <p className="mt-1.5 text-center text-[10px] text-text-faint">
                Enter 发送 · Shift+Enter 换行
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* 空状态 */
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft">
            <MessageSquare size={32} strokeWidth={1.2} className="text-primary" />
          </div>
          <h3 className="mt-4 text-[var(--font-lg)] font-semibold text-text-strong">
            开始新对话
          </h3>
          <p className="mt-1 text-[var(--font-sm)] text-text-muted">
            选择左侧会话，或创建新聊天
          </p>
          <Button size="sm" className="mt-4">
            <Plus size={14} />
            新建聊天
          </Button>
        </div>
      )}
    </div>
  )
}

/* ---- 消息内容渲染（支持简单 Markdown）---- */
function MessageContent({ content }: { content: string }) {
  // 简易渲染：将代码块和加粗文本解析出来
  const parts = content.split(/(```[\s\S]*?```|\*\*.*?\*\*)/g)

  return (
    <>
      {parts.map((part, i) => {
        // 代码块
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3)
          const firstNewline = code.indexOf('\n')
          const lang = firstNewline > 0 ? code.slice(0, firstNewline).trim() : ''
          const codeBody = firstNewline > 0 ? code.slice(firstNewline + 1) : code

          return (
            <pre
              key={i}
              className="my-2 overflow-x-auto rounded-md bg-code-bg p-3 text-[var(--font-xs)] leading-5 text-code-fg"
            >
              {lang && (
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-text-faint">{lang}</span>
                  <CopyButton text={codeBody} />
                </div>
              )}
              <code>{codeBody}</code>
            </pre>
          )
        }

        // 加粗文本
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="font-semibold text-text-strong">
              {part.slice(2, -2)}
            </strong>
          )
        }

        // 换行
        return part.split('\n').map((line, j) => (
          <span key={`${i}-${j}`}>
            {j > 0 && <br />}
            {line}
          </span>
        ))
      })}
    </>
  )
}

/* ---- 复制按钮（带状态反馈）---- */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Button variant="ghost" size="xs" onClick={handleCopy}>
      {copied ? (
        <Check size={12} className="text-success" />
      ) : (
        <Copy size={12} />
      )}
    </Button>
  )
}
