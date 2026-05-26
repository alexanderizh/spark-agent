/**
 * AgentsView — Multi-Agent 协作视图
 */
import type { ReactNode } from 'react'
import { Icons } from '../Icons'

type AgentStatus = 'running' | 'done' | 'idle' | 'failed'

export function AgentsView() {
  return (
    <div className="agents-layout">
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <div className="flex1">
          <div className="strong" style={{ fontSize: 16 }}>代码功能开发：搜索优化</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Run #4f3a · 启动于 14:22 · <span style={{ color: 'var(--info)' }}>● 运行中</span> · 已耗时 4m 38s · $0.92
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn ghost sm"><Icons.Map size={12} /> 切到工作流视图</button>
          <button className="btn ghost sm"><Icons.Pause size={12} /> 暂停</button>
          <button className="btn sm"><Icons.Stop size={12} /> 中止</button>
        </div>
      </div>

      <div className="agents-row">
        <AgentCard
          icon={<Icons.Brain />}
          name="Planner"
          role="Claude Sonnet 4.5 · supervisor"
          status="done"
          stats={[['tokens', '12.4K'], ['工具', '4'], ['耗时', '32s']]}
          current="拆分为 5 个子任务"
        />
        <AgentCard
          icon={<Icons.Eye />}
          name="Reviewer"
          role="Claude Opus 4 · 计划审查"
          status="done"
          stats={[['tokens', '5.1K'], ['评分', '8.5'], ['耗时', '14s']]}
          current="批准 · 2 处修订建议"
        />
        <AgentCard
          icon={<Icons.Code />}
          name="Coder"
          role="Codex GPT-5 · 主执行"
          status="running"
          stats={[['tokens', '48.2K'], ['工具', '7'], ['耗时', '2m 12s']]}
          current="Edit src/search/index.ts (L42-78)"
        />
        <AgentCard
          icon={<Icons.Beaker />}
          name="Tester"
          role="Codex GPT-5-mini"
          status="idle"
          stats={[['tokens', '—'], ['工具', '0'], ['耗时', '—']]}
          current="等待 Coder 完成"
        />
        <AgentCard
          icon={<Icons.Globe />}
          name="Researcher"
          role="Claude Haiku 4.5 · sub"
          status="done"
          stats={[['tokens', '8.7K'], ['工具', '3'], ['耗时', '48s']]}
          current="收集到 5 篇 BM25 调优文章"
        />
      </div>

      <div className="timeline">
        <div className="timeline-head">
          <span className="strong" style={{ fontSize: 'var(--font-base)' }}>协作时间线</span>
          <span className="badge">42 事件</span>
          <div className="flex1" />
          <div className="seg-control">
            <button className="active">全部</button>
            <button>消息</button>
            <button>工具</button>
            <button>审批</button>
          </div>
          <button className="btn ghost sm"><Icons.Filter size={11} /> 筛选</button>
        </div>
        <div className="timeline-body scroll">
          <TLRow time="14:22:01" marker="primary" icon={<Icons.Play />}
            title={<><strong>Hayden</strong> 启动工作流 <span className="mono-sm muted">code-feature@v3</span></>}
            meta="输入：BM25 搜索响应时间从 380ms 优化到 120ms 以下" />
          <TLRow time="14:22:08" marker="primary" icon={<Icons.Brain />}
            title={<><strong>Planner</strong> 分析需求并产出 5 个子任务</>}
            meta="① 性能基准 ② 索引重建 ③ 查询优化 ④ 缓存层 ⑤ 回归测试" />
          <TLRow time="14:22:34" marker="" icon={<Icons.Globe />}
            title={<><strong>Researcher</strong> 调用 <span className="mono-sm">web_search</span></>}
            meta='查询: "BM25 query optimization techniques 2025"' />
          <TLRow time="14:23:05" marker="success" icon={<Icons.Eye />}
            title={<><strong>Reviewer</strong> 完成计划审查，评分 8.5</>}
            meta="建议: 增加查询缓存的失效策略说明" />
          <TLRow time="14:23:22" marker="warning" icon={<Icons.Shield />}
            title={<>等待人工审批 · 计划执行许可</>}
            meta="Hayden 14:24:01 批准 ✓" />
          <TLRow time="14:24:01" marker="primary" icon={<Icons.Code />}
            title={<><strong>Coder</strong> 接管，开始执行子任务 ①</>}
            meta="读取 src/search/{index,bm25,query}.ts · 共 1,247 行" />
          <TLRow time="14:24:38" marker="" icon={<Icons.Terminal />}
            title={<><strong>Coder</strong> 运行 <span className="mono-sm">node bench/search.bench.ts</span></>}
            meta="基线: p50=312ms p95=580ms p99=1240ms" />
          <TLRow time="14:25:12" marker="" icon={<Icons.Edit />}
            title={<><strong>Coder</strong> 编辑 <span className="mono-sm">src/search/bm25.ts</span></>}
            meta="重构 scoring loop，避免 Map 拷贝（+12 / −8）" />
          <TLRow time="14:25:47" marker="" icon={<Icons.Edit />}
            title={<><strong>Coder</strong> 创建 <span className="mono-sm">src/search/cache.ts</span></>}
            meta="LRU + TTL 查询缓存（新增 86 行）" />
          <TLRow time="14:26:39" marker="primary" icon={<Icons.Spinner />}
            title={<><strong>Coder</strong> 正在编辑 <span className="mono-sm">src/search/index.ts</span>…</>}
            meta="集成新缓存层，调整 query pipeline" />
        </div>
      </div>
    </div>
  )
}

function AgentCard({ icon, name, role, status, stats, current }: {
  icon: ReactNode
  name: string
  role: string
  status: AgentStatus
  stats: [string, string][]
  current: string
}) {
  const statusMap: Record<AgentStatus, { label: string; cls: string }> = {
    running: { label: '运行中', cls: 'info' },
    done: { label: '已完成', cls: 'success' },
    idle: { label: '空闲', cls: '' },
    failed: { label: '失败', cls: 'danger' },
  }
  return (
    <div className={`agent-card ${status === 'running' ? 'running' : ''}`}>
      <div className="agent-head">
        <div className="agent-icon">{icon}</div>
        <div className="info">
          <div className="name">{name}</div>
          <div className="role">{role}</div>
        </div>
        <span className={`badge ${statusMap[status].cls} dot`}>{statusMap[status].label}</span>
      </div>
      <div className="agent-stats">
        {stats.map(([label, val], i) => (
          <div key={i}>
            <div className="label">{label}</div>
            <div className="val">{val}</div>
          </div>
        ))}
      </div>
      <div className={`agent-current ${status === 'idle' ? 'idle' : ''}`}>
        {status === 'running' && <Icons.Spinner size={11} style={{ color: 'var(--info)' }} />}
        {status === 'done' && <Icons.Check size={11} style={{ color: 'var(--success)' }} />}
        {status === 'idle' && <Icons.Clock size={11} />}
        <span className="truncate">{current}</span>
      </div>
    </div>
  )
}

function TLRow({ time, marker, icon, title, meta }: { time: string; marker: string; icon: ReactNode; title: ReactNode; meta?: string }) {
  return (
    <div className="tl-row">
      <div className="tl-time mono-sm">{time}</div>
      <div className={`tl-marker ${marker}`}>{icon}</div>
      <div className="tl-content">
        <div className="tl-title">{title}</div>
        {meta && <div className="tl-meta">{meta}</div>}
      </div>
    </div>
  )
}
