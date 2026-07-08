/**
 * @module gate-cases
 *
 * 写入闸门 + 演化决策执行的黄金用例（确定性，mock callLLM + mock evolution）。
 * 覆盖 7 种 outcome × 多场景。CI 跑（真实 DB，需 Node ABI）。
 */
import type { GateCase } from './types.js'

const baseCandidate = {
  scope: 'user' as const,
  type: 'feedback' as const,
  confidence: 0.9,
}

export const gateCases: GateCase[] = [
  // ── ADD：应写入 ──
  {
    id: 'add-feedback-1',
    desc: '显式纠正 → ADD 新 feedback',
    candidate: { ...baseCandidate, name: 'no-console-log', description: '禁止 console.log 统一用 logger', body: '**Why:** 统一日志\n**How to apply:** 用 logger' },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'written' },
  },
  {
    id: 'add-user-identity',
    desc: '用户身份 → ADD user 记忆',
    candidate: { scope: 'user', type: 'user', confidence: 0.9, name: 'senior-fullstack', description: '用户是全栈工程师', body: '全栈，偏好先讨论再动手' },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'written' },
  },

  // ── 闸门1 置信度拒绝 ──
  {
    id: 'reject-low-confidence',
    desc: 'confidence 0.4 < 0.6 → 拒绝',
    candidate: { ...baseCandidate, name: 'guess', description: '不确定的猜测', body: 'b', confidence: 0.4 },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'rejected-confidence' },
  },

  // ── 闸门0 瞬时数据拒绝 ──
  {
    id: 'reject-transient-date',
    desc: '包含日期 → 瞬时拒绝',
    candidate: { ...baseCandidate, name: 'today-date', description: '今天是 2026-07-03 要发版', body: 'b' },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'rejected-transient' },
  },
  {
    id: 'reject-transient-task-status',
    desc: '临时任务进度（含"现在 N"信号）→ 瞬时拒绝',
    candidate: { ...baseCandidate, name: 'debug-progress', description: '现在 3 个文件还没改完，在 debug 内存泄漏', body: 'b' },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'rejected-transient' },
  },
  {
    id: 'reject-transient-realtime',
    desc: '实时数据（当前内存占用）→ 瞬时拒绝',
    candidate: { ...baseCandidate, name: 'current-mem', description: '当前内存占用 73%，CPU 45%', body: 'b' },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'rejected-transient' },
  },

  // ── 闸门4 敏感词拒绝 ──
  {
    id: 'reject-sensitive-apikey',
    desc: 'sk- token → 敏感词拒绝',
    candidate: { ...baseCandidate, name: 'api-key', description: 'API key 是 sk-abcdefghijklmnopqrstuvwxyz1234567890', body: 'b' },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'rejected-sensitive' },
  },
  {
    id: 'reject-sensitive-privatekey',
    desc: 'PEM 私钥 → 敏感词拒绝',
    candidate: { ...baseCandidate, name: 'private-key', description: '密钥 -----BEGIN RSA PRIVATE KEY----- 内容', body: 'b' },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'rejected-sensitive' },
  },

  // ── 演化 NOOP ──
  {
    id: 'evolution-noop',
    desc: '演化判 NOOP → 候选丢弃，无变化',
    candidate: { ...baseCandidate, name: 'dup-feedback', description: '重复的反馈', body: 'b' },
    existing: [{ row: { id: 'usr_exist1', scope: 'user', scope_ref: null, type: 'feedback', name: 'exist1', description: '已存在的类似反馈', file_path: '/tmp/exist1.md', confidence: 0.9, hit_count: 0, last_hit_at: null, source_session_id: null, archived: 0 }, body: 'b' }],
    evolution: { decision: 'NOOP' },
    expect: { outcome: 'noop' },
  },

  // ── 演化 UPDATE ──
  {
    id: 'evolution-update',
    desc: '演化判 UPDATE target → 保 id 更新 description',
    candidate: { ...baseCandidate, name: 'stack-v2', description: '全新描述 vite', body: '全新正文' },
    existing: [{ row: { id: 'usr_t1', scope: 'user', scope_ref: null, type: 'feedback', name: 'stack', description: '旧描述 webpack', file_path: '/tmp/t1.md', confidence: 0.8, hit_count: 3, last_hit_at: null, source_session_id: null, archived: 0 }, body: '旧正文 webpack' }],
    evolution: { decision: 'UPDATE', targetIndex: 0 },
    expect: { outcome: 'updated' },
  },

  // ── 演化 DELETE（失效）──
  {
    id: 'evolution-delete',
    desc: '演化判 DELETE target → target 失效',
    candidate: { ...baseCandidate, name: 'migration', description: '已从 webpack 迁到 vite', body: 'b' },
    existing: [{ row: { id: 'usr_t2', scope: 'user', scope_ref: null, type: 'feedback', name: 'old-stack', description: '用 webpack 构建', file_path: '/tmp/t2.md', confidence: 0.9, hit_count: 1, last_hit_at: null, source_session_id: null, archived: 0 }, body: 'webpack 正文' }],
    evolution: { decision: 'DELETE', targetIndex: 0 },
    expect: { outcome: 'invalidated' },
  },

  // ── scope 判定：project scope ──
  {
    id: 'add-project-scope',
    desc: 'project scope 记忆 → ADD',
    candidate: { scope: 'project', type: 'project', confidence: 0.9, name: 'q3-launch', description: 'Q3 要上线团队模式', body: '**Why:** 业务需要\n**How to apply:** 排期优先' },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'written' },
  },

  // ── reference type ──
  {
    id: 'add-reference',
    desc: 'reference 外部指针 → ADD',
    candidate: { scope: 'user', type: 'reference', confidence: 0.85, name: 'grafana-dashboard', description: '看 grafana.xxx 仪表盘', body: '监控地址稳定' },
    evolution: { decision: 'ADD' },
    expect: { outcome: 'written' },
  },

  // ── V1 路径（evolution 不提供，走 V1 闸门）──
  {
    id: 'v1-add-no-evolution',
    desc: 'evolutionService=null 走 V1：新事实 ADD',
    candidate: { ...baseCandidate, name: 'v1-new', description: 'V1 路径新记忆', body: 'b' },
    // 不提供 evolution → evolutionService=null → 无相似召回直接 ADD（V1 passDedupGate 也 write）
    expect: { outcome: 'written' },
  },
  {
    id: 'v1-reject-low-confidence',
    desc: 'V1 路径：低置信度仍被闸门拒',
    candidate: { ...baseCandidate, name: 'v1-low', description: '低置信', body: 'b', confidence: 0.3 },
    expect: { outcome: 'rejected-confidence' },
  },

  // ── ADD 后同名重建（H1 修复验证：失效条目释放名字槽）──
  {
    id: 'add-after-invalidate',
    desc: '已有同名条目已失效 → 新同名 ADD 应成功（044 索引修复）',
    candidate: { ...baseCandidate, name: 'same-name', description: '同名的全新内容', body: '新正文' },
    existing: [{ row: { id: 'usr_old', scope: 'user', scope_ref: null, type: 'feedback', name: 'same-name', description: '旧版已失效', file_path: '/tmp/old.md', confidence: 0.9, hit_count: 0, last_hit_at: null, source_session_id: null, archived: 0, invalid_at: 1000 }, body: '旧' }],
    evolution: { decision: 'ADD' },
    expect: { outcome: 'written' },
  },
]
