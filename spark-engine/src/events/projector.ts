import type {
  ContextProjector,
  ProjectedContext,
  ProjectorConfig,
  PromptComposer,
  SessionFacts,
} from '../seams.js'
import type { IrMessage, SystemSection } from '../llm/types.js'
import type { InstructionProvider } from '../memory/instructions.js'
import { SPARK_KERNEL_PROMPT } from '../prompts/kernel.js'
import type { AgentEvent } from './schema.js'

export class EventContextProjector implements ContextProjector {
  project(events: readonly AgentEvent[], config: ProjectorConfig): ProjectedContext {
    void config
    const messages: IrMessage[] = []
    const calls = new Map<string, { tool: string; seq: number }>()

    for (const event of events) {
      switch (event.type) {
        case 'turn.started':
          messages.push({ role: 'user', content: event.input.text, sourceSeqs: [event.seq] })
          break
        case 'assistant.completed':
          messages.push({
            role: 'assistant',
            content: event.message.text ?? '',
            ...(event.message.thinking === undefined ? {} : { thinking: event.message.thinking }),
            ...(event.message.continuation === undefined
              ? {}
              : { continuation: event.message.continuation }),
            toolCalls: event.message.toolCalls,
            sourceSeqs: [event.seq],
          })
          break
        case 'tool.call':
          calls.set(event.callId, { tool: event.tool, seq: event.seq })
          break
        case 'tool.result': {
          const call = calls.get(event.callId)
          messages.push({
            role: 'tool_result',
            callId: event.callId,
            tool: call?.tool ?? 'unknown',
            ok: event.ok,
            content: event.content,
            sourceSeqs: call ? [call.seq, event.seq] : [event.seq],
          })
          break
        }
        default:
          break
      }
    }

    return {
      messages,
      sourceSeqs: [...new Set(messages.flatMap((message) => message.sourceSeqs))],
    }
  }
}

export interface DefaultPromptComposerOptions {
  /** Layered instruction files (SPARK.md / AGENTS.md / CLAUDE.md) injected as a stable section. */
  readonly instructions?: InstructionProvider
  /** Host-composed system prompt, kept as its own cache-stable section. */
  readonly systemPrompt?: string
  /** Progressive skill context supplied by the host. */
  readonly skillSystemPrompt?: string
}

export class DefaultPromptComposer implements PromptComposer {
  readonly #instructions: InstructionProvider | undefined
  readonly #systemPrompt: string | undefined
  readonly #skillSystemPrompt: string | undefined

  constructor(options: DefaultPromptComposerOptions = {}) {
    this.#instructions = options.instructions
    this.#systemPrompt = nonEmpty(options.systemPrompt)
    this.#skillSystemPrompt = nonEmpty(options.skillSystemPrompt)
  }

  async compose(facts: SessionFacts, config: ProjectorConfig): Promise<readonly SystemSection[]> {
    const sections: SystemSection[] = [
      {
        id: 'spark-kernel-contract',
        stability: 'stable',
        content: SPARK_KERNEL_PROMPT,
      },
      {
        id: 'runtime',
        stability: 'volatile',
        content: `Session: ${facts.sessionId}\nWorking directory: ${config.cwd}\nPermission mode: ${facts.permissionMode ?? 'manual'}`,
      },
    ]
    if (this.#instructions) {
      const snapshot = await this.#instructions.snapshot()
      if (snapshot.sections.length > 0) {
        const content = snapshot.sections
          .map(
            (section) =>
              `<instructions source="${section.sourcePath}" scope="${section.scope}">\n${section.content.trimEnd()}\n</instructions>`,
          )
          .join('\n\n')
        sections.splice(1, 0, { id: 'project-instructions', stability: 'stable', content })
      }
    }
    if (this.#systemPrompt !== undefined) {
      sections.splice(1, 0, {
        id: 'host-system-prompt',
        stability: 'stable',
        content: this.#systemPrompt,
      })
    }
    if (this.#skillSystemPrompt !== undefined) {
      sections.splice(1, 0, {
        id: 'host-skill-prompt',
        stability: 'stable',
        content: this.#skillSystemPrompt,
      })
    }
    if (facts.warning) {
      sections.push({ id: 'budget-warning', stability: 'volatile', content: facts.warning })
    }
    return sections
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}
