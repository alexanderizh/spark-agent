/**
 * electron-builder 24 only applies `electronLanguages` to the app-level
 * `Contents/Resources/*.lproj` folders on macOS. Electron's framework keeps a
 * second, much larger copy unless we prune it before code signing.
 */
const fs = require('fs/promises');
const path = require('path');

const MAC_LOCALES_TO_KEEP = new Set(['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj']);

async function pruneMacElectronLocales(appPath) {
  const resourcesDir = path.join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
  );
  const entries = await fs.readdir(resourcesDir, { withFileTypes: true });
  const localeDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.lproj'))
    .map((entry) => entry.name);

  await Promise.all(
    localeDirectories
      .filter((name) => !MAC_LOCALES_TO_KEEP.has(name))
      .map((name) => fs.rm(path.join(resourcesDir, name), { recursive: true, force: true })),
  );

  const kept = localeDirectories.filter((name) => MAC_LOCALES_TO_KEEP.has(name)).sort();
  const expected = [...MAC_LOCALES_TO_KEEP].sort();
  if (JSON.stringify(kept) !== JSON.stringify(expected)) {
    throw new Error(
      `Electron locale pruning expected ${expected.join(', ')}, found ${kept.join(', ') || '<none>'}`,
    );
  }
  return { kept, removed: localeDirectories.length - kept.length };
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const result = await pruneMacElectronLocales(appPath);
  console.log(
    `[after-pack] Electron locales: kept ${result.kept.join(', ')}, removed ${result.removed}`,
  );
};

module.exports.pruneMacElectronLocales = pruneMacElectronLocales;
