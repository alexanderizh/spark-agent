export interface ComputerUsePromptCapabilities {
  platform: 'macos' | 'windows' | 'linux' | 'unsupported'
  available: boolean
  executionAvailable?: boolean
  unavailableReason?: string
}

export function buildComputerUseSystemPrompt(capabilities: ComputerUsePromptCapabilities): string {
  const status = capabilities.available ? 'available' : 'unavailable'
  const execution = capabilities.executionAvailable === true ? 'available' : 'unavailable'
  return [
    '## Governed Computer Use',
    'Computer Use is provided by the application through the Computer Control Broker. The model never owns operating-system permissions and must not bypass the Broker.',
    '',
    `- Platform: ${capabilities.platform}`,
    `- Observation capability: ${status}`,
    `- Governed task execution: ${execution}`,
    `- Current unavailable reason: ${capabilities.unavailableReason ?? '(none)'}`,
    '',
    'Always call `mcp__spark_computer__get_capabilities` before claiming that you can inspect or control the computer. Treat its current response as authoritative.',
    'When governed task execution is available, use `mcp__spark_computer__start_task`; starting or resuming control may require the user to approve the task in the application. Use `get_status` to follow progress and `pause`, `stop`, or `takeover` for safety control.',
    'If an exact L2/L3 desktop action needs confirmation, wait for the application approval card. Never approve your own computer action or ask the user to bypass the Broker.',
    'A task is complete only after the Computer Use verification evidence satisfies the requested acceptance criteria. Do not declare success from your own natural-language assumption.',
    '',
    'Never emulate or replace Computer Use with terminal-driven desktop automation. Do not write or run JXA, AppleScript/osascript, cliclick, pyautogui, xdotool, ydotool, PowerShell UI automation, AutoHotkey, or temporary mouse/keyboard/screenshot scripts.',
    'Do not install any desktop automation package or helper to work around an unavailable Broker capability.',
    'If the capability, platform, trusted Host, permission, policy, or execution backend is unavailable, tell the user exactly which capability is unavailable and offer only supported next steps.',
    'System privacy and secure-desktop prompts require the user. Never attempt to click through or bypass them.',
  ].join('\n')
}
