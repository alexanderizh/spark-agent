import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ArtifactStore } from '../seams.js';
import { ArtifactRefSchema, type ArtifactRef } from './schema.js';

interface MemoryArtifact {
  readonly content: string | Uint8Array;
  readonly ref: ArtifactRef;
}

let temporaryArtifactCounter = 0;

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
}

function makeRef(content: string | Uint8Array, mediaType: string): ArtifactRef {
  const bytes = toBytes(content);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const preview = typeof content === 'string' ? content.slice(0, 240) : `[binary ${bytes.byteLength} bytes]`;
  return ArtifactRefSchema.parse({
    sha256,
    bytes: bytes.byteLength,
    mediaType,
    summary: preview,
    readHint: `spark artifact read ${sha256}`,
  });
}

export class MemoryArtifactStore implements ArtifactStore {
  readonly #artifacts = new Map<string, MemoryArtifact>();

  async put(content: string | Uint8Array, mediaType: string): Promise<ArtifactRef> {
    const ref = makeRef(content, mediaType);
    this.#artifacts.set(ref.sha256, { content: structuredClone(content), ref });
    return ref;
  }

  async get(ref: ArtifactRef): Promise<string | Uint8Array> {
    const validated = ArtifactRefSchema.parse(ref);
    const artifact = this.#artifacts.get(validated.sha256);
    if (!artifact) throw new Error(`Artifact not found: ${validated.sha256}`);
    return structuredClone(artifact.content);
  }
}

export class FileArtifactStore implements ArtifactStore {
  readonly #root: string;

  constructor(dataRoot: string) {
    this.#root = resolve(dataRoot, 'artifacts');
  }

  async put(content: string | Uint8Array, mediaType: string): Promise<ArtifactRef> {
    const ref = makeRef(content, mediaType);
    const directory = resolve(this.#root, ref.sha256.slice(0, 2));
    const path = resolve(directory, ref.sha256);
    await mkdir(directory, { recursive: true });
    temporaryArtifactCounter += 1;
    const temporaryPath = resolve(
      directory,
      `.${ref.sha256}.${process.pid}.${temporaryArtifactCounter}.tmp`,
    );
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(toBytes(content));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
      await this.get(ref);
    } finally {
      await removeTemporaryFile(temporaryPath);
    }
    return ref;
  }

  async get(ref: ArtifactRef): Promise<string | Uint8Array> {
    const validated = ArtifactRefSchema.parse(ref);
    const content = await readFile(
      resolve(this.#root, validated.sha256.slice(0, 2), validated.sha256),
    );
    const actualHash = createHash('sha256').update(content).digest('hex');
    if (actualHash !== validated.sha256 || content.byteLength !== validated.bytes) {
      throw new Error(`Artifact integrity check failed: ${validated.sha256}`);
    }
    if (validated.mediaType.startsWith('text/') || validated.mediaType === 'application/json') {
      return content.toString('utf8');
    }
    return new Uint8Array(content);
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
}
