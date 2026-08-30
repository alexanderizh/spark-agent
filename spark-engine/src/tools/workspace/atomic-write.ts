import { chmod, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWriteFile(
  target: string,
  content: string,
  verifyParent: () => Promise<void>,
): Promise<void> {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const temporary = join(parent, `.spark-write-${process.pid}-${randomUUID()}.tmp`);
  let handle;
  try {
    const existingMode = await fileMode(target);
    handle = await open(temporary, 'wx', existingMode ?? 0o644);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (existingMode !== undefined) await chmod(temporary, existingMode);
    await verifyParent();
    await rename(temporary, target);
    await syncDirectory(parent);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function fileMode(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o777;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(path, 'r');
    await directory.sync();
  } finally {
    await directory?.close();
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}
