/**
 * 影视镜头语言提示词库（文档 §7.10）。
 *
 * 内置静态库：景别 / 构图 / 角度 / 镜头 / 焦点 / 运镜 / 光影 / 色彩 /
 * 质感 / 美术氛围 / 类型片风格 / 反向词 / 连贯性。
 * 用户可把任意组合保存为「镜头预设」（绑定适用场景 + 默认模型参数）。
 * 最终生成任务时，将选中的镜头语言合并到 prompt 和 modelParams。
 *
 * 注意（§7.10 镜头语言注意点）：这些是「短语积木」，应用到分镜时写入
 * shot spec 或 prompt metadata，方便追踪来源。
 */

export type CameraPromptCategory =
  | 'shot_size' // 景别
  | 'angle' // 角度
  | 'movement' // 运镜
  | 'composition' // 构图
  | 'lens' // 镜头焦距
  | 'aperture' // 光圈
  | 'shutter' // 快门
  | 'iso' // 感光度
  | 'white_balance' // 白平衡
  | 'focus' // 焦点
  | 'lighting' // 光影
  | 'color' // 色彩
  | 'exposure' // 曝光与影像纹理
  | 'production_design' // 美术与环境
  | 'atmosphere' // 氛围
  | 'style' // 类型片风格
  | 'negative' // 反向提示词
  | 'continuity' // 连贯性
  | 'texture' // 镜头质感
  | 'pacing' // 剪辑节奏

export type CinematicStyleExampleId =
  | 'noir'
  | 'neo_noir'
  | 'cyberpunk'
  | 'horror'
  | 'romance'
  | 'epic'
  | 'documentary'
  | 'psychological_thriller'
  | 'sci_fi'
  | 'vintage_drama'

const styleExampleModules = import.meta.glob('../../../assets/canvas-prompt-examples/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const STYLE_EXAMPLE_IMAGE_SRC: Record<CinematicStyleExampleId, string> = {
  noir: styleExampleModules['../../../assets/canvas-prompt-examples/style-noir.png'] ?? '',
  neo_noir: styleExampleModules['../../../assets/canvas-prompt-examples/style-neo-noir.png'] ?? '',
  cyberpunk: styleExampleModules['../../../assets/canvas-prompt-examples/style-cyberpunk.png'] ?? '',
  horror: styleExampleModules['../../../assets/canvas-prompt-examples/style-horror.png'] ?? '',
  romance: styleExampleModules['../../../assets/canvas-prompt-examples/style-romance.png'] ?? '',
  epic: styleExampleModules['../../../assets/canvas-prompt-examples/style-epic.png'] ?? '',
  documentary: styleExampleModules['../../../assets/canvas-prompt-examples/style-documentary.png'] ?? '',
  psychological_thriller:
    styleExampleModules['../../../assets/canvas-prompt-examples/style-psychological-thriller.png'] ?? '',
  sci_fi: styleExampleModules['../../../assets/canvas-prompt-examples/style-sci-fi.png'] ?? '',
  vintage_drama: styleExampleModules['../../../assets/canvas-prompt-examples/style-vintage-drama.png'] ?? '',
}

export type CameraPromptItem = {
  id: string
  label: string
  /** 英文 prompt 片段，用于拼接进生成任务的 prompt */
  promptFragment: string
  /** 面向用户的简短说明，用于提示词库检索与展示 */
  description?: string
  tags?: string[]
  exampleImageId?: CinematicStyleExampleId
  negativePrompt?: string
  /** 可选的 modelParams 建议（如运动强度、时长倾向） */
  paramHints?: Record<string, unknown>
}

export type CameraPromptGroup = {
  category: CameraPromptCategory
  label: string
  items: CameraPromptItem[]
}

export function getCameraPromptExampleImage(exampleImageId?: CinematicStyleExampleId): string | undefined {
  if (!exampleImageId) return undefined
  return STYLE_EXAMPLE_IMAGE_SRC[exampleImageId] || undefined
}

