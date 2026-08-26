/* global process */

import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(packageRoot, 'src');
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
for (const [name, version] of Object.entries({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
})) {
  if (typeof version === 'string' && version.startsWith('workspace:')) {
    violations.push(`package.json: workspace dependency ${name}=${version}`);
  }
}

const importPattern = /(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
for (const file of await walk(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier?.startsWith('.')) continue;
    const target = resolve(file, '..', specifier);
    if (target !== sourceRoot && !target.startsWith(`${sourceRoot}/`)) {
      violations.push(`${relative(packageRoot, file)}: import escapes src (${specifier})`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Boundary check passed: spark-engine is self-contained.\n');
}
