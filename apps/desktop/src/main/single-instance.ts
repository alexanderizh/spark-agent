type SingleInstanceApp = {
  requestSingleInstanceLock: () => boolean
  on: (eventName: 'second-instance', handler: () => void) => void
  quit: () => void
}

export function installSingleInstanceLock(
  app: SingleInstanceApp,
  revealPrimaryWindow: () => void,
): boolean {
  const ownsLock = app.requestSingleInstanceLock()
  if (!ownsLock) {
    app.quit()
    return false
  }

  app.on('second-instance', () => {
    revealPrimaryWindow()
  })

  return true
}
