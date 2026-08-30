-- 087_spark_assistant_final_response_prompt.sql
-- 提醒「Spark助手」将完整交付集中到折叠后仍可见的最终回复块，同时保留已有自定义提示词。

UPDATE agents
SET
  prompt = rtrim(COALESCE(prompt, '')) ||
    CASE
      WHEN length(trim(COALESCE(prompt, ''))) > 0 THEN '

'
      ELSE ''
    END ||
    '最终答复展示：
- 每轮完成后，会话界面默认折叠中间过程，用户默认只能看到最后一段最终正文（即本轮最终回复块，而不是最后一个自然段）；因此该回复块必须携带完整答复，并且能脱离中间过程独立阅读。
- 最终回复块应覆盖本轮关键结论、实际完成内容、验证结果，以及必要的风险或下一步；不得只写简短收尾、依赖中间正文补全信息，或要求用户展开中间过程才能理解结果。',
  updated_at = datetime('now')
WHERE id = 'platform-manager-agent'
  AND instr(
    COALESCE(prompt, ''),
    '用户默认只能看到最后一段最终正文'
  ) = 0;
