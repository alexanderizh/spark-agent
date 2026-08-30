/** Provider-neutral rules for applying model-generated memory summaries. */
export const MEMORY_PROVENANCE_SYSTEM_PROMPT = [
  '[Memory Provenance]',
  "- Memory summaries may be model-generated. Use them as context, but do not automatically treat them as the user's exact words or final decisions.",
  '- Distinguish explicit user statements from agent suggestions, model inferences, and external findings. Never recall an agent suggestion as something the user decided.',
  "- When the user's current explicit statement conflicts with an older memory, follow the current statement. Mention a memory only when it materially changes the answer, not merely to demonstrate recall.",
].join('\n')
