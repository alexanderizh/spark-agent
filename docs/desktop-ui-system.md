# Desktop UI System

## Direction

Desktop renderer UI now uses the local `@spark/ui-kit` package as the preferred component layer.

The package is already aligned with this app's consumer desktop product needs:

- Radix primitives for accessible overlays, menus, dialogs, focus management, and collision handling.
- Tailwind CSS v4 through `@tailwindcss/vite` for future utility styling.
- Spark design tokens so components inherit the current app theme, density, and primary color.

Avoid adding a heavyweight UI framework unless a future feature needs a large component family that `@spark/ui-kit` cannot reasonably cover.

## Rules

- Use `@spark/ui-kit` for dialogs, dropdown menus, tabs, tooltips, cards, buttons, and inputs when available.
- Use `apps/desktop/src/renderer/design/components/FormControls.tsx` for renderer-specific input wrappers such as `SparkInput`, `SparkSelect`, `SparkTextarea`, and `SparkCheckbox`.
- Floating UI inside sidebars or scroll containers must render through Radix Portal components such as `DropdownMenuContent` or `DialogContent`.
- Keep page cards and panels at `var(--r-md)` where possible. Avoid stacking card borders inside card borders.
- For destructive actions, prefer `useApp().requestConfirm(...)` over native `window.confirm`.
- For short text input prompts, prefer `useApp().requestPrompt(...)` over native `window.prompt`.
- Use `ConfirmDialog` directly only for local component state that needs a custom confirmation flow.

## Tailwind

The renderer imports `@spark/ui-kit/styles` in `apps/desktop/src/renderer/main.tsx`.

The Electron Vite renderer config already includes `tailwindcss()` from `@tailwindcss/vite`, so Tailwind utility classes can be used in renderer components and `@spark/ui-kit` source.

Theme variables used by portal-rendered overlays are synchronized on `document.documentElement` in `AppContext`.
