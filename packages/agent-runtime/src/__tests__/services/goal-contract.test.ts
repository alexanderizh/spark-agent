import { describe, it, expect } from 'vitest'
import { buildGoalContractDraftPrompt, parseGoalContractBlock } from '../../services/goal-contract.js'

describe('goal-contract', () => {
  describe('buildGoalContractDraftPrompt', () => {
    it('includes the objective and asks for a spark-goal-contract block without doing work yet', () => {
      const prompt = buildGoalContractDraftPrompt('Add dark mode to settings')
      expect(prompt).toContain('Add dark mode to settings')
      expect(prompt).toContain('spark-goal-contract')
      // must instruct NOT to start implementing yet
      expect(prompt.toLowerCase()).toMatch(/do not (start|begin|implement)|draft (only|the contract)/)
    })
  })

  describe('parseGoalContractBlock', () => {
    it('parses success_criteria, constraints and validation commands from the block', () => {
      const content = [
        'Here is the proposed contract:',
        '```spark-goal-contract',
        'success_criteria: builds clean, has unit tests, toggle persists',
        'constraints: do not change public API',
        'validation: pnpm test, pnpm typecheck',
        '```',
      ].join('\n')
      const parsed = parseGoalContractBlock(content)
      expect(parsed).not.toBeNull()
      expect(parsed!.successCriteria).toEqual(['builds clean', 'has unit tests', 'toggle persists'])
      expect(parsed!.constraints).toEqual(['do not change public API'])
      expect(parsed!.validation.commands).toEqual(['pnpm test', 'pnpm typecheck'])
    })

    it('returns null when no block is present', () => {
      expect(parseGoalContractBlock('no block here')).toBeNull()
    })

    it('returns null when the block has no success_criteria (incomplete contract)', () => {
      const content = '```spark-goal-contract\nconstraints: x\n```'
      expect(parseGoalContractBlock(content)).toBeNull()
    })
  })
})
