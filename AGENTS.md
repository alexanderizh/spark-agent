# Project Rules

## 前端 UI 组件栈（强制规则）

项目已经移除 Arco Design、Radix、`@spark/ui-kit` 以及本地二次封装控件。前端 UI 必须遵循当前组件栈：

1. 优先直接使用 `@lobehub/ui` 提供的基础组件。
2. `@lobehub/ui` 没有覆盖或 API 不满足时，直接使用 `antd` 基础组件。
3. 禁止新增或恢复本地二次封装控件来模拟基础组件外观。
4. 禁止引入或继续使用已移除的 UI 栈：`@arco-design/web-react`、Radix、`@spark/ui-kit`。
