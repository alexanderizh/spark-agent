-- Migration 032: 去掉内置「全栈编码 Agent」prompt 里固定的默认模型
--
-- migration 028 的 seed 把"默认模型：智谱 GLM-5.2"写进了 Agent 身份提示词，
-- 等于在提示词层面固定了模型。Agent 实际跑哪个模型应由 provider / session 决定，
-- 提示词不该写死。这里把那一行从已安装库里移除。
--
-- 用 REPLACE 精确删掉那一行（含前导换行，避免留下空行），并用 LIKE 守卫：
--  - 幂等：再次执行不会出错；
--  - 不覆盖用户对 prompt 其余部分的二次修改；
--  - 用户若已手动改掉这一行，LIKE 不命中，自然跳过。

UPDATE agents
SET prompt = REPLACE(
  prompt,
  char(10) || '- 默认模型：智谱 GLM-5.2。任务涉及深度推理或长上下文时，提醒用户可切更高规格模型。',
  ''
)
WHERE id = '93785cf1-d570-4a2a-8919-108fbf7f39c3'
  AND prompt LIKE '%默认模型：智谱 GLM-5.2%';
