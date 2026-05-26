/**
 * 覆盖层组件：命令面板、权限弹窗
 *
 * Provider/Profile 编辑面板放在 SettingsView 旁边以便共用类型，但作为顶级覆盖层挂载。
 */
import type { ReactNode } from 'react'
import { Icons } from '../Icons'

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

export function PermissionModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-icon"><Icons.AlertTriangle size={18} /></div>
          <div>
            <div className="modal-title">请求执行 Shell 命令</div>
            <div className="modal-subtitle">来自 Codex Agent · spark-agent 工作区 · 风险等级 中</div>
          </div>
        </div>
        <div className="modal-body">
          <div className="cmd-preview mono-sm">
{`$ git push origin feat/oauth-2.1 --force-with-lease
$ gh pr create --title "feat(auth): OAuth 2.1 + PKCE" \\
    --body-file .spark/scratch/pr-body.md`}
          </div>
          <div>
            <div className="strong" style={{ fontSize: 12, marginBottom: 6 }}>影响分析</div>
            <div className="risk-list">
              <div className="risk-row"><Icons.AlertTriangle className="ico" /> <span>使用 <code className="mono-sm">--force-with-lease</code>，远程分支会被覆盖</span></div>
              <div className="risk-row success"><Icons.Check className="ico" /> 仅影响远程分支 <span className="mono-sm">feat/oauth-2.1</span></div>
              <div className="risk-row success"><Icons.Check className="ico" /> 本地与远程没有未同步差异</div>
              <div className="risk-row success"><Icons.Check className="ico" /> 由 Coder Agent 发起，符合任务范围</div>
            </div>
          </div>

          <div className="row" style={{ padding: '8px 10px', background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', fontSize: 11.5, color: 'var(--text-muted)', gap: 8 }}>
            <Icons.Brain size={13} />
            <span><strong className="strong">Agent 解释:</strong> 本地分支历史比远程旧 1 个 commit，因为之前 rebase 整理过提交。使用 <code className="mono-sm">--force-with-lease</code> 而非 <code className="mono-sm">--force</code> 是为了避免覆盖他人提交。</span>
          </div>

          <div className="row" style={{ fontSize: 12 }}>
            <Icons.Lock size={12} style={{ color: 'var(--text-muted)' }} />
            <span className="muted">下次类似命令的处理：</span>
            <div className="seg-control" style={{ marginLeft: 'auto' }}>
              <button className="active">询问</button>
              <button>本会话允许</button>
              <button>本项目允许</button>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11 }}>
            <span className="kbd">esc</span> 取消 · <span className="kbd">⌘</span> <span className="kbd">↵</span> 批准
          </span>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>拒绝</button>
          <button className="btn">仅 Dry-run</button>
          <button className="btn primary" onClick={onClose}>批准并执行</button>
        </div>
      </div>
    </div>
  )
}
