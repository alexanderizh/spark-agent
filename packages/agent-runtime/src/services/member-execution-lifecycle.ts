export interface MemberExecutionLifecycleOptions {
  signal: AbortSignal
  isDisposing: () => boolean
  cancel: () => void
  execute: () => Promise<void>
}

/**
 * Binds a member executor to its dispatch signal without losing an abort that
 * happened during async preflight, before the executor listener was attached.
 */
export async function runMemberExecutorIfActive(
  options: MemberExecutionLifecycleOptions,
): Promise<boolean> {
  const onAbort = () => options.cancel()
  options.signal.addEventListener('abort', onAbort)
  try {
    if (options.signal.aborted || options.isDisposing()) {
      onAbort()
      return false
    }
    await options.execute()
    return !options.signal.aborted && !options.isDisposing()
  } finally {
    options.signal.removeEventListener('abort', onAbort)
  }
}
