import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('builds signed macOS and Windows depth runtimes before one atomic publish', async () => {
  const workflow = (
    await readFile('.github/workflows/publish-desktop-release.yml', 'utf8')
  ).replaceAll('\r\n', '\n')

  assert.match(workflow, /^  build-optional-capabilities-macos:/m)
  assert.match(workflow, /^  build-optional-capabilities-windows:/m)
  assert.match(workflow, /DEPTH_RUNTIME_REQUIRE_CODESIGN: '1'/)
  assert.match(workflow, /DEPTH_RUNTIME_WINDOWS_REQUIRE_SIGNING: '1'/)
  assert.match(workflow, /depth-runtime-4\.2\.0-1\.24\.3-2-win32-x64-manifest\.json/)
  assert.match(
    workflow,
    /needs:\n      - prepare\n      - build-optional-capabilities-macos\n      - build-optional-capabilities-windows/,
  )
})