export const CAMERA_PROMPT_LIBRARY: CameraPromptGroup[] = [
  {
    category: 'shot_size',
    label: '景别',
    items: [
      {
        id: 'shot_size.extreme_long',
        label: '远景',
        promptFragment: 'extreme long shot, vast landscape',
        description: '交代环境尺度，让人物被空间吞没或托起。',
        tags: ['establishing', 'scale'],
      },
      { id: 'shot_size.long', label: '全景', promptFragment: 'full shot, wide angle, full body visible' },
      { id: 'shot_size.full', label: '全身', promptFragment: 'full body shot, subject visible from head to toe' },
      { id: 'shot_size.medium', label: '中景', promptFragment: 'medium shot, cowboy shot, waist up' },
      { id: 'shot_size.medium_close', label: '中近景', promptFragment: 'medium close-up, shoulders and head visible' },
      { id: 'shot_size.close', label: '近景', promptFragment: 'close-up shot, chest up' },
      { id: 'shot_size.big_close', label: '特写', promptFragment: 'close-up, face filling frame' },
      { id: 'shot_size.extreme_close', label: '大特写', promptFragment: 'extreme close-up, macro detail' },
      { id: 'shot_size.detail', label: '细节', promptFragment: 'insert shot, detail shot of hands and key props' },
      { id: 'shot_size.two_shot', label: '双人镜头', promptFragment: 'two-shot, both characters held in the frame' },
      { id: 'shot_size.over_shoulder', label: '过肩景别', promptFragment: 'over-the-shoulder framing with foreground shoulder' },
    ],
  },
  {
    category: 'angle',
    label: '角度',
    items: [
      { id: 'angle.eye', label: '平视', promptFragment: 'eye-level angle' },
      { id: 'angle.high', label: '俯拍', promptFragment: 'high angle shot, looking down' },
      { id: 'angle.low', label: '仰拍', promptFragment: 'low angle shot, looking up, heroic' },
      { id: 'angle.over_shoulder', label: '过肩', promptFragment: 'over-the-shoulder shot' },
      { id: 'angle.pov', label: '主观视角', promptFragment: 'point of view shot, POV' },
      { id: 'angle.bird', label: '鸟瞰', promptFragment: "bird's eye view, top-down aerial" },
      { id: 'angle.dutch', label: '荷兰角', promptFragment: 'dutch angle, canted frame, visual unease' },
      { id: 'angle.overhead', label: '顶拍', promptFragment: 'overhead shot, straight down camera angle' },
      { id: 'angle.ground', label: '贴地', promptFragment: 'ground-level camera, low camera height close to the floor' },
    ],
  },
  {
    category: 'movement',
    label: '运镜',
    items: [
      { id: 'movement.push', label: '推镜', promptFragment: 'push in, dolly in, zoom in slowly', paramHints: { motionStrength: 0.4 } },
      { id: 'movement.pull', label: '拉镜', promptFragment: 'pull back, dolly out', paramHints: { motionStrength: 0.4 } },
      { id: 'movement.pan', label: '摇镜', promptFragment: 'panning shot, horizontal sweep' },
      { id: 'movement.tilt', label: '俯仰摇', promptFragment: 'tilt shot, camera tilts up or down' },
      { id: 'movement.tracking', label: '移镜', promptFragment: 'tracking shot, lateral movement' },
      { id: 'movement.follow', label: '跟拍', promptFragment: 'follow shot, tracking subject' },
      { id: 'movement.orbit', label: '环绕', promptFragment: 'orbit shot, 360 degree around subject', paramHints: { motionStrength: 0.6 } },
      { id: 'movement.crane', label: '升降', promptFragment: 'crane shot, vertical movement' },
      { id: 'movement.drone', label: '航拍', promptFragment: 'drone shot, smooth aerial movement' },
      { id: 'movement.handheld', label: '手持', promptFragment: 'handheld camera, documentary feel' },
      { id: 'movement.oner', label: '一镜到底', promptFragment: 'one-take, single continuous shot, no cuts' },
    ],
  },
  {
    category: 'composition',
    label: '构图',
    items: [
      { id: 'composition.rule_of_thirds', label: '三分法', promptFragment: 'rule of thirds composition' },
      { id: 'composition.center', label: '中心构图', promptFragment: 'centered composition, symmetrical balance' },
      { id: 'composition.symmetry', label: '对称构图', promptFragment: 'symmetrical composition' },
      { id: 'composition.negative_space', label: '留白', promptFragment: 'negative space composition, isolated subject' },
      { id: 'composition.leading_lines', label: '引导线', promptFragment: 'leading lines guiding the eye toward the subject' },
      { id: 'composition.foreground', label: '前景遮挡', promptFragment: 'foreground framing, depth layering' },
      { id: 'composition.frame', label: '框中框', promptFragment: 'frame within a frame composition' },
      { id: 'composition.depth', label: '纵深构图', promptFragment: 'deep depth composition, leading lines' },
    ],
  },
  {
    category: 'lens',
    label: '镜头焦距',
    items: [
      { id: 'lens.14mm', label: '14mm 超广角', promptFragment: '14mm ultra wide lens, dramatic spatial distortion' },
      { id: 'lens.24mm', label: '24mm 广角', promptFragment: '24mm wide lens, immersive environmental perspective' },
      { id: 'lens.35mm', label: '35mm 叙事', promptFragment: '35mm lens, natural cinematic perspective' },
      { id: 'lens.50mm', label: '50mm 标准', promptFragment: '50mm lens, natural field of view' },
      { id: 'lens.85mm', label: '85mm 人像', promptFragment: '85mm portrait lens, flattering compression' },
      { id: 'lens.telephoto', label: '长焦压缩', promptFragment: 'telephoto lens, compressed background and intimate distance' },
      { id: 'lens.anamorphic', label: '变形宽银幕', promptFragment: 'anamorphic lens, oval bokeh, horizontal lens flares' },
    ],
  },
  {
    category: 'aperture',
    label: '光圈',
    items: [
      { id: 'aperture.f1_4', label: 'f/1.4 极浅景深', promptFragment: 'shot at f/1.4, razor-thin depth of field, dreamy subject isolation' },
      { id: 'aperture.f2_8', label: 'f/2.8 电影人像', promptFragment: 'shot at f/2.8, cinematic portrait separation, controlled background blur' },
      { id: 'aperture.f4', label: 'f/4 平衡层次', promptFragment: 'shot at f/4, balanced subject clarity and environmental context' },
      { id: 'aperture.f8', label: 'f/8 环境叙事', promptFragment: 'shot at f/8, environmental storytelling, broader scene clarity' },
      { id: 'aperture.f11', label: 'f/11 深焦', promptFragment: 'shot at f/11, deep focus, layered foreground and background detail' },
    ],
  },
  {
    category: 'shutter',
    label: '快门',
    items: [
      { id: 'shutter.1_48', label: '1/48 自然运动', promptFragment: '1/48 shutter, natural cinematic motion blur, standard 180-degree shutter feel' },
      { id: 'shutter.1_96', label: '1/96 清晰动作', promptFragment: '1/96 shutter, crisper movement, tighter action detail' },
      { id: 'shutter.1_24', label: '1/24 拖影感', promptFragment: '1/24 shutter, dreamy motion smear, expressive blur trails' },
      { id: 'shutter.long_exposure', label: '长曝光光轨', promptFragment: 'long exposure streaks, smeared city lights, stylized motion trails' },
      { id: 'shutter.freeze', label: '高速凝固', promptFragment: 'high shutter speed, frozen droplets, sharply arrested motion' },
    ],
  },
  {
    category: 'iso',
    label: 'ISO',
    items: [
      { id: 'iso.100', label: 'ISO 100 干净低噪', promptFragment: 'ISO 100, clean image, low noise, polished detail' },
      { id: 'iso.400', label: 'ISO 400 均衡', promptFragment: 'ISO 400, balanced exposure latitude, gentle filmic texture' },
      { id: 'iso.800', label: 'ISO 800 夜景纪实', promptFragment: 'ISO 800, documentary night realism, subtle low-light grain' },
      { id: 'iso.1600', label: 'ISO 1600 粗粝夜感', promptFragment: 'ISO 1600, gritty available-light texture, pronounced grain' },
      { id: 'iso.high_noise', label: '高 ISO 噪点感', promptFragment: 'high ISO noise texture, raw urgent low-light atmosphere' },
    ],
  },
  {
    category: 'white_balance',
    label: '白平衡',
    items: [
      { id: 'white_balance.3200k', label: '3200K 钨丝暖调', promptFragment: '3200K white balance, warm tungsten interior glow' },
      { id: 'white_balance.4300k', label: '4300K 混光中性', promptFragment: '4300K white balance, neutral mixed-light balance' },
      { id: 'white_balance.5600k', label: '5600K 日光标准', promptFragment: '5600K white balance, clean daylight neutrality' },
      { id: 'white_balance.6500k', label: '6500K 冷色夜感', promptFragment: '6500K white balance, cool blue night cast' },
      { id: 'white_balance.skin_tone', label: '肤色优先', promptFragment: 'custom white balance preserving natural skin tones under mixed light' },
    ],
  },
  {
    category: 'focus',
    label: '焦点',
    items: [
      { id: 'focus.shallow', label: '浅景深', promptFragment: 'shallow depth of field, creamy bokeh' },
      { id: 'focus.deep', label: '深焦', promptFragment: 'deep focus, foreground and background both sharp' },
      { id: 'focus.rack', label: '移焦', promptFragment: 'rack focus from foreground object to character face' },
      { id: 'focus.selective', label: '选择性焦点', promptFragment: 'selective focus, subject sharp against soft environment' },
      { id: 'focus.macro', label: '微距', promptFragment: 'macro focus, tactile close detail' },
    ],
  },
  {
    category: 'lighting',
    label: '光影',
    items: [
      { id: 'lighting.low_key', label: '低调光', promptFragment: 'low-key lighting, deep shadows, high contrast' },
      { id: 'lighting.high_key', label: '高调光', promptFragment: 'high-key lighting, bright soft shadows' },
      { id: 'lighting.backlight', label: '逆光', promptFragment: 'strong backlight, rim light around the subject' },
      { id: 'lighting.side', label: '侧光', promptFragment: 'side lighting, sculpted facial shadows' },
      { id: 'lighting.top', label: '顶光', promptFragment: 'top light, stark overhead shadows' },
      { id: 'lighting.under', label: '底光', promptFragment: 'underlighting, unsettling shadows from below' },
      { id: 'lighting.rembrandt', label: '伦勃朗光', promptFragment: 'Rembrandt lighting, small triangle of light on cheek' },
      { id: 'lighting.neon', label: '霓虹', promptFragment: 'neon lighting, colored reflections, urban night glow' },
      { id: 'lighting.practical', label: '实景灯', promptFragment: 'motivated practical lights visible in the scene' },
      { id: 'lighting.volumetric', label: '体积光', promptFragment: 'volumetric light beams through haze' },
    ],
  },
  {
    category: 'color',
    label: '色彩',
    items: [
      { id: 'color.teal_orange', label: '青橙', promptFragment: 'teal and orange color grade, cinematic contrast' },
      { id: 'color.monochrome', label: '黑白', promptFragment: 'monochrome palette, rich black and white tonal range' },
      { id: 'color.desaturated', label: '低饱和', promptFragment: 'desaturated color grade, muted realism' },
      { id: 'color.warm_amber', label: '暖琥珀', promptFragment: 'warm amber color temperature, tungsten glow' },
      { id: 'color.cool_blue', label: '冷蓝', promptFragment: 'cool blue color temperature, lonely night mood' },
      { id: 'color.pastel', label: '粉彩', promptFragment: 'soft pastel palette, gentle romantic mood' },
      { id: 'color.high_contrast', label: '高反差', promptFragment: 'high contrast color grade, bold separation' },
    ],
  },
  {
    category: 'texture',
    label: '镜头质感',
    items: [
      { id: 'texture.shallow_dof', label: '浅景深', promptFragment: 'shallow depth of field, bokeh background' },
      { id: 'texture.telephoto', label: '长焦压缩', promptFragment: 'telephoto compression, compressed perspective' },
      { id: 'texture.wide', label: '广角透视', promptFragment: 'wide-angle perspective, lens distortion' },
      { id: 'texture.grain', label: '电影颗粒', promptFragment: 'cinematic film grain, 35mm texture' },
      { id: 'texture.soft_focus', label: '柔焦', promptFragment: 'soft focus, dreamy diffusion' },
      { id: 'texture.hdr', label: '高动态范围', promptFragment: 'high dynamic range, rich detail in shadows and highlights' },
    ],
  },
  {
    category: 'exposure',
    label: '曝光与纹理',
    items: [
      { id: 'exposure.35mm_grain', label: '35mm 颗粒', promptFragment: '35mm film grain, organic analog texture' },
      { id: 'exposure.halation', label: '胶片辉光', promptFragment: 'film halation around highlights, analog bloom' },
      { id: 'exposure.lens_flare', label: '镜头眩光', promptFragment: 'controlled cinematic lens flare' },
      { id: 'exposure.under_silhouette', label: '欠曝剪影', promptFragment: 'underexposed silhouette, protected highlights' },
      { id: 'exposure.motion_blur', label: '运动模糊', promptFragment: 'natural motion blur, kinetic image smear' },
      { id: 'exposure.crisp_digital', label: '数字锐利', promptFragment: 'clean digital capture, crisp edges, low noise' },
    ],
  },
  {
    category: 'production_design',
    label: '美术与环境',
    items: [
      { id: 'production_design.rain', label: '雨夜', promptFragment: 'rain-soaked environment, wet surfaces, visible raindrops' },
      { id: 'production_design.smoke', label: '烟雾', promptFragment: 'smoke drifting through the set, layered atmosphere' },
      { id: 'production_design.fog', label: '雾气', promptFragment: 'low fog, soft obscured background' },
      { id: 'production_design.reflective_asphalt', label: '反光地面', promptFragment: 'reflective wet asphalt, mirrored city lights' },
      { id: 'production_design.dust', label: '尘埃', promptFragment: 'dust particles in light beams, tactile air' },
      { id: 'production_design.steam', label: '蒸汽', promptFragment: 'steam rising from vents and street grates' },
      { id: 'production_design.tungsten_room', label: '钨丝灯室内', promptFragment: 'tungsten practical lights, lived-in interior set dressing' },
      { id: 'production_design.neon_street', label: '霓虹街区', promptFragment: 'dense neon street, layered signs, urban night production design' },
      { id: 'production_design.futuristic_lab', label: '未来实验室', promptFragment: 'futuristic laboratory, glass panels, clean light strips' },
      { id: 'production_design.abandoned_corridor', label: '废弃走廊', promptFragment: 'abandoned corridor, peeling paint, broken fluorescent lights' },
    ],
  },
  {
    category: 'atmosphere',
    label: '情绪氛围',
    items: [
      { id: 'atmosphere.lonely', label: '孤独', promptFragment: 'lonely mood, wide negative space, cool distant light' },
      { id: 'atmosphere.oppressive', label: '压迫', promptFragment: 'oppressive atmosphere, low ceiling feeling, heavy shadows' },
      { id: 'atmosphere.fear', label: '恐惧', promptFragment: 'fearful atmosphere, obscured background, unstable framing' },
      { id: 'atmosphere.romantic', label: '浪漫', promptFragment: 'romantic atmosphere, soft backlight, warm highlights' },
      { id: 'atmosphere.power', label: '权力感', promptFragment: 'powerful mood, low angle, centered composition, hard light' },
      { id: 'atmosphere.chaos', label: '混乱', promptFragment: 'chaotic energy, handheld movement, motion blur, fragmented composition' },
      { id: 'atmosphere.mystery', label: '神秘', promptFragment: 'mysterious mood, partial silhouettes, hidden details in shadow' },
      { id: 'atmosphere.dream', label: '梦境', promptFragment: 'dreamlike atmosphere, soft diffusion, floating slow motion' },
    ],
  },
  {
    category: 'style',
    label: '类型片风格',
    items: [
      {
        id: 'style.noir',
        label: '经典黑色电影',
        promptFragment:
          'classic black and white film noir, hard low-key lighting, venetian blind shadows, wet pavement, moral ambiguity, 35mm film grain',
        description: '适合侦探、犯罪、命运感和强明暗对比的段落。',
        tags: ['crime', 'detective', 'black-white'],
        exampleImageId: 'noir',
      },
      {
        id: 'style.neo_noir',
        label: '新黑色电影',
        promptFragment:
          'neo-noir style, modern city night, saturated practical lights, rain reflections, cynical mood, sharp contrast and deep shadows',
        description: '保留黑色电影的宿命感，同时加入现代城市色彩。',
        tags: ['urban', 'crime', 'night'],
        exampleImageId: 'neo_noir',
      },
      {
        id: 'style.cyberpunk',
        label: '赛博朋克',
        promptFragment:
          'cyberpunk film style, dense neon signage, rain-soaked megacity, holographic glow, high-tech low-life atmosphere, magenta cyan palette',
        description: '适合未来都市、科技压迫、夜雨霓虹和反乌托邦。',
        tags: ['sci-fi', 'neon', 'future'],
        exampleImageId: 'cyberpunk',
      },
      {
        id: 'style.horror',
        label: '恐怖片',
        promptFragment:
          'cinematic horror style, oppressive darkness, unsettling negative space, sickly practical light, suspenseful shadows, dread-filled atmosphere',
        description: '把空间变成威胁，用遮挡、暗部和反常光源制造不安。',
        tags: ['fear', 'suspense', 'dark'],
        exampleImageId: 'horror',
      },
      {
        id: 'style.romance',
        label: '爱情片',
        promptFragment:
          'romantic cinema style, soft warm backlight, gentle diffusion, intimate framing, delicate color palette, emotionally tender atmosphere',
        description: '适合亲密关系、回忆、温柔凝视和情绪告白。',
        tags: ['soft', 'warm', 'intimate'],
        exampleImageId: 'romance',
      },
      {
        id: 'style.epic',
        label: '史诗片',
        promptFragment:
          'epic cinema style, grand scale, dramatic sky, heroic low angle, sweeping composition, powerful contrast, majestic atmosphere',
        description: '把普通动作抬高为宏大命运，强调尺度和仪式感。',
        tags: ['scale', 'heroic', 'grand'],
        exampleImageId: 'epic',
      },
      {
        id: 'style.documentary',
        label: '纪录片',
        promptFragment:
          'observational documentary style, natural available light, handheld camera realism, imperfect framing, authentic texture, candid moment',
        description: '适合真实、即兴、生活切片和低干预质感。',
        tags: ['realism', 'handheld', 'candid'],
        exampleImageId: 'documentary',
      },
      {
        id: 'style.psychological_thriller',
        label: '心理惊悚',
        promptFragment:
          'psychological thriller style, claustrophobic framing, controlled unease, distorted perspective, muted palette, ambiguous shadows',
        description: '强调人物内心裂缝，用构图和焦段制造不可信空间。',
        tags: ['thriller', 'claustrophobic', 'unease'],
        exampleImageId: 'psychological_thriller',
      },
      {
        id: 'style.sci_fi',
        label: '科幻片',
        promptFragment:
          'science fiction cinema style, sleek future technology, clean architectural lighting, cool palette, speculative realism, precise production design',
        description: '适合未来设施、未知科技、宇宙探索和理性冷感。',
        tags: ['future', 'technology', 'clean'],
        exampleImageId: 'sci_fi',
      },
      {
        id: 'style.vintage_drama',
        label: '复古年代剧',
        promptFragment:
          'vintage period drama style, warm tungsten interiors, period-accurate production design, soft film grain, restrained emotion, elegant composition',
        description: '适合年代质感、家族戏、回忆叙事和克制表演。',
        tags: ['period', 'warm', 'drama'],
        exampleImageId: 'vintage_drama',
      },
    ],
  },
  {
    category: 'negative',
    label: '反向词',
    items: [
      {
        id: 'negative.image_basic',
        label: '图像通用',
        promptFragment:
          'negative prompt: low quality, blurry, deformed face, malformed hands, extra fingers, missing fingers, bad anatomy, duplicate limbs, watermark, logo, unreadable text, oversharpened, plastic skin',
        description: '适合生图节点，减少畸形、文字、水印和低质输出。',
      },
      {
        id: 'negative.video_basic',
        label: '视频通用',
        promptFragment:
          'negative prompt: flickering, jitter, warped limbs, morphing face, unstable identity, inconsistent clothing, temporal artifacts, camera shake unless specified, subtitles, watermark, logo',
        description: '适合视频节点，压制闪烁、身份漂移和时间连续性问题。',
        paramHints: { negativePrompt: 'flickering, jitter, warped limbs, morphing face, unstable identity, subtitles, watermark' },
      },
      {
        id: 'negative.cinematic',
        label: '电影感净化',
        promptFragment:
          'negative prompt: flat lighting, amateur composition, overexposed highlights, crushed shadows, cheap CGI, stock photo look, overprocessed HDR, inconsistent perspective',
        description: '用于避免廉价质感、业余构图和过度后期。',
      },
    ],
  },
  {
    category: 'continuity',
    label: '连贯性',
    items: [
      {
        id: 'continuity.character',
        label: '角色一致',
        promptFragment:
          'maintain consistent character identity, same face, same hairstyle, same costume, consistent body proportions across shots',
      },
      {
        id: 'continuity.scene',
        label: '场景一致',
        promptFragment:
          'maintain consistent location layout, same props, same lighting direction, same weather and time of day across shots',
      },
      {
        id: 'continuity.action',
        label: '动作衔接',
        promptFragment:
          'continuous action, preserve screen direction, match eyeline, match movement speed and body position between shots',
      },
      {
        id: 'continuity.style',
        label: '风格统一',
        promptFragment:
          'consistent visual style, same color grade, same lens language, same film texture, coherent cinematic universe',
      },
    ],
  },
  {
    category: 'pacing',
    label: '剪辑节奏',
    items: [
      { id: 'pacing.fast', label: '快节奏', promptFragment: 'fast-paced, energetic, quick cuts' },
      { id: 'pacing.slow', label: '慢节奏', promptFragment: 'slow pace, lingering, contemplative' },
      { id: 'pacing.tension', label: '紧张停顿', promptFragment: 'tense pause, held beat' },
      { id: 'pacing.build', label: '情绪铺垫', promptFragment: 'emotional buildup, gradual escalation' },
      { id: 'pacing.montage', label: '蒙太奇', promptFragment: 'montage sequence, time compression' },
    ],
  },
]

