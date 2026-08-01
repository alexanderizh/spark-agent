# ADR-002：Computer Use 采用后台语义、前台短时输入与隔离桌面三通道

> 决策状态: 已接受 | 日期: 2026-08-01

## 背景

桌面系统只有一套全局指针、键盘焦点和前台应用。若 Agent 把所有操作都实现为全局坐标和键盘输入，会持续抢占用户；若只允许 Accessibility/UIA，又无法操作画布、自绘控件和缺少语义树的应用。需要在可用性、并行协同与真实平台限制之间建立明确边界。

## 决策

Computer Use action envelope 使用可验证 execution lane：

1. `background_semantic`：macOS AX、Windows UIA 和受管 AppControlBridge 枚举命令。默认选择，不激活目标应用、不移动指针。
2. `foreground_input`：CGEvent/SendInput 的短时独占窗口。执行前等待用户输入空闲，显示控制状态，持续复核目标并在完成后恢复现场；takeover/cancel 立即中断并释放输入。
3. `isolated_desktop`：为 VM、远程会话或独立桌面预留。首期未实现时返回 unavailable，不得把隐藏窗口或网页 fallback 标为等价完成。

Provider 只能提出规范化动作，不能自行选择比动作类型更低的通道。App 与 Native Host 双端校验 lane/action；旧协议缺失 lane 时 Host 只能按内置映射安全推导。

## 原因

- 语义优先让 Agent 在用户操作其他应用时继续工作，并减少坐标漂移。
- 前台 burst 为无语义控件保留完整能力，同时把焦点干扰限制在可见、可停止的短窗口。
- 隔离桌面承认本地单桌面无法提供任意双用户并发输入，不用虚假承诺掩盖平台限制。
- lane 进入严格协议后，策略、Host、Timeline、指标和回退能使用同一个可审计事实。

## 被否决方案

- 全部使用全局输入：焦点与指针冲突不可控，用户无法稳定接管。
- 全部使用 AX/UIA：无法覆盖自绘 UI、画布和缺失语义树的应用。
- Provider 自由选择通道：不可信模型或页面内容可把高干扰动作伪装成后台操作。
- 浏览器/脚本 fallback 冒充桌面完成：能力不等价且破坏验收真实性。

## 结果

- 普通语义任务默认后台执行；全局输入只作为受控 fallback。
- 两平台必须区分注入事件与真实用户输入，并在长动作中持续检查接管。
- 新执行器必须先声明 lane、目标身份、停止语义和证据边界；不能绕过 ComputerControlBroker。
- 发布验收分别测量后台焦点干扰、前台恢复和 takeover P99；isolated desktop 另立项目，不阻塞本地 V2 自主代码交付。
