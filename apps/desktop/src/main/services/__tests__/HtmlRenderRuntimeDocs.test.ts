import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  putHtmlRenderRuntimeDoc,
  releaseHtmlRenderRuntimeDoc,
  resolveHtmlRenderAsset,
  takeHtmlRenderRuntimeDoc,
} from '../HtmlRenderRuntimeDocs'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createAssetFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-html-render-assets-'))
  roots.push(root)
  await mkdir(join(root, 'js'), { recursive: true })
  await writeFile(join(root, 'style.css'), 'body { color: lime }')
  await writeFile(join(root, 'js', 'campaign.js'), 'export {}')
  return root
}

describe('HtmlRenderRuntimeDocs', () => {
  it('serves the registered document by token', async () => {
    await putHtmlRenderRuntimeDoc({ token: 'doc-token-01', document: '<h1>hi</h1>' })
    expect(takeHtmlRenderRuntimeDoc('doc-token-01')).toBe('<h1>hi</h1>')
    releaseHtmlRenderRuntimeDoc({ token: 'doc-token-01' })
    expect(takeHtmlRenderRuntimeDoc('doc-token-01')).toBeNull()
  })

  it('resolves relative assets against the registered assetRoot', async () => {
    const root = await createAssetFixture()
    await putHtmlRenderRuntimeDoc({
      token: 'asset-token-1',
      document: '<link rel="stylesheet" href="style.css">',
      assetRoot: root,
    })

    // 返回值是 realpath 规范路径（macOS 上 /var 会被规范化为 /private/var）。
    await expect(resolveHtmlRenderAsset('asset-token-1', ['style.css'])).resolves.toBe(
      await realpath(join(root, 'style.css')),
    )
    await expect(resolveHtmlRenderAsset('asset-token-1', ['js', 'campaign.js'])).resolves.toBe(
      await realpath(join(root, 'js', 'campaign.js')),
    )
  })

  it('returns null for tokens without an assetRoot (chat render blocks)', async () => {
    await putHtmlRenderRuntimeDoc({ token: 'chat-token-01', document: '<p>chat</p>' })
    await expect(resolveHtmlRenderAsset('chat-token-01', ['style.css'])).resolves.toBeNull()
  })

  it('rejects traversal segments and unknown tokens', async () => {
    const root = await createAssetFixture()
    await putHtmlRenderRuntimeDoc({
      token: 'traversal-tk',
      document: '<p>x</p>',
      assetRoot: root,
    })

    await expect(resolveHtmlRenderAsset('traversal-tk', ['..', 'outside.js'])).resolves.toBeNull()
    await expect(resolveHtmlRenderAsset('traversal-tk', ['js/../secret.js'])).resolves.toBeNull()
    await expect(resolveHtmlRenderAsset('traversal-tk', [])).resolves.toBeNull()
    await expect(resolveHtmlRenderAsset('unknown-token', ['style.css'])).resolves.toBeNull()
  })

  it('rejects symbolic-link escapes inside the asset root', async () => {
    const root = await createAssetFixture()
    const outsideRoot = await mkdtemp(join(tmpdir(), 'spark-html-render-outside-'))
    roots.push(outsideRoot)
    const outside = join(outsideRoot, 'outside.js')
    await writeFile(outside, 'outside')
    await symlink(outside, join(root, 'linked.js'))
    await putHtmlRenderRuntimeDoc({
      token: 'symlink-tokn',
      document: '<p>x</p>',
      assetRoot: root,
    })

    await expect(resolveHtmlRenderAsset('symlink-tokn', ['linked.js'])).resolves.toBeNull()
  })

  it('rejects a non-directory assetRoot at put time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-html-render-notdir-'))
    roots.push(root)
    const filePath = join(root, 'plain.txt')
    await writeFile(filePath, 'x')

    await expect(
      putHtmlRenderRuntimeDoc({ token: 'notdir-token', document: '<p>x</p>', assetRoot: filePath }),
    ).rejects.toThrow('directory')
  })
})
