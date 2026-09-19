#!/usr/bin/env node
/**
 * 文档一致性检查（构建期闸门）。
 *
 * 官网文档有三处「必须一一对应」的隐式契约，一旦破坏不会报错、只会静默失效：
 *   1) docs.ts 里的 topic  ↔  docs-page-registry.ts 的注册键  ↔  docs-pages/<slug>.tsx 文件
 *      —— 缺一个就会出现空白主题或永远走不到的主题
 *   2) 每篇 toc 的 id  ↔  正文 Body 里 <h2>/<h3> 的 id
 *      —— 缺一个会让「本页目录」、滚动高亮、搜索结果深链全部指不到位置
 *   3) 正文组件必须是纯展示（不能含 hooks）
 *      —— 全文检索索引会直接调用 Body() 遍历元素树，含 hooks 会让该篇退化成仅元数据检索
 *
 * 这里用静态文本解析而不是加载 TSX：构建期不需要额外编译一遍文档，失败信息也更直白。
 */
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const docsDir = resolve(root, 'src/content/docs-pages')
const HOOK_PATTERN =
  /\b(useState|useEffect|useMemo|useRef|useCallback|useReducer|useLayoutEffect)\s*\(/

async function main() {
  const docsSource = await readFile(resolve(root, 'src/content/docs.ts'), 'utf8')
  const registrySource = await readFile(resolve(root, 'src/content/docs-page-registry.ts'), 'utf8')

  const slugs = [...docsSource.matchAll(/^\s{4}slug: '([a-z0-9-]+)',$/gm)].map((m) => m[1])
  assert(slugs.length > 0, 'docs.ts 里没有解析到任何 slug')
  assert(new Set(slugs).size === slugs.length, `docs.ts 存在重复 slug: ${duplicates(slugs)}`)

  // 注册表同时存在 'slug': value 与 slug,（简写）两种写法，两种都要认
  const registryBlock = registrySource.match(/docsPageRegistry[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const registryKeys = [
    ...registryBlock.matchAll(/^\s*(?:'([a-z0-9-]+)'|([a-z0-9-]+))\s*[,:]/gm),
  ].map((m) => m[1] ?? m[2])
  const files = (await readdir(docsDir))
    .filter((name) => name.endsWith('.tsx') && !name.startsWith('_'))
    .map((name) => name.replace(/\.tsx$/, ''))

  for (const slug of slugs) {
    assert(registryKeys.includes(slug), `docs-page-registry.ts 缺少注册: ${slug}`)
    assert(files.includes(slug), `docs-pages/ 缺少正文文件: ${slug}.tsx`)
  }
  for (const key of registryKeys) {
    assert(slugs.includes(key), `docs-page-registry.ts 注册了 docs.ts 里不存在的主题: ${key}`)
  }
  for (const file of files) {
    assert(slugs.includes(file), `docs-pages/${file}.tsx 不在 docs.ts 的主题列表里`)
  }

  for (const slug of slugs) {
    const source = await readFile(resolve(docsDir, `${slug}.tsx`), 'utf8')

    // 2) toc id ↔ 正文标题 id
    const tocBlock = source.match(/toc:\s*\[([\s\S]*?)\n\s{2}\],/)?.[1]
    assert(Boolean(tocBlock), `${slug}: 未解析到 toc 数组`)
    const tocIds = [...tocBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
    assert(tocIds.length > 0, `${slug}: toc 是空的`)

    const bodyBlock = source.slice(source.indexOf('const Body'), source.indexOf('export default'))
    const headingIds = [...bodyBlock.matchAll(/<h[23]\s+id="([^"]+)"/g)].map((m) => m[1])

    for (const id of tocIds) {
      assert(
        headingIds.includes(id),
        `${slug}: toc 里的 #${id} 在正文里找不到对应 <h2|h3 id>: 本页目录/搜索深链会失效`,
      )
    }
    for (const id of headingIds) {
      assert(
        tocIds.includes(id),
        `${slug}: 正文里的 <h2|h3 id="${id}"> 没有登记进 toc，不会出现在本页目录`,
      )
    }
    assert(
      tocIds.join(',') === headingIds.filter((id) => tocIds.includes(id)).join(','),
      `${slug}: toc 顺序与正文标题顺序不一致`,
    )

    // 3) 正文必须纯展示
    const hookHit = bodyBlock.match(HOOK_PATTERN)
    assert(
      !hookHit,
      `${slug}: 正文组件里出现了 hooks（${hookHit?.[1]}），会让全文检索退化成仅元数据`,
    )

    // 基础字段
    assert(/aiSummary:\s*'/.test(source), `${slug}: 缺少 aiSummary`)
    assert(/faq:\s*\[/.test(source), `${slug}: 缺少 faq`)
    assert(/export default/.test(source), `${slug}: 缺少 export default`)
  }

  console.log(`[docs-check] ok — ${slugs.length} 篇文档的 slug/注册/toc 锚点/hooks 约束全部通过`)
}

function duplicates(list) {
  return [...new Set(list.filter((item, i) => list.indexOf(item) !== i))].join(', ')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

main().catch((error) => {
  console.error('[docs-check]', error.message)
  process.exitCode = 1
})
