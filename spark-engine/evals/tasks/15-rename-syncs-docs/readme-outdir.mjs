const MIGRATION_MARKER = /renamed|removed|deprecated|replaced|改名/iu

/**
 * True when no README line still documents `--outdir` as a live flag.
 * The whole file is scanned. A line that contains `--outdir` fails
 * unless that same line marks the flag renamed, removed, deprecated,
 * replaced, or 改名. A migration note such as "`--outdir` was renamed
 * to `--dest`" passes; the same note does not excuse another line.
 */
export function readmeDropsOutdir(readme) {
  return !readme.split(/\r?\n/u).some((line) => documentsOutdir(line))
}

function documentsOutdir(line) {
  return /--outdir\b/u.test(line) && !MIGRATION_MARKER.test(line)
}
