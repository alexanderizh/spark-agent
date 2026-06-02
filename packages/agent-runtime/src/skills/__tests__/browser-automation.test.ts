/**
 * Browser Automation Skill tests
 *
 * Validates the static SkillDefinition fields and the systemPrompt/parameter
 * rendering — ensures the agent guidance is consistent and all required
 * tools are declared.
 */
import { describe, it, expect } from 'vitest'
import { browserAutomationSkill } from '../builtin/browser-automation.js'
import { buildSkillSystemPrompt } from '../types.js'

describe('browserAutomationSkill', () => {
  it('has stable id and metadata for the skill registry', () => {
    expect(browserAutomationSkill.id).toBe('builtin:browser-automation')
    expect(browserAutomationSkill.category).toBe('utility')
    expect(browserAutomationSkill.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(browserAutomationSkill.author).toBe('Spark AI')
    expect(browserAutomationSkill.tags).toContain('browser')
    expect(browserAutomationSkill.tags).toContain('playwright')
  })

  it('declares all required Playwright MCP tools', () => {
    const required = browserAutomationSkill.requiredTools
    expect(required).toContain('mcp__playwright__browser_navigate')
    expect(required).toContain('mcp__playwright__browser_snapshot')
    expect(required).toContain('mcp__playwright__browser_click')
    expect(required).toContain('mcp__playwright__browser_type')
    expect(required).toContain('mcp__playwright__browser_press_key')
    expect(required).toContain('mcp__playwright__browser_take_screenshot')
    expect(required).toContain('mcp__playwright__browser_close')
  })

  it('exposes the headful/headless mode parameter', () => {
    const modeParam = browserAutomationSkill.parameters.find((p) => p.name === 'mode')
    expect(modeParam).toBeDefined()
    expect(modeParam?.type).toBe('select')
    expect(modeParam?.defaultValue).toBe('headful')
    const optionValues = modeParam?.options?.map((o) => o.value)
    expect(optionValues).toEqual(expect.arrayContaining(['headful', 'headless']))
  })

  it('systemPrompt instructs agent to use ref-based snapshot workflow', () => {
    expect(browserAutomationSkill.systemPrompt).toContain('snapshot')
    expect(browserAutomationSkill.systemPrompt).toContain('ref=')
    expect(browserAutomationSkill.systemPrompt).toContain('browser_click')
    expect(browserAutomationSkill.systemPrompt).toContain('browser_close')
  })

  it('systemPrompt includes safety boundaries (CAPTCHA, banking, batching)', () => {
    expect(browserAutomationSkill.systemPrompt).toMatch(/captcha/i)
    expect(browserAutomationSkill.systemPrompt).toMatch(/银行|支付|banking|payment/i)
    expect(browserAutomationSkill.systemPrompt).toMatch(/批量提交/)
  })

  it('buildSkillSystemPrompt renders without errors', () => {
    const rendered = buildSkillSystemPrompt(browserAutomationSkill, { mode: 'headless' })
    // The prompt itself does not contain "浏览器自动化" (that's the skill name,
    // not in the systemPrompt body). Verify core instructional content instead.
    expect(rendered).toContain('Playwright MCP')
    expect(rendered).toContain('snapshot')
    expect(rendered).toContain('browser_click')
    expect(typeof rendered).toBe('string')
    expect(rendered.length).toBeGreaterThan(500)
  })

  it('is registered in the BUILTIN_SKILLS array', async () => {
    const { BUILTIN_SKILLS } = await import('../builtin/index.js')
    const ids = BUILTIN_SKILLS.map((s) => s.id)
    expect(ids).toContain('builtin:browser-automation')
  })
})
