export declare const DEFAULT_RELEASE_BASE: string

export declare class VerifyError extends Error {
  constructor(message: string)
}

export declare function fetchBounded(
  url: string,
  options: { timeoutMs: number; maxBytes: number },
): Promise<Buffer>

export declare function parseRemoteManifest(raw: string): {
  name: string
  version: string
  sha256: string
  tarball: string
  publishedAt?: string
}

export declare function resolveVerifyBase(input: { baseOverride?: string; env?: NodeJS.ProcessEnv }): string

/** Runs the CLI flow; resolves to the process exit code (0 pass, 1 fail). */
export declare function run(
  argv?: string[],
  out?: (text: string) => void,
): Promise<number>
