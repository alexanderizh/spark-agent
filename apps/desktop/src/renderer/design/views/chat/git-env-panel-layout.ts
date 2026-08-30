export const GIT_ENV_PANEL_MIN_RIGHT_GUTTER = 220

export function getRightGutterWidth(chatMainRight: number, contentRight: number): number {
  return Math.max(0, chatMainRight - contentRight)
}

export function shouldAutoCollapseGitEnvPanel(rightGutter: number | null): boolean {
  return rightGutter != null && rightGutter < GIT_ENV_PANEL_MIN_RIGHT_GUTTER
}

export function shouldAutoCollapseGitEnvPanelForViewport({
  panelOpen,
  spaceConstrained,
  wasSpaceConstrained,
}: {
  panelOpen: boolean
  spaceConstrained: boolean
  wasSpaceConstrained: boolean
}): boolean {
  return panelOpen && spaceConstrained && !wasSpaceConstrained
}
