type SingleInstanceApp = {
  requestSingleInstanceLock: () => boolean
  on: (eventName: 'second-instance', handler: (event: unknown, commandLine: string[]) => void) => void
  quit: () => void
}

export function installSingleInstanceLock(
  app: SingleInstanceApp,
  revealPrimaryWindow: () => void,
  handleSecondInstanceArguments?: (commandLine: string[]) => void,
  enabled = true,
): boolean {
  if (!enabled) return true

  const ownsLock = app.requestSingleInstanceLock()
  if (!ownsLock) {
    app.quit()
    return false
  }

  app.on('second-instance', (_event, commandLine) => {
    handleSecondInstanceArguments?.(commandLine)
    revealPrimaryWindow()
  })

  return true
}
