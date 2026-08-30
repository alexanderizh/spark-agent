import { posix } from 'node:path';

function normalize(path: string): string {
  if (path.includes('\0')) throw new Error('Path contains a null byte');
  return posix.resolve('/', path);
}

export class VirtualFileSystem {
  readonly #files = new Map<string, string>();

  constructor(initialFiles: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initialFiles)) this.write(path, content);
  }

  exists(path: string): boolean {
    return this.#files.has(normalize(path));
  }

  read(path: string, offset = 1, limit?: number): string {
    const normalized = normalize(path);
    const content = this.#files.get(normalized);
    if (content === undefined) throw new Error(`File not found: ${normalized}`);
    if (!Number.isInteger(offset) || offset < 1) throw new Error('offset must be a positive integer');
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new Error('limit must be a non-negative integer');
    }
    const lines = content.split('\n');
    return lines.slice(offset - 1, limit === undefined ? undefined : offset - 1 + limit).join('\n');
  }

  write(path: string, content: string): void {
    this.#files.set(normalize(path), content);
  }

  edit(path: string, oldText: string, newText: string): void {
    const normalized = normalize(path);
    const content = this.#files.get(normalized);
    if (content === undefined) throw new Error(`File not found: ${normalized}`);
    const first = content.indexOf(oldText);
    if (first < 0) throw new Error(`Exact text was not found in ${normalized}`);
    if (content.includes(oldText, first + oldText.length)) {
      throw new Error(`Exact text occurs more than once in ${normalized}`);
    }
    this.#files.set(normalized, `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`);
  }

  snapshot(): Readonly<Record<string, string>> {
    return Object.fromEntries([...this.#files].sort(([left], [right]) => left.localeCompare(right)));
  }
}
