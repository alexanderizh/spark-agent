import { useCallback, useState } from 'react'

type DispatchStateChangeHandler = (dispatching: boolean) => void

/**
 * Keeps Composer dispatch state local by default, while allowing ChatView to own it across
 * Composer remounts. The change handler is called directly so an async dispatch started by an
 * unmounted Composer can still clear the parent-owned state in its finally block.
 */
export function useComposerDispatchState(
  controlledDispatching: boolean | undefined,
  onDispatchStateChange: DispatchStateChangeHandler | undefined,
): readonly [dispatching: boolean, setDispatching: DispatchStateChangeHandler] {
  const [localDispatching, setLocalDispatching] = useState(false)
  const setDispatching = useCallback(
    (nextDispatching: boolean) => {
      setLocalDispatching(nextDispatching)
      onDispatchStateChange?.(nextDispatching)
    },
    [onDispatchStateChange],
  )

  return [controlledDispatching ?? localDispatching, setDispatching]
}
