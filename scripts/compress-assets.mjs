#!/usr/bin/env node
/**
 * 压缩 builtin-avatars / canvas-prompt-examples 下的 PNG 图片资源。
 *
 * 背景：这些图都是原图（照片级连续色调），PNG 格式对这类内容压缩率很差，
 * 单张头像 ~300KB、画布示例图 ~2MB，合计 ~127MB，撑大了仓库体积。
 *
 * 策略：保持 PNG 格式（代码用 import.meta.glob('*.png') 写死扩展名，改格式要动
 * 代码，原地处理零改动最安全），通过 ImageMagick：
 *   1. -strip          剥离 EXIF/ICC/profile 等元数据
 *   2. -resize W       按需缩放宽高（canvas-prompt-examples 实际只做侧边栏缩略图，
 *                      原图 1672/640 远超 retina @2x 所需，缩到 retina 2x 尺寸）
 *   3. -colors N       量化调色板（照片级图降到 128~256 色肉眼几乎无差，体积骤降）
 *   4. -define png:compression-*  最大 zlib 压缩
 *
 * 安全保障：
 *   - 先输出到临时文件，校验处理后的图符合预期（缩放目标、体积显著下降）才覆盖；
 *   - 仅当压缩后体积更小（达到 MIN_RATIO）才替换，否则跳过 —— 因此脚本天然幂等，
 *     重复运行不会把已压缩的图再压一遍（再压体积不会更小，就不会替换）。
 *
 * 用法：
 *   node scripts/compress-assets.mjs            # dry-run，只预览不写文件
 *   node scripts/compress-assets.mjs --apply    # 真正执行压缩替换
 *   node scripts/compress-assets.mjs --force    # 配合 --apply，强制覆盖（忽略幂等保护）
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// 需要压缩的目录（相对仓库根）
// - maxWidth: 缩放到此宽度（保持宽高比），undefined 表示不缩放。
//   canvas-prompt-examples 只用于侧边栏卡片缩略图（容器 width:100%，实际渲染
//   宽度 ~400px），retina @2x 最多需要 ~880px，原图 1672/640 严重过剩，缩到
//   retina 2x 尺寸后视觉无感知但体积骤降。
// - colors: 量化调色板色数。
const TARGETS = [
  {
    dir: 'apps/desktop/src/renderer/assets/builtin-avatars',
    // 头像 512x512，卡通/插画风格，128 色足够；不缩放（已是合理尺寸）
    colors: 128,
  },
  {
    dir: 'apps/desktop/src/renderer/assets/canvas-prompt-examples',
    // 顶层 group-/style- 大图 1672x940，画面复杂：缩到 960 宽（retina 2x @480px显示）+ 256 色
    maxWidth: 960,
    colors: 256,
  },
  {
    dir: 'apps/desktop/src/renderer/assets/canvas-prompt-examples/generated',
    // generated 640x360 小图：缩到 480 宽（retina 2x @240px显示）+ 128 色
    maxWidth: 480,
    colors: 128,
  },
];

// 压缩后体积必须小于原体积的此比例才替换（避免噪声让某些图压完反而变大）
const MIN_RATIO = 0.92;

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const FORCE = args.has('--force');

// ---------- helpers ----------

function magick(args, opts = {}) {
  return execFileSync('magick', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function identify(path) {
  // 返回 { width, height }
  const out = execFileSync('magick', ['identify', '-format', '%w %h', path], {
    encoding: 'utf8',
  }).trim();
  const [w, h] = out.split(/\s+/).map(Number);
  return { width: w, height: h };
}

function fileSize(path) {
  return statSync(path).size;
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function listPngs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => extname(f).toLowerCase() === '.png')
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

// ---------- main ----------

function compressOne(srcPath, colors, maxWidth) {
  const beforeSize = fileSize(srcPath);
  const beforeDim = identify(srcPath);
  const tmpPath = srcPath + '.compressed.tmp';

  try {
    const cmd = [
      srcPath,
      '-strip',
    ];
    if (maxWidth && beforeDim.width > maxWidth) {
      // 只在原图更宽时才缩放（避免放大）；'>' 表示不放大
      cmd.push('-resize', `${maxWidth}x>`);
    }
    cmd.push(
      '-colors', String(colors),
      '-define', 'png:compression-level=9',
      '-define', 'png:compression-filter=5',
      '-define', 'png:compression-strategy=1',
      tmpPath,
    );
    magick(cmd);

    const afterSize = fileSize(tmpPath);
    const afterDim = identify(tmpPath);

    // 校验：宽高未意外放大；若指定了 maxWidth 且原图更宽，则结果宽度应等于 maxWidth
    if (afterDim.width > beforeDim.width || afterDim.height > beforeDim.height) {
      rmSync(tmpPath, { force: true });
      return {
        ok: false,
        skipped: true,
        reason: `尺寸变大 ${beforeDim.width}x${beforeDim.height} → ${afterDim.width}x${afterDim.height}`,
        beforeSize,
        afterSize,
      };
    }
    if (maxWidth && beforeDim.width > maxWidth && afterDim.width !== maxWidth) {
      rmSync(tmpPath, { force: true });
      return {
        ok: false,
        skipped: true,
        reason: `缩放未达标 期望宽 ${maxWidth} 实际 ${afterDim.width}`,
        beforeSize,
        afterSize,
      };
    }

    // 仅当体积显著下降才替换（幂等保护：已压缩过的图再压不会更小）
    const ratio = afterSize / beforeSize;
    if (!FORCE && ratio >= MIN_RATIO) {
      rmSync(tmpPath, { force: true });
      return {
        ok: false,
        skipped: true,
        reason: `压缩收益不足 (${(ratio * 100).toFixed(0)}% ≥ ${MIN_RATIO * 100}%)，可能已压缩过`,
        beforeSize,
        afterSize,
      };
    }

    if (!APPLY) {
      rmSync(tmpPath, { force: true });
      return {
        ok: true,
        applied: false,
        beforeSize,
        afterSize,
        beforeDim,
        afterDim,
      };
    }

    // 用临时文件覆盖原文件
    copyFileSync(tmpPath, srcPath);
    rmSync(tmpPath, { force: true });
    return { ok: true, applied: true, beforeSize, afterSize, beforeDim, afterDim };
  } catch (err) {
    rmSync(tmpPath, { force: true });
    return { ok: false, skipped: true, reason: err.message, beforeSize: beforeSize ?? 0, afterSize: 0 };
  }
}

function main() {
  if (!APPLY) {
    console.log('⏸  DRY-RUN 模式（加 --apply 真正执行压缩替换）\n');
  }

  let totalBefore = 0;
  let totalAfter = 0;
  let compressed = 0;
  let skipped = 0;
  let failed = 0;

  for (const { dir: relDir, colors, maxWidth } of TARGETS) {
    const absDir = join(REPO_ROOT, relDir);
    const pngs = listPngs(absDir);
    if (pngs.length === 0) {
      console.log(`(跳过) 目录不存在或无 PNG: ${relDir}`);
      continue;
    }

    const resizeDesc = maxWidth ? `, maxWidth=${maxWidth}` : '';
    console.log(`\n▸ ${relDir}  (${pngs.length} 张, colors=${colors}${resizeDesc})`);
    let dirBefore = 0;
    let dirAfter = 0;

    for (const src of pngs) {
      const r = compressOne(src, colors, maxWidth);
      totalBefore += r.beforeSize || 0;
      totalAfter += r.afterSize || 0;
      dirBefore += r.beforeSize || 0;
      dirAfter += r.afterSize || 0;

      const name = basename(src);
      if (r.ok) {
        compressed++;
        const tag = r.applied ? '✓ 已压缩' : '✓ 将压缩';
        const dimDesc =
          r.beforeDim && r.afterDim &&
          (r.beforeDim.width !== r.afterDim.width || r.beforeDim.height !== r.afterDim.height)
            ? `  [${r.beforeDim.width}×${r.beforeDim.height} → ${r.afterDim.width}×${r.afterDim.height}]`
            : '';
        console.log(
          `  ${tag}  ${name}  ${fmtSize(r.beforeSize)} → ${fmtSize(r.afterSize)}  (-${Math.round((1 - r.afterSize / r.beforeSize) * 100)}%)${dimDesc}`,
        );
      } else if (r.skipped) {
        skipped++;
        console.log(`  → 跳过   ${name}  ${r.reason}`);
      } else {
        failed++;
        console.log(`  ✗ 失败   ${name}  ${r.reason}`);
      }
    }

    console.log(`  小计: ${fmtSize(dirBefore)} → ${fmtSize(dirAfter)}  (-${Math.round((1 - dirAfter / dirBefore) * 100)}%)`);
  }

  console.log('\n──────── 总计 ────────');
  console.log(`原始体积: ${fmtSize(totalBefore)}`);
  console.log(`压缩之后: ${fmtSize(totalAfter)}`);
  console.log(`节省:     ${fmtSize(totalBefore - totalAfter)}  (-${totalBefore ? Math.round((1 - totalAfter / totalBefore) * 100) : 0}%)`);
  console.log(`处理: ${compressed} 张压缩 / ${skipped} 张跳过 / ${failed} 张失败`);

  if (!APPLY) {
    console.log('\n⏸  以上为预览。确认无误后运行: node scripts/compress-assets.mjs --apply');
  } else {
    console.log('\n✅ 完成。所有压缩后的文件已原地替换。');
  }
}

main();
