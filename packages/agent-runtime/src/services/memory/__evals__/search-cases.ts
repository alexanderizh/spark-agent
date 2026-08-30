/**
 * @module search-cases
 *
 * FTS 检索召回黄金用例（确定性，无 embedding，纯 BM25）。
 * 覆盖中文二字词、英文词、混合、多词 AND（H5）、body 检索（M9）、失效排除、scope/type 过滤。
 */
import type { SearchCase } from './types.js'

const mk = (id: string, description: string, body = '', overrides: Record<string, unknown> = {}) => ({
  row: {
    id,
    scope: 'user' as const,
    scope_ref: null,
    type: 'user' as const,
    name: id,
    description,
    file_path: `/tmp/${id}.md`,
    confidence: 0.9,
    hit_count: 0,
    last_hit_at: null,
    source_session_id: null,
    archived: 0,
    ...overrides,
  },
  body,
})

export const searchCases: SearchCase[] = [
  // ── 中文二字词（segmentCjk 验证）──
  {
    id: 'cjk-two-char',
    desc: '中文二字词"迁移"召回（CJK 逐字分词 + phrase）',
    seed: [mk('usr_s1', '项目构建已迁移到 vite'), mk('usr_s2', '完全无关的天气记忆')],
    query: '迁移',
    expectIds: ['usr_s1'],
  },
  {
    id: 'cjk-multi-char',
    desc: '中文多字词"团队模式"召回',
    seed: [mk('usr_s3', '团队模式 Phase 1 进行中'), mk('usr_s4', '个人偏好记录')],
    query: '团队模式',
    expectIds: ['usr_s3'],
  },

  // ── 英文词 ──
  {
    id: 'english-word',
    desc: '英文词 arco 召回',
    seed: [mk('usr_s5', '偏好 Arco Design 组件库'), mk('usr_s6', '偏好 Vite 构建')],
    query: 'arco',
    expectIds: ['usr_s5'],
  },

  // ── 混合 ──
  {
    id: 'mixed-cjk-en',
    desc: '中英混合查询：CJK 段 phrase + 英文 AND',
    seed: [mk('usr_s7', '用 Arco 重构了组件库'), mk('usr_s8', '用 Radix 组件'), mk('usr_s9', 'Arco 但不重构')],
    query: '重构 Arco',
    expectIds: ['usr_s7'],
  },

  // ── H5：多词英文不再要求紧邻（AND 共现）──
  {
    id: 'english-multi-and',
    desc: 'H5: react hooks 两词共现即可（旧 phrase 要求紧邻会零命中）',
    seed: [mk('usr_s10', 'react 性能优化，hooks 用法详解'), mk('usr_s11', 'vue 组件')],
    query: 'react hooks',
    expectIds: ['usr_s10'],
  },

  // ── M9：body 内容可检索（insert 传 body）──
  {
    id: 'body-searchable',
    desc: 'M9: 正文里的关键词可被 FTS 搜到（insert 传 body）',
    seed: [mk('usr_s12', '简短描述', '正文中提到了甲骨文数据库的连接配置')],
    query: '甲骨文',
    expectIds: ['usr_s12'],
  },

  // ── type 过滤 ──
  {
    id: 'type-filter',
    desc: 'type=feedback 过滤掉非 feedback',
    seed: [
      mk('usr_s13', '目标反馈记忆', '', { type: 'feedback' }),
      mk('usr_s14', '同名关键词的非反馈', '', { type: 'project' }),
    ],
    query: '目标反馈',
    opts: { type: 'feedback' },
    expectIds: ['usr_s13'],
  },

  // ── 失效排除（H3：searchBm25 带 invalid_at IS NULL）──
  {
    id: 'excludes-invalid',
    desc: '失效条目不召回',
    seed: [
      mk('usr_s15', '失效的 webpack 记忆', '', { invalid_at: 1000 }),
      mk('usr_s16', '有效的 vite 记忆'),
    ],
    query: 'webpack',
    expectIds: [],
  },

  // ── scope 过滤 ──
  {
    id: 'scope-filter',
    desc: 'scope 限定：project scope 不召回 user 查询',
    seed: [
      mk('usr_s17', 'project 记忆', '', { scope: 'project', scope_ref: 'ws1' }),
      mk('usr_s18', 'user 记忆相同描述'),
    ],
    query: 'project 记忆',
    opts: {},
    expectIds: [], // user scope 查询（默认）不应召回 project scope（usr_s17）
    // 注意：eval framework 默认按 user scope 查，usr_s17 在 project scope 不会出现；usr_s18 描述不含"project 记忆"原文
  },

  // ── limit ──
  {
    id: 'limit',
    desc: 'limit 限制返回数',
    seed: Array.from({ length: 6 }, (_, i) => mk(`usr_l${i}`, '共同关键词 vite')),
    query: 'vite',
    opts: { limit: 3 },
    expectIds: ['usr_l0', 'usr_l1', 'usr_l2'],
    expectExact: true,
  },

  // ── 空查询 ──
  {
    id: 'empty-query',
    desc: '空查询返回空',
    seed: [mk('usr_s20', '任意记忆')],
    query: '   ',
    expectIds: [],
  },
]