/** 镜头预设适用场景（文档 §7.10） */
export type CameraPresetScene =
  | 'dialogue'
  | 'action'
  | 'suspense'
  | 'romance'
  | 'chase'
  | 'memory'
  | 'dream'

export const CAMERA_PRESET_SCENE_LABELS: Record<CameraPresetScene, string> = {
  dialogue: '对话',
  action: '打斗',
  suspense: '悬疑',
  romance: '爱情',
  chase: '追逐',
  memory: '回忆',
  dream: '梦境',
}

/** 用户保存的镜头预设（文档 §7.10：预设可绑定适用场景 + 默认模型参数） */
export type CameraPreset = {
  id: string
  name: string
  /** 选中的镜头语言 item id 组合 */
  itemIds: string[]
  scenes?: CameraPresetScene[]
  defaultParams?: {
    durationSec?: number
    aspectRatio?: string
    motionStrength?: number
    style?: string
    negativePrompt?: string
  }
}

/** 把选中的镜头语言 itemIds 合并成 prompt 片段 */
export function buildCameraPromptFragment(itemIds: string[]): string {
  if (itemIds.length === 0) return ''
  const idSet = new Set(itemIds)
  const fragments: string[] = []
  for (const group of CAMERA_PROMPT_LIBRARY) {
    for (const item of group.items) {
      if (idSet.has(item.id)) fragments.push(item.promptFragment)
    }
  }
  return fragments.join(', ')
}

/** 收集选中项的 modelParams 建议 */
export function collectCameraParamHints(itemIds: string[]): Record<string, unknown> {
  if (itemIds.length === 0) return {}
  const idSet = new Set(itemIds)
  const merged: Record<string, unknown> = {}
  for (const group of CAMERA_PROMPT_LIBRARY) {
    for (const item of group.items) {
      if (idSet.has(item.id) && item.paramHints) {
        Object.assign(merged, item.paramHints)
      }
    }
  }
  return merged
}
