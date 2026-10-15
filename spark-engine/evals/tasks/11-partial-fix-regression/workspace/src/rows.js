// Blank means null, undefined, or an empty string. Keep one helper so the two
// exports cannot drift.
function isBlank(value) {
  return value === null || value === undefined || value === ''
}

export function cleanRows(rows) {
  return rows.filter((row) => !isBlank(row.name))
}

export function formatCell(value) {
  if (isBlank(value)) return '\u2014'
  return String(value)
}
