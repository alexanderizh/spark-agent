import { Box, useBoxMetrics, useInput, type DOMElement } from 'ink'
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'

const SGR_MOUSE_PREFIX = '\u001b[<'
const PARSED_SGR_MOUSE_PREFIX = '[<'
const MOUSE_WHEEL_STEP = 3

export interface ScrollRegionProps {
  readonly children: ReactNode
  readonly height?: number
  readonly active?: boolean
  readonly onScrollStateChange?: (scrolled: boolean) => void
}

/** Returns the wheel direction encoded by an SGR mouse report. */
export function parseMouseWheelDelta(input: string): -1 | 1 | undefined {
  const prefix = input.startsWith(SGR_MOUSE_PREFIX)
    ? SGR_MOUSE_PREFIX
    : input.startsWith(PARSED_SGR_MOUSE_PREFIX)
      ? PARSED_SGR_MOUSE_PREFIX
      : undefined
  if (prefix === undefined) return undefined
  const match = /^(\d+);\d+;\d+[mM]$/.exec(input.slice(prefix.length))
  if (!match) return undefined
  const button = Number(match[1])
  if ((button & 64) === 0) return undefined
  return (button & 1) === 0 ? -1 : 1
}

/** Mouse reports must never become literal text in the command editor.
 *
 * ScrollRegion deliberately does not enable mouse tracking. Keeping this
 * defensive filter protects callers embedded in a host that already enabled
 * it, while leaving ordinary mouse selection to the terminal emulator.
 */
export function isMouseInput(input: string): boolean {
  const prefix = input.startsWith(SGR_MOUSE_PREFIX)
    ? SGR_MOUSE_PREFIX
    : input.startsWith(PARSED_SGR_MOUSE_PREFIX)
      ? PARSED_SGR_MOUSE_PREFIX
      : undefined
  return prefix !== undefined && /^(?:\d+);\d+;\d+[mM]$/.test(input.slice(prefix.length))
}

/**
 * A fixed terminal viewport for the live TUI output.
 *
 * Ink's Static component is ideal for append-only logs, but a terminal redraw
 * can force the terminal emulator back to the newest row while the user is
 * reading earlier output. This region keeps the transcript in the live frame,
 * owns the scroll offset, and follows new output only until the user scrolls.
 *
 * Mouse tracking is intentionally not enabled here: terminal modes 1000/1006
 * route button and drag events to the CLI, which prevents the terminal
 * emulator's native text selection and copy behavior. Scrolling remains
 * available through PageUp/PageDown/Home/End; native mouse selection remains
 * available for copying output.
 */
export function ScrollRegion(props: ScrollRegionProps): ReactElement {
  const viewportRef = useRef<DOMElement>(null)
  const contentRef = useRef<DOMElement>(null)
  const viewport = useBoxMetrics(viewportRef)
  const content = useBoxMetrics(contentRef)
  const [scrollTop, setScrollTop] = useState(0)
  const scrollTopRef = useRef(0)
  const [followTail, setFollowTail] = useState(true)
  const maxScroll = Math.max(0, content.height - viewport.height)

  useEffect(() => {
    setScrollTop((current) => {
      const next = followTail ? maxScroll : Math.min(current, maxScroll)
      scrollTopRef.current = next
      return next === current ? current : next
    })
  }, [followTail, maxScroll])

  useEffect(() => {
    props.onScrollStateChange?.(props.active !== false && !followTail)
  }, [followTail, props.active, props.onScrollStateChange])

  const moveBy = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(maxScroll, scrollTopRef.current + delta))
      scrollTopRef.current = next
      setScrollTop(next)
      setFollowTail(next >= maxScroll)
    },
    [maxScroll],
  )

  useInput(
    (input, key) => {
      const mouseDirection = parseMouseWheelDelta(input)
      if (mouseDirection !== undefined) {
        moveBy(mouseDirection * MOUSE_WHEEL_STEP)
        return
      }
      if (key.pageUp) {
        setFollowTail(false)
        moveBy(-Math.max(1, viewport.height - 2))
      } else if (key.pageDown) {
        moveBy(Math.max(1, viewport.height - 2))
      } else if (key.home) {
        setFollowTail(false)
        scrollTopRef.current = 0
        setScrollTop(0)
      } else if (key.end) {
        setFollowTail(true)
        scrollTopRef.current = maxScroll
        setScrollTop(maxScroll)
      }
    },
    { isActive: props.active !== false },
  )

  return (
    <Box
      ref={viewportRef}
      {...(props.height === undefined ? {} : { height: props.height })}
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      overflow="hidden"
    >
      <Box
        ref={contentRef}
        flexDirection="column"
        flexShrink={0}
        width="100%"
        position="absolute"
        left={0}
        top={-scrollTop}
      >
        {props.children}
      </Box>
    </Box>
  )
}
