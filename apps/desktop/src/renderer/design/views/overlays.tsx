/**
 * 覆盖层组件：命令面板、权限弹窗
 *
 * Provider/Profile 编辑面板放在 SettingsView 旁边以便共用类型，但作为顶级覆盖层挂载。
 */
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import type { PermissionApprovalRequest, PermissionApprovalDecision } from '@spark/protocol'

export function CommandPalette({ onClose }: { onClose: () => void }) {
  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <Icons.Search />
          <input placeholder="搜索或输入命令..." autoFocus />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-results scroll">
          <div className="palette-group">建议</div>
          <PItem icon={<Icons.Chat />} title="新建聊天" hint="开始通用会话" kbds={['⌘', 'N']} />
          <PItem icon={<Icons.Folder />} title="打开项目..." hint="选择本地工作区" kbds={['⌘', 'O']} sel />
          <PItem icon={<Icons.Workflow />} title="运行工作流..." hint="选择并启动 DAG" kbds={['⌘', '⇧', 'R']} />

          <div className="palette-group">导航</div>
          <PItem icon={<Icons.Home />} title="跳转到 Home" kbds={['⌘', '1']} />
          <PItem icon={<Icons.Chat />} title="跳转到 Chat" kbds={['⌘', '2']} />
          <PItem icon={<Icons.Folder />} title="跳转到 Projects" kbds={['⌘', '3']} />
          <PItem icon={<Icons.MCP />} title="跳转到 MCP" kbds={['⌘', '7']} />

          <div className="palette-group">动作</div>
          <PItem icon={<Icons.GitBranch />} title="创建会话分支" hint="从当前检查点分叉" />
          <PItem icon={<Icons.Download />} title="导出会话为 Markdown" hint="包含工具调用和 diff" />
          <PItem icon={<Icons.Refresh />} title="重连所有 MCP" hint="重启 stdio 子进程" />
          <PItem icon={<Icons.Shield />} title="设置沙箱等级..." hint="L0 / L1 / L2 / L3" />

          <div className="palette-group">Skills</div>
          <PItem
            icon={<span className="ico" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 700, fontSize: 9 }}>C</span>}
            title="code-review"
            hint="按严重度审查代码"
          />
          <PItem
            icon={<span className="ico" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 700, fontSize: 9 }}>D</span>}
            title="deck-builder"
            hint="从大纲生成幻灯片"
          />
        </div>
        <div className="palette-foot">
          <span className="seg"><span className="kbd">↑↓</span> 移动</span>
          <span className="seg"><span className="kbd">↵</span> 选择</span>
          <span className="seg"><span className="kbd">⌘</span><span className="kbd">↵</span> 在新窗口打开</span>
          <div className="flex1" />
          <span className="seg muted">⌘K · Spark Agent</span>
        </div>
      </div>
    </div>
  )
}

function PItem({ icon, title, hint, kbds, sel }: { icon: ReactNode; title: string; hint?: string; kbds?: string[]; sel?: boolean }) {
  return (
    <div className={`palette-item ${sel ? 'sel' : ''}`}>
      <span className="ico">{icon}</span>
      <div className="body">
        <div className="title">{title}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {kbds && <div className="kbds">{kbds.map((k, i) => <span key={i} className="kbd">{k}</span>)}</div>}
    </div>
  )
}

export function PermissionModal({ request, onClose }: { request: PermissionApprovalRequest; onClose: () => void }) {
  const riskIcon = request.riskLevel === 'high' ? <Icons.AlertTriangle className="ico" /> : <Icons.Shield className="ico" />
  const riskLabel = { low: '低', medium: '中', high: '高' }[request.riskLevel]

  async function respond(decision: PermissionApprovalDecision) {
    try {
      await window.spark.invoke('permission:approval-respond', { requestId: request.requestId, decision })
    } catch {
      // best-effort
    }
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={() => respond('deny')}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-icon">{riskIcon}</div>
          <div>
            <div className="modal-title">请求执行工具：{request.toolName}</div>
            <div className="modal-subtitle">Session {request.sessionId.slice(0, 8)} · 风险等级 {riskLabel}</div>
          </div>
        </div>
        <div className="modal-body">
          <div className="cmd-preview mono-sm">
            {JSON.stringify(request.toolInput, null, 2)}
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11 }}>
            <span className="kbd">esc</span> 拒绝
          </span>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={() => respond('deny')}>拒绝</button>
          <button className="btn" onClick={() => respond('allow-session')}>本会话允许</button>
          <button className="btn primary" onClick={() => respond('allow-once')}>允许一次</button>
        </div>
      </div>
    </div>
  )
}
