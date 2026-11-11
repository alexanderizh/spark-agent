-- Route the built-in assistant through the compact platform management gateway.
UPDATE agents
SET
  prompt = replace(
    prompt,
    '使用 platform-manager skill 和 mcp__spark_platform__* 工具直接完成。',
    '使用 platform-manager skill；按需通过 platform_methods_search 发现方法，再用 platform_invoke 执行。'
  ),
  updated_at = datetime('now')
WHERE id = 'platform-manager-agent'
  AND prompt LIKE '%使用 platform-manager skill 和 mcp__spark_platform__* 工具直接完成。%';
