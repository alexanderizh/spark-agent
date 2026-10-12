/**
 * @module wiki-repo-enrich-prompt.test
 *
 * 导读提示词与输出校验的纯函数测试（方案B §6.2）。
 *
 * 校验器是「绝不猜内容」的最后一道闸：四条拒绝路径（空 / 超长 / 缺必需
 * 小节 / 含 [[ 双链）任何一条漏掉，坏内容就会以 ready 状态进入缓存并被
 * 渲染到模块页顶部。通过路径还要求 trim（入库形态干净）。
 */

import { describe, expect, it } from 'vitest'
import {
  WIKI_REPO_ENRICH_MAX_SECTION_CHARS,
  WIKI_REPO_ENRICH_REQUIRED_SECTIONS,
  WIKI_REPO_ENRICH_SYSTEM_PROMPT,
  WIKI_REPO_OVERVIEW_REQUIRED_SECTIONS,
  WIKI_REPO_OVERVIEW_SYSTEM_PROMPT,
  buildModuleEnrichPrompt,
  buildOverviewEnrichPrompt,
  validateEnrichSection,
} from './wiki-repo-enrich-prompt.js'

const VALID_SECTION = [
  '## 模块职责',
  '- 渲染层模块。',
  '',
  '## 关键入口',
  '- `src/index.ts`',
  '',
  '## 依赖关系',
  '- 内部依赖：`lib/`；外部依赖：`react`。',
].join('\n')

/** 综述页变体的合法段（S3：项目定位 / 架构组成 / 阅读指引） */
const VALID_OVERVIEW_SECTION = [
  '## 项目定位',
  '- 演示仓库，承载示例代码。',
  '',
  '## 架构组成',
  '- `src/` 与 `lib/` 两个顶层目录。',
  '',
  '## 阅读指引',
  '- 先读 `src/`（含入口 `index.ts`）。',
].join('\n')

describe('validateEnrichSection', () => {
  it('合法段落通过并返回 trim 后的入库形态', () => {
    const result = validateEnrichSection(`\n\n  ${VALID_SECTION}  \n`)
    expect(result).toEqual({ ok: true, section: VALID_SECTION })
  })

  it('拒绝：空白输出（empty）', () => {
    expect(validateEnrichSection('   \n\t ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('拒绝：超过总长上限（too_long）——导读是补充层不是正文', () => {
    const padded =
      VALID_SECTION + '\n' + '## 附注\n' + '- 填充'.repeat(WIKI_REPO_ENRICH_MAX_SECTION_CHARS)
    expect(padded.length).toBeGreaterThan(WIKI_REPO_ENRICH_MAX_SECTION_CHARS)
    expect(validateEnrichSection(padded)).toEqual({ ok: false, reason: 'too_long' })
  })

  it('拒绝：缺少任一必需小节（missing_section）——逐小节断言', () => {
    for (const heading of WIKI_REPO_ENRICH_REQUIRED_SECTIONS) {
      const without = VALID_SECTION.replace(heading, '## 其他标题')
      expect(validateEnrichSection(without)).toEqual({ ok: false, reason: 'missing_section' })
    }
    // 三个小节一个都没有
    expect(validateEnrichSection('## 完全无关的输出')).toEqual({
      ok: false,
      reason: 'missing_section',
    })
  })

  it('拒绝：包含 [[ 双链语法（wiki_link）——AI 段不进 wiki_link 图谱', () => {
    const withLink = VALID_SECTION + '\n- 参见 [[repo-module-lib]]'
    expect(validateEnrichSection(withLink)).toEqual({ ok: false, reason: 'wiki_link' })
  })

  it('系统提示硬约束齐备：三小节标题、长度上限、双链禁令、不编造', () => {
    for (const heading of WIKI_REPO_ENRICH_REQUIRED_SECTIONS) {
      expect(WIKI_REPO_ENRICH_SYSTEM_PROMPT).toContain(heading)
    }
    expect(WIKI_REPO_ENRICH_SYSTEM_PROMPT).toContain(`${WIKI_REPO_ENRICH_MAX_SECTION_CHARS} 字符`)
    expect(WIKI_REPO_ENRICH_SYSTEM_PROMPT).toContain('[[...]]')
    expect(WIKI_REPO_ENRICH_SYSTEM_PROMPT).toContain('禁止编造')
  })
})

describe('buildModuleEnrichPrompt', () => {
  it('材料原样嵌入（模型看到的材料与装配产物逐字符一致）', () => {
    const material = '# 模块：`src/`\n\n## 结构数据\n- 递归文件总数：2'
    expect(buildModuleEnrichPrompt(material)).toBe(
      ['请依据以下材料，为该模块生成「AI 导读」段（按系统提示的输出要求）：', '', material].join(
        '\n',
      ),
    )
  })
})

describe('综述页变体（S3）', () => {
  it('validateEnrichSection：综述小节集通过、缺任一综述小节拒绝', () => {
    expect(
      validateEnrichSection(VALID_OVERVIEW_SECTION, WIKI_REPO_OVERVIEW_REQUIRED_SECTIONS),
    ).toEqual({ ok: true, section: VALID_OVERVIEW_SECTION })
    for (const heading of WIKI_REPO_OVERVIEW_REQUIRED_SECTIONS) {
      const without = VALID_OVERVIEW_SECTION.replace(heading, '## 其他标题')
      expect(validateEnrichSection(without, WIKI_REPO_OVERVIEW_REQUIRED_SECTIONS)).toEqual({
        ok: false,
        reason: 'missing_section',
      })
    }
  })

  it('综述段用模块小节集校验会缺小节（两变体小节集互不通用）', () => {
    expect(validateEnrichSection(VALID_OVERVIEW_SECTION)).toEqual({
      ok: false,
      reason: 'missing_section',
    })
  })

  it('综述系统提示硬约束齐备：三小节标题、长度上限、双链禁令、不编造', () => {
    for (const heading of WIKI_REPO_OVERVIEW_REQUIRED_SECTIONS) {
      expect(WIKI_REPO_OVERVIEW_SYSTEM_PROMPT).toContain(heading)
    }
    expect(WIKI_REPO_OVERVIEW_SYSTEM_PROMPT).toContain(`${WIKI_REPO_ENRICH_MAX_SECTION_CHARS} 字符`)
    expect(WIKI_REPO_OVERVIEW_SYSTEM_PROMPT).toContain('[[...]]')
    expect(WIKI_REPO_OVERVIEW_SYSTEM_PROMPT).toContain('禁止编造')
  })

  it('buildOverviewEnrichPrompt：材料原样嵌入', () => {
    const material = '# 仓库总览材料：`demo/`\n\n## 结构数据\n- 顶层目录：2 个'
    expect(buildOverviewEnrichPrompt(material)).toBe(
      [
        '请依据以下材料，为该仓库生成总览页的「AI 综述」段（按系统提示的输出要求）：',
        '',
        material,
      ].join('\n'),
    )
  })
})
