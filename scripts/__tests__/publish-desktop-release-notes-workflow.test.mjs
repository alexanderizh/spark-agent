import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('validates and publishes identical release notes before desktop artifacts', async () => {
  const workflow = await readFile(resolve(ROOT, '.github/workflows/publish-desktop-release.yml'), 'utf8')
  assert.match(workflow, /node scripts\/release-notes\.mjs --version "\$\{VERSION\}" --output "\$\{RELEASE_NOTES_PATH\}"/)
  assert.match(workflow, /gh release create "\$\{TAG\}" --title "\$\{VERSION\}" --notes-file "\$\{RELEASE_NOTES_PATH\}"/)
  assert.match(workflow, /gh release edit "\$\{TAG\}" --title "\$\{VERSION\}" --notes-file "\$\{RELEASE_NOTES_PATH\}"/)
})
