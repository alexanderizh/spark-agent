---
name: react
description: React component development guide. Use when working with React components (.tsx files), creating UI, using @lobehub/ui components, implementing routing, or building frontend features. Triggers on React component creation, modification, layout implementation, or navigation tasks.
---

# React Component Writing Guide

- Use antd-style for complex styles; simple cases use inline `style`.
- Use `Flexbox` and `Center` from `@lobehub/ui` for layouts (see references/layout-kit.md).
- Component priority: `src/components` > installed packages > `@lobehub/ui` > antd.
- Use selectors to access zustand store data.

## @lobehub/ui

Search existing code for usage. Common: ActionIcon, Block, Button, Icon; Avatar, Collapse, Empty, Highlighter, Markdown, Tag, Tooltip; CodeEditor, CopyButton, EditableText, Form, FormModal, Input, SearchBar, Select; Alert, Drawer, Modal; Center, DraggablePanel, Flexbox, Grid, Header, MaskShadow; Burger, Dropdown, Menu, SideNav, Tabs. Reference: node_modules/@lobehub/ui/es/index.mjs.

## Routing

Hybrid: Next.js App Router (auth: login, signup, oauth) in `src/app/[variants]/(auth)/`; React Router DOM (main SPA) in desktopRouter.config.tsx.

- Entry: src/app/[variants]/page.tsx. Desktop: desktopRouter.config.tsx. Mobile: (mobile)/router/mobileRouter.config.tsx. Utils: src/utils/router.tsx.
- Use `dynamicElement`, `redirectElement`, `ErrorBoundary` from @/utils/router.
- **Navigation:** For SPA use `Link` and `useNavigate` from `react-router-dom`, NOT `next/link`. From stores: useGlobalStore.getState().navigate?.(path).
