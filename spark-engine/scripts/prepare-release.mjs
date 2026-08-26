/* global process */

// Prepares a distributable release directory for the one-line installers:
//
//   node scripts/prepare-release.mjs [output-dir]
//
// Produces:
//   spark-agent-<version>.tgz          npm tarball (npm pack)
//   spark-agent-<version>.tgz.sha256   "<hash>  <file>" sidecar
//   latest.json                        { name, version, sha256, tarball, publishedAt }
//
// The directory can be uploaded to any static host (including the repository
// MinIO artifact conventions); install.sh / install.ps1 consume it via --base.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '..');
const outputDir = resolve(process.argv[2] ?? join(packageRoot, 'release'));
const staging = await mkdtemp(join(tmpdir(), 'spark-release-'));

try {
  const pack = await execute('npm', ['pack', '--pack-destination', staging, '--json'], {
    cwd: packageRoot,
  });
  const packResult = JSON.parse(pack.stdout);
  const filename = packResult[0]?.filename;
  if (typeof filename !== 'string' || !filename.endsWith('.tgz')) {
    throw new Error('npm pack did not return a tarball filename');
  }
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const version = manifest.version;
  if (filename !== `spark-agent-${version}.tgz`) {
    throw new Error(`packed tarball ${filename} does not match package version ${version}`);
  }

  await mkdir(outputDir, { recursive: true });
  const target = join(outputDir, filename);
  await rename(join(staging, filename), target);

  // The one-line installers are fetched from the same base URL as the tarball;
  // a release directory without them is not consumable by curl | sh users.
  await copyFile(join(packageRoot, 'install.sh'), join(outputDir, 'install.sh'));
  await chmod(join(outputDir, 'install.sh'), 0o755);
  await copyFile(join(packageRoot, 'install.ps1'), join(outputDir, 'install.ps1'));

  const bytes = await readFile(target);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(`${target}.sha256`, `${sha256}  ${filename}\n`, 'utf8');
  await writeFile(
    join(outputDir, 'latest.json'),
    `${JSON.stringify(
      {
        name: manifest.name,
        version,
        sha256,
        tarball: filename,
        publishedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  process.stdout.write(
    [
      `Release prepared in ${outputDir}:`,
      `  ${filename} (${bytes.length} bytes)`,
      `  ${filename}.sha256`,
      '  latest.json',
      '  install.sh / install.ps1',
      'Upload the directory to a static host, then install with:',
      `  curl -fsSL <base>/install.sh | SPARK_INSTALL_BASE=<base> sh`,
      '',
    ].join('\n'),
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
