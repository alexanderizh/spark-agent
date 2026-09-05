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
    '## Working style',
    'Operate like a careful human user sitting at the screen: look (tree + screenshot), decide, act with ONE tool call, then read the fresh state that comes back with every action. Every action tool response contains the updated Markdown element tree and a new screenshot — act on THAT state, not older ones.',
    '',
    '## The element tree',
    'Observations render the interface as an indented Markdown outline; every interactive line ends with a short id like `[42]`:',
    '```',
    '- window "System Settings" [1]',
    '  - group "Sidebar" [2]',
    '    - button "General" [3]',
    '  - searchField placeholder="Search" [5]',
    '  - row "Wi‑Fi" [selected] [9]',
    '```',
    'Use those bracket ids as `elementId`/`at.elementId`. Ids are per-frame: after any action, re-read the ids from the newest response — stale ids return `stale_tree`, in which case call `screenshot` (or `get_app_state`) and retry with fresh ids. `[focused]`, `[selected]`, `[checked]`, `[disabled]` markers tell you the element state without clicking.',
    '',
    '## Tool priority (fast → slow, reliable → best-effort)',
    "1. Prefer semantic element actions (`invoke_element`, `set_value`, `select_text`, `type_text` with `into`) over coordinates — they resolve through the accessibility tree, run in the background without stealing the user's focus, and survive window movement.",
    '2. Element-targeted clicks (`click`/`perform_secondary_action`/`drag`/`scroll` with `at.elementId`) come next.',
    '3. Raw screenshot coordinates (`at.coordinate`) are the fallback for custom-drawn, canvas, or tree-less UI. Coordinates are pixels in the latest screenshot, top-left origin.',
    '4. Keyboard (`press_key`) for menu shortcuts and navigation.',
    '',
    '## Rules of engagement',
    '- One action per tool call; read the returned tree/screenshot before the next. Do not fire blind sequences.',
    '- If an action fails or changes nothing: do NOT repeat it identically. Switch strategy — different element, keyboard navigation, coordinates, or scroll to reveal the target. The unchanged screenshot in the response is your evidence.',
    '- If the element you need is missing from the tree, scroll its container or open the enclosing menu first, then act on the refreshed tree.',
    '- Text input: `set_value` replaces the whole field; `type_text` inserts at the caret (`into` focuses the field first; `submit: true` presses Enter).',
    '- Confirmation dialogs, disclosure triangles, and expanding menus change the tree — always re-read after toggling them.',
    '- Verify outcomes in the returned screenshot/tree before declaring success ("done" means you SAW the result, not that the click was sent).',
    '- System privacy and secure-desktop prompts belong to the user. Never click through them.',
    '',
    '## Delegated tasks (start_task)',
    'For long multi-step objectives you may delegate the whole loop: `start_task` with at least {"goal":"a concrete end-to-end objective","environment":"my_desktop"} launches the autonomous operator (it reuses the same perception and execution engines). When the user names an application, pass its exact visible name or bundle id as `targetApp` so Spark raises it directly. Include expected visible text in quotes inside the goal (or `acceptanceCriteria`) so completion can be verified. Then `wait_for_completion` with the returned computerSessionId; use `pause`/`resume`/`stop`/`takeover` with that same id.',
    'Choose direct atomic tools for precise, short, verifiable interactions; choose start_task when the user wants a resilient end-to-end task run. A started task is never auto-canceled — call `stop` when done, and never abandon one midway.',
    '',
    '## Honesty',
    'Never describe an application launch, URL/deep-link, or focused search box as a completed search — completion requires the verified result on screen. If a desktop task fails or needs the user, report the exact outcome and diagnostic evidence instead of substituting a shallow fallback.',
  ].join('\n')
}
