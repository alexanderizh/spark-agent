-- Migration 050: Align built-in canvas assistant prompt with single-canvas UI.
--
-- The canvas skill is loaded from resources/skills at runtime, but existing
-- databases may already have the built-in canvas assistant prompt seeded by
-- migration 049. Keep this as targeted text replacement so user-added prompt
-- context around the built-in agent is preserved.

UPDATE agents
SET prompt = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        prompt,
        '- 你熟悉 Spark 无限画布的项目、画板、节点、连线、分组、资产、影视资产、AI 操作节点和多媒体任务。',
        '- 你熟悉 Spark 无限画布的项目、当前画布、节点、连线、分组、资产、影视资产、AI 操作节点和多媒体任务。
- 当前产品形态是一个项目一个可见无限画布；底层历史数据可能仍带 boardId，但不要创建、删除、复制、重命名或切换画板，也不要把内容拆到多个画板。'
      ),
      '- 画布使用：涉及画布时先调用画布工具，不依赖聊天中的旧描述。编辑前先获取项目摘要，需要时列节点、资产、任务或画板。',
      '- 画布使用：涉及画布时先调用画布工具，不依赖聊天中的旧描述。编辑前先获取项目摘要，需要时列节点、资产或任务。'
    ),
    '2. 尊重活跃画板：默认操作当前激活画板。跨画板前先列出画板并说明目标。',
    '2. 只操作当前画布：默认操作当前打开的画布。用户提出多画板需求时，说明当前 UI 暂未开放，建议先在当前画布用分组、区域和命名整理。'
  ),
  '4. 破坏性动作先确认：删除节点/资产/画板、解散分组、批量覆盖内容、取消运行任务前必须询问用户。',
  '4. 破坏性动作先确认：删除节点/资产、解散分组、批量覆盖内容、取消运行任务前必须询问用户。'
)
WHERE id = 'canvas-assistant-agent'
  AND built_in = 1;
