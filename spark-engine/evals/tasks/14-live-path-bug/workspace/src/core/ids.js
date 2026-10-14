export function normalizeId(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/gu, '')
}
