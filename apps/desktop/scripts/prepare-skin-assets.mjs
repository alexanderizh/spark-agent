// 皮肤插画资产产线：源图 → WebP，并执行体积红线（设计文档 §4.2）。
//
// 用法：
//   node scripts/prepare-skin-assets.mjs --src <源图目录>   转换并写入 public/skins
//   node scripts/prepare-skin-assets.mjs --check            只校验，不转换
//
// 源图命名必须为 <skinId>-<light|dark>.png|jpg；产物命名同名 .webp。
// 美术口径：源图必须先过人工审美评审（v2 决策 D2/D3），本脚本只负责交付与门禁。
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import sharp from 'sharp'

const SKIN_DIR = join(process.cwd(), 'public', 'skins')
const PER_IMAGE_LIMIT = 400_000
const TOTAL_LIMIT = 2_500_000

const argv = process.argv.slice(2)
const checkOnly = argv.includes('--check')
const srcIndex = argv.indexOf('--src')
const srcDir = srcIndex >= 0 ? argv[srcIndex + 1] : null

if (!checkOnly && srcDir == null) {
  console.error('用法：node scripts/prepare-skin-assets.mjs --src <目录> | --check')
  process.exit(1)
}

if (!checkOnly) {
  mkdirSync(SKIN_DIR, { recursive: true })
  const sources = readdirSync(srcDir).filter((name) => /\.(png|jpe?g)$/i.test(name))
  for (const name of sources) {
    const target = join(SKIN_DIR, name.replace(/\.(png|jpe?g)$/i, '.webp'))
    const buffer = await sharp(join(srcDir, name))
      .resize({ width: 2560, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
    writeFileSync(target, buffer)
    console.log(`converted ${name} -> ${target.split(/[\\/]/).pop()} (${buffer.length} bytes)`)
  }
}

const files = readdirSync(SKIN_DIR).filter((name) => name.endsWith('.webp'))
if (files.length === 0) {
  console.error('FAIL public/skins 下没有 WebP 资产')
  process.exit(1)
}

let total = 0
for (const name of files) {
  const size = statSync(join(SKIN_DIR, name)).size
  total += size
  if (size > PER_IMAGE_LIMIT) {
    console.error(`FAIL ${name} 超出单图预算：${size} > ${PER_IMAGE_LIMIT}`)
    process.exit(1)
  }
}
if (total > TOTAL_LIMIT) {
  console.error(`FAIL 皮肤插画总量超出预算：${total} > ${TOTAL_LIMIT}`)
  process.exit(1)
}
console.log(`OK ${files.length} 张皮肤插画，合计 ${total} 字节（上限 ${TOTAL_LIMIT}）`)
