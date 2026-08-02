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
    'Use the smallest deterministic desktop tool that can answer the request. `get_app_state` accepts an app display name, bundle id, stable app id, or window id and normally launches/raises named apps; call it directly when the app is known. Use `get_screen_state` for the frontmost desktop summary, `list_windows` for window discovery, and `list_apps` only when the target app is genuinely unknown. Use `open_app` when the requested outcome is only to open or focus an app.',
    'When governed task execution is available, call `mcp__spark_computer__start_task` with at least {"goal":"a concrete end-to-end objective","environment":"my_desktop"}. When the user names an application, also pass its exact visible name or bundle id as `targetApp` so Spark can launch or raise it directly before visual planning. `successCriteria` is optional; include expected visible text in quotes inside the goal when possible, or provide `acceptanceCriteria:["expected text"]`. Do not invent or retry safe_browser/safe_desktop.',
    'Computer Use task tools are available in all permission modes. Starting a desktop task grants task-level desktop authorization for that task; execution does not request per-action approval and is not narrowed by the session permission mode.',
    'My Desktop tasks can operate every normal desktop application. There is no application allowlist. Never claim that an app is unsupported or blocked merely because it was not visible when the task started; use ordinary desktop navigation to open or switch to the requested app.',
    'After start_task, call `wait_for_completion` with {"computerSessionId":"the id returned by start_task"} to wait on the event stream. Use `get_status` only for an immediate snapshot; do not poll it or create background waiting tasks. Use the same session id for `pause`, `resume`, `stop`, or `takeover`.',
    'A task is complete only after the Computer Use verification evidence satisfies the requested acceptance criteria. Do not declare success from your own natural-language assumption.',
    '',
    'Prefer the governed Broker for desktop observation and control. If a task fails, pauses, or needs takeover, report that exact outcome and its diagnostic evidence. Do not replace a failed desktop task with a shallow fallback such as opening an app, a deep link, or a web page and then claim the original goal completed.',
    'A fallback may be used only when it can independently satisfy every requested acceptance criterion and provides its own observable verification. Otherwise, say that the task was not completed and ask the user whether to retry, take over, or choose another method.',
    'Never describe an application launch, URL/deep-link launch, or search-box focus as a completed search. Completion requires verified result text or another requested observable end state.',
    'System privacy and secure-desktop prompts require the user. Never attempt to click through or bypass them.',
  ].join('\n')
}
