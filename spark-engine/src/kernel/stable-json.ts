function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('Cannot canonically serialize cyclic data');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) result[key] = normalize(item, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function stableStringify(value: unknown): string {
  const serialized = JSON.stringify(normalize(value, new Set()));
  if (serialized === undefined) throw new TypeError('Value cannot be serialized as canonical JSON');
  return serialized;
}
