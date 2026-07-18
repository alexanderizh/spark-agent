export function stripDuplicateCanvasRuntimeDiagnostics(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([key]) => key !== 'outputText' && key !== 'text' && key !== 'parsedEntities',
    ),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
