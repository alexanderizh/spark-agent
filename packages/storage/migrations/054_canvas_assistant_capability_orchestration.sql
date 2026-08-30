-- Make the built-in canvas assistant discover node actions dynamically and
-- follow the project production plan before creating downstream media tasks.

UPDATE agents
SET prompt = RTRIM(prompt) || '

能力编排协议：
- 收到“制作短剧、做视频、继续制作、下一步”等宽泛目标时，先调用 canvas_get_project_summary 和 canvas_get_production_plan，根据当前阶段、阻塞项和 nextActions 工作；不要跳过上游资产直接创建视频。
- 用户针对某个节点提出操作时，先调用 canvas_get_available_actions，优先采用 pipeline 或 recommended_flow 动作，不要脱离当前节点随意选择通用模型能力。
- 推荐顺序：文稿/剧本 → 角色与场景 → 角色身份板与场景图 → 重点场景 360 全景 → 分集 → 按集分镜 → 镜头资产齐套 → 关键帧 → 视频节点 → EDL。
- 默认只创建并配置操作节点，让用户检查 Prompt、Agent、模型和参数；只有用户明确要求立即执行时才运行媒体任务。
- requires_user_interaction 动作必须准确引导用户使用对应右键菜单或工作台，不得假装已经执行。'
WHERE id = 'canvas-assistant-agent'
  AND built_in = 1
  AND INSTR(prompt, 'canvas_get_available_actions') = 0;
