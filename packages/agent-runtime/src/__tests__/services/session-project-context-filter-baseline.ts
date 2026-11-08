import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import type { SessionService } from '../../services/session.service.js'
import { ProjectContextService } from '../../services/project-context.service.js'

type RuntimeState = {
  sdkConfigs: Array<Record<string, unknown>>
  settings: Map<string, unknown>
  workspaces: Map<string, { id: string; name: string; root_path: string; project_kind: string }>
}

/** Uses the shared SessionService integration harness, with real temporary project files. */
export function registerSessionProjectContextFilterTests(
  createService: (emit: (event: AgentEvent) => void) => SessionService,
  state: RuntimeState,
): void {
  async function withProject(
    run: (fixture: {
      root: string
      sessionId: string
      turn: (skillId?: string) => Promise<Record<string, unknown>>
      events: AgentEvent[]
    }) => Promise<void>,
  ): Promise<void> {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-prompt-filter-')))
    const events: AgentEvent[] = []
    const service = createService((event) => events.push(event))
    const workspaceId = 'prompt-filter-workspace'
    state.workspaces.set(workspaceId, {
      id: workspaceId,
      name: 'Prompt filter fixture',
      root_path: root,
      project_kind: 'local',
    })
    writeFileSync(path.join(root, 'AGENTS.md'), '# Project rules\nPROJECT_RULE_SENTINEL')
    mkdirSync(path.join(root, '.agents/skills/example'), { recursive: true })
    writeFileSync(
      path.join(root, '.agents/skills/example/SKILL.md'),
      '---\nname: Example skill\ndescription: PROJECT_SKILL_CATALOG_SENTINEL\n---\nEXPLICIT_SKILL_BODY',
    )
    try {
      const { sessionId } = await service.createSession({
        providerProfileId: 'tencent-provider',
        workspaceId,
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-auto-edits',
        title: 'Project prompt filter integration',
      })
      await run({
        root,
        sessionId,
        events,
        turn: async (skillId) => {
          const configCount = state.sdkConfigs.length
          const { turnId } = await service.sendTurn({
            sessionId,
            message: `Check project rules for turn ${configCount + 1}`,
            ...(skillId != null ? { skillId } : {}),
          })
          // Wait for completion, not just configuration capture: avoid cross-turn async leakage.
          await vi.waitFor(() => {
            expect(state.sdkConfigs).toHaveLength(configCount + 1)
            expect(
              events.some(
                (event) =>
                  event.turnId === turnId &&
                  event.type === 'agent_status' &&
                  event.status === 'completed',
              ),
            ).toBe(true)
          })
          return state.sdkConfigs[configCount] ?? {}
        },
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it('project filter disables discovery before IO and reports zero injected project sources', async () => {
    await withProject(async ({ sessionId, turn, events }) => {
      state.settings.set(`runtime.prompt-filter:session:${sessionId}`, {
        disabledSources: ['inject:projectContext'],
      })
      const discovery = vi.spyOn(ProjectContextService.prototype, 'discover')
      try {
        const config = await turn()
        expect(discovery).toHaveBeenCalledTimes(1)
        expect(discovery.mock.calls[0]?.[1]?.enabled).toBe(false)
        expect(config.projectSettingsEnabled).toBe(false)
        expect(String(config.systemPrompt)).not.toContain('PROJECT_RULE_SENTINEL')
        expect(String(config.skillSystemPrompt)).not.toContain('PROJECT_SKILL_CATALOG_SENTINEL')
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'project_context_loaded',
            sources: [],
            counts: { rules: 0, skills: 0, agents: 0 },
          }),
        )
      } finally {
        discovery.mockRestore()
      }
    })
  })

  it('default injection retains project bytes, section order, and stable two-turn prefixes', async () => {
    await withProject(async ({ root, turn }) => {
      const project = new ProjectContextService().discover(root, { mode: 'project-smart' })
      const first = await turn()
      const second = await turn()
      const prompt = String(first.systemPrompt)
      expect(prompt).toContain(project.systemPrompt)
      expect(prompt.indexOf('[Project Instruction Files]')).toBeLessThan(
        prompt.indexOf('[Memory Behavior]'),
      )
      expect(String(first.skillSystemPrompt)).toContain(project.skillSystemPrompt)
      expect(first.projectSettingsEnabled).toBe(true)
      expect(second.systemPrompt).toEqual(expect.stringMatching(/^\[Application Identity\]/))
      expect(String(second.systemPrompt).startsWith(prompt)).toBe(true)
      expect(second.skillSystemPrompt).toBe(first.skillSystemPrompt)
      expect(second.allowedTools).toEqual(first.allowedTools)
    })
  })

  it('re-reads project/session filters every turn and restores the latest file after empty takeover', async () => {
    await withProject(async ({ root, sessionId, turn }) => {
      state.settings.set('runtime.prompt-filter:project:prompt-filter-workspace', {
        disabledSources: ['inject:projectContext'],
      })
      const inherited = await turn()
      expect(inherited.projectSettingsEnabled).toBe(false)
      expect(String(inherited.systemPrompt)).not.toContain('PROJECT_RULE_SENTINEL')

      writeFileSync(path.join(root, 'AGENTS.md'), '# Project rules\nUPDATED_PROJECT_RULE')
      state.settings.set(`runtime.prompt-filter:session:${sessionId}`, { disabledSources: [] })
      const takeover = await turn()
      expect(takeover.projectSettingsEnabled).toBe(true)
      expect(String(takeover.systemPrompt)).toContain('UPDATED_PROJECT_RULE')
      expect(String(takeover.skillSystemPrompt)).toContain('PROJECT_SKILL_CATALOG_SENTINEL')

      state.settings.delete(`runtime.prompt-filter:session:${sessionId}`)
      const followingProject = await turn()
      expect(followingProject.projectSettingsEnabled).toBe(false)
      expect(String(followingProject.systemPrompt)).not.toContain('UPDATED_PROJECT_RULE')
      expect(String(followingProject.skillSystemPrompt)).not.toContain(
        'PROJECT_SKILL_CATALOG_SENTINEL',
      )
    })
  })

  it('keeps explicitly selected local skill instructions when project auto-injection is disabled', async () => {
    await withProject(async ({ sessionId, turn }) => {
      state.settings.set(`runtime.prompt-filter:session:${sessionId}`, {
        disabledSources: ['inject:projectContext', 'inject:skillCatalog'],
      })
      const config = await turn('project:.agents/skills/example/SKILL.md')
      expect(config.projectSettingsEnabled).toBe(false)
      expect(String(config.systemPrompt)).not.toContain('PROJECT_RULE_SENTINEL')
      expect(String(config.skillSystemPrompt)).toContain('EXPLICIT_SKILL_BODY')
      expect(String(config.skillSystemPrompt)).not.toContain('[Project Local Skills Catalog]')
    })
  })
}
