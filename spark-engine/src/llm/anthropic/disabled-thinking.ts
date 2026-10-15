/**
 * Whether an Anthropic Messages body should include `thinking: { type: "disabled" }`.
 *
 * Official Claude accepts that block, and OpenAI Responses already omits
 * `reasoning` when effort is off. Volcengine Ark Coding Plan rejects it for
 * GLM models (`thinking.type disabled is not supported by this model`).
 * The same GLM check lives in `packages/agent-runtime/src/services/model.service.ts`
 * (`isGlmModel`). Keep the model pattern in sync with that helper.
 *
 * `SPARK_EVAL_THINKING=omit|disabled` overrides the default. The eval harness
 * sets it on the CLI child; a direct `spark` invocation can set it too.
 */

export type DisabledThinkingWire = 'omit' | 'disabled'

const GLM_MODEL = /^glm(?:[-_.]|$)/iu

export function resolveDisabledThinkingWire(input: {
  readonly baseUrl?: string
  readonly model: string
  readonly override?: string
}): DisabledThinkingWire {
  const override = input.override?.trim()
  if (override === 'omit' || override === 'disabled') return override
  if (override) {
    throw new Error(`Unsupported SPARK_EVAL_THINKING: ${override} (omit | disabled)`)
  }
  return glmOnArkCoding(input.baseUrl, input.model) ? 'omit' : 'disabled'
}

/** Ark Coding Plan anthropic root, plus the `/v1` and `/v1/messages` forms of that same root. */
export function glmOnArkCoding(baseUrl: string | undefined, model: string): boolean {
  if (!GLM_MODEL.test(model.trim())) return false
  if (!baseUrl) return false
  let path: string
  try {
    path = new URL(baseUrl).pathname.replace(/\/+$/u, '')
  } catch {
    return false
  }
  return /\/api\/coding(?:\/v1(?:\/messages)?)?$/iu.test(path)
}
