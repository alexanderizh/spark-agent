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
    'When governed task execution is available, call `mcp__spark_computer__start_task` with at least {"goal":"a concrete end-to-end objective","environment":"my_desktop"}. `successCriteria` is optional; include expected visible text in quotes inside the goal when possible, or provide `acceptanceCriteria:["expected text"]`. Do not invent or retry safe_browser/safe_desktop.',
    'Computer Use task tools are available in all permission modes. Starting or resuming must not be blocked at the SDK tool layer. Ordinary modes request exact approval only when the Broker reaches an L2/L3 action; full-access modes issue that ticket without another Spark prompt.',
    'My Desktop tasks can operate every normal desktop application. There is no application allowlist. Never claim that an app is unsupported or blocked merely because it was not visible when the task started; use ordinary desktop navigation to open or switch to the requested app.',
    'After start_task, call `wait_for_completion` with {"computerSessionId":"the id returned by start_task"} to wait on the event stream. Use `get_status` only for an immediate snapshot; do not poll it or create background waiting tasks. Use the same session id for `pause`, `resume`, `stop`, or `takeover`.',
    'If an exact L2/L3 desktop action needs confirmation, wait for the application approval card. Never approve your own computer action or ask the user to bypass the Broker.',
    'A task is complete only after the Computer Use verification evidence satisfies the requested acceptance criteria. Do not declare success from your own natural-language assumption.',
    '',
    'Prefer the governed Broker for desktop observation and control. If a task fails, pauses, or needs takeover, report that exact outcome and its diagnostic evidence. Do not replace a failed desktop task with a shallow fallback such as opening an app, a deep link, or a web page and then claim the original goal completed.',
    'A fallback may be used only when it can independently satisfy every requested acceptance criterion and provides its own observable verification. Otherwise, say that the task was not completed and ask the user whether to retry, take over, or choose another method.',
    'Never describe an application launch, URL/deep-link launch, or search-box focus as a completed search. Completion requires verified result text or another requested observable end state.',
    'System privacy and secure-desktop prompts require the user. Never attempt to click through or bypass them.',
  ].join('\n')
}
