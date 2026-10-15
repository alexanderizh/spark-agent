import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export async function hashFiles(root, relativePaths) {
  const hashes = {}
  for (const rel of relativePaths) {
    try {
      const data = await readFile(join(root, rel))
      hashes[rel] = createHash('sha256').update(data).digest('hex')
    } catch {
      hashes[rel] = undefined
    }
  }
  return hashes
}

export async function walkFiles(root, directory = root, acc = []) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.spark') continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) await walkFiles(root, absolute, acc)
    else if (entry.isFile()) acc.push(relative(root, absolute).split(sep).join('/'))
  }
  return acc
}
