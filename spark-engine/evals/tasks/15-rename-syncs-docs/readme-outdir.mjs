const MIGRATION_MARKER = /renamed|removed|deprecated|replaced|改名/iu

/**
 * True when README no longer documents `--outdir` as a live flag.
 * A mention fails the check only inside the Usage code block or an
 * options table, and only on a line that does not already mark the
 * flag renamed, removed, deprecated, replaced, or 改名.
 * A migration note such as "`--outdir` was renamed to `--dest`" passes.
 */
export function readmeDropsOutdir(readme) {
  const regions = [...usageCodeBlocks(readme), ...markdownTables(readme)]
  return !regions.some((region) =>
    region.split(/\r?\n/u).some((line) => documentsOutdir(line)),
  )
}

function documentsOutdir(line) {
  return /--outdir\b/u.test(line) && !MIGRATION_MARKER.test(line)
}

function usageCodeBlocks(readme) {
  const lines = readme.split(/\r?\n/u)
  const blocks = []
  let inUsage = false
  let fence = ''
  let current = []
  for (const line of lines) {
    if (!inUsage) {
      if (/^#{1,6}\s+usage\b/iu.test(line)) inUsage = true
      continue
    }
    if (fence === '' && /^#{1,6}\s+/u.test(line)) break
    const opened = fence === '' ? /^(```+|~~~+)/u.exec(line.trim()) : null
    if (opened) {
      fence = opened[1]
      current = []
      continue
    }
    if (fence !== '' && line.trim().startsWith(fence)) {
      blocks.push(current.join('\n'))
      fence = ''
      current = []
      continue
    }
    if (fence !== '') current.push(line)
  }
  return blocks
}

function markdownTables(readme) {
  const tables = []
  let current = []
  for (const line of readme.split(/\r?\n/u)) {
    if (/^\s*\|/u.test(line)) {
      current.push(line)
    } else if (current.length > 0) {
      tables.push(current.join('\n'))
      current = []
    }
  }
  if (current.length > 0) tables.push(current.join('\n'))
  return tables
}
