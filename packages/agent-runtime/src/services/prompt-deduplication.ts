/** Normalize only formatting differences that do not change prompt meaning. */
export function normalizePromptBody(value: string | undefined): string {
  return (value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

/** Join prompt sections while retaining the first occurrence of exact duplicate bodies. */
export function joinDistinctPromptSections(
  ...sections: Array<string | undefined>
): string | undefined {
  const seen = new Set<string>()
  const distinct: string[] = []
  for (const section of sections) {
    const retained = section?.trim()
    const normalized = normalizePromptBody(retained)
    if (normalized.length === 0 || seen.has(normalized)) continue
    seen.add(normalized)
    // Match the previous joinPromptSections behavior for retained sections:
    // trim only their outer boundary and preserve every internal byte.
    distinct.push(retained ?? '')
  }
  return distinct.length > 0 ? distinct.join('\n\n') : undefined
}
