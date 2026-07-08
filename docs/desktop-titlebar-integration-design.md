# 桌面端页面 Header 吸收系统 Titlebar 设计

> 状态: 实施中 | 最后核对: 2026-06-26

## 背景

桌面端为了解决窗口拖拽、双击最大化、macOS 红黄绿按钮避让、Windows 最小化/最大化/关闭按钮等问题，曾在 Shell 层统一增加系统 titlebar 或拖拽条。会话页自身又有业务 header，导致部分页面出现“系统 titlebar + 页面 header”两层叠加，浪费顶部空间，并在弹层覆盖顶部时出现点击被 `-webkit-app-region: drag` 吞掉的问题。

## 方案

Shell 提供 `titlebar-integrated` 模式，由页面 header 承接系统 titlebar 能力：

- 页面 header 自身设置 `-webkit-app-region: drag`，保留窗口拖拽和双击最大化能力。
- header 内所有按钮、链接、输入框、菜单和弹层根节点必须设置 `-webkit-app-region: no-drag`。
- macOS 折叠菜单时通过 `--integrated-titlebar-left-reserve` 预留 traffic lights 安全区。
- Windows 通过 `--integrated-titlebar-right-reserve` 预留窗口按钮组宽度，并把 `WindowControls` 渲染到页面 header 右侧。
- 未接入 `titlebar-integrated` 的页面继续使用 Shell 原有 `shell-titlebar` / `win-titlebar` / `MacWindowDragHeader` 兜底。

## 当前落地范围

普通会话页已接入页面 header 吸收系统 titlebar：

- 空会话 `chat-sidebar-topbar` 承接拖拽区、折叠按钮和 Windows 窗口按钮。
- 已有会话 `chat-tabbar` 承接拖拽区、折叠按钮和 Windows 窗口按钮。
- 会话页在集成模式下不再额外渲染 Shell titlebar 或 macOS 独立拖拽条。

## 后续接入规则

新页面如果要吸收系统 titlebar，应满足：

- header 高度使用 `var(--integrated-titlebar-height)`。
- 左侧 padding 叠加 `var(--integrated-titlebar-left-reserve)`。
- Windows 右侧保留 `var(--integrated-titlebar-right-reserve)` 或直接渲染 `WindowControls`。
- header 中可交互元素和所有 portal 弹层根节点必须退出 drag region。
