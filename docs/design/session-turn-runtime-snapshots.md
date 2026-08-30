# 会话 Turn 运行时快照

> 状态: 已落地 | 最后核对: 2026-08-28

## 目标

会话运行中允许用户切换 Provider、模型和 CLI Spark 覆盖并继续发送。每条消息必须使用发送瞬间的运行时选择，后续切换不能改写已排队消息，也不能污染当前正在执行的 Host turn 及其延迟派发成员。

## 快照边界

- Composer 在发送处理开始、任何异步持久化或附件准备之前抓取完整 `runtimePatch`。模型选择的会话持久化按操作顺序串行，快速 B → C 切换不会因请求乱序回落到 B。
- 普通消息和转 Agent 的 slash command 都把同一份快照写入 `PendingTurn.runtimePatch`；持久化 turn request 在应用重启恢复后仍保留该字段。
- turn 出队时先应用自己的快照，再创建执行器。`cliSparkOverride: null` 表示显式清除覆盖，不能省略。
- Host turn 起跑后再生成不可变的成员运行时选择。workflow/team member 的延迟与嵌套派发从这份快照继承 Provider、模型、适配器、会话模式和 CLI Spark 覆盖，不重新读取可能已被后续消息更新的会话字段。

## Goal 插话兼容

Goal 迭代可以内联纯文本用户插话。Composer 的完整快照中，Provider、模型与 CLI Spark 覆盖允许随被内联消息切换；Agent、适配器、权限、会话模式和推理档位必须与当前会话一致，否则消息保留在队列中按普通 turn 执行。附件、引用、mention、skill 和命令 turn 同样不会被当作纯文本内联。

## 入口一致性

- Chat Composer：运行中有可提交草稿时发送并排队，空草稿时主按钮仍为终止。
- Canvas Agent：每次提交都显式携带 `cliSparkOverride`，包括 `null` 清除语义。
- Slash command：`command:execute` 接收完整运行时快照；排队命令若转 Agent，继续使用入队快照。

## 验证要点

- 快速选择 B、C 后，持久化顺序与最终 turn 快照均为 B → C / C。
- A 执行期间排队 B、C，A 的后续成员仍继承 A；B、C 出队时分别使用各自快照。
- 旧 CLI Spark override 存在时，以 `null` 排队的 turn 和 Canvas turn 不会继承旧值。
- 进程恢复、slash command 出队和 goal 插话均覆盖聚焦回归测试。
