# React portal 浮层不要渲染在 Dropdown/Menu 的 popupRender 内

## 现象（2026-09 实际缺陷）

会话模型选择器「智能路由」行的悬浮配置卡（portal 到 `document.body` 的 `position: fixed` 浮层），
在用户点击路由选项、下拉菜单关闭后**仍停留在屏幕上**；
即使把 `open` 置为 `false`、并在 `onSelect` 里显式清空悬浮态，卡片也不消失。

## 根因（已实证，非推测）

卡片被渲染在 antd `Dropdown` 的 `popupRender` 返回的 React 子树内。
popup 关闭后，该子树不再随宿主组件的状态更新（rc-trigger / CSSMotion 保留并复用已渲染的
children，关闭路径不会把新的 children 应用到 popup），
而 portal 节点已经挂在 `document.body` 上、脱离了 popup 的隐藏与卸载路径，
于是状态怎么改，屏幕上的浮层都不会消失。

vitest + jsdom 实测（同一份结构，仅改变卡片位置）：

- 卡片在 `popupRender` 内：关闭菜单后立即检查为残留，**推进动画 3s 后依然残留**；
- 卡片移到 `Dropdown` 同级：关闭后立刻卸载。

## 约定

- portal 到 `body` 的悬浮层（hover 卡、浮层提示、浮出菜单）一律渲染在触发它的浮层组件**同级**，
  由宿主组件的常规渲染控制生命周期；不要放进 `popupRender` / `dropdownRender` / Menu 的 children 内。
- 浮层显示条件同时绑定「宿主浮层是否打开」与「锚点是否存在」，任一路径失效即卸载。
- 只靠 `onSelect` / `onOpenChange` 里手动 `dismiss` 状态**不能**作为兜底，必须保证组件真正卸载。

## 相关代码 / 回归测试

- `apps/desktop/src/renderer/design/views/chat/ComposerV2.tsx`（`ProviderModelPicker`）
- `apps/desktop/src/renderer/design/views/chat/AutoRouterHoverCard.tsx`、`ProviderQuotaHoverCard.tsx`
- `apps/desktop/src/renderer/design/views/chat/composer-auto-router-hover-card.test.tsx`
  （把卡片挪回 popupRender 内，该测试会失败 —— 用于防止回归）
