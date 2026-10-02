/**
 * 火山豆包语音（Volcengine Speech）内置音色表。
 *
 * 为什么需要内置静态表：官方「音色列表」接口（`ListSpeakers` / `ListBigModelTTSTimbres`，
 * serviceCode `speech_saas_prod`）走的是**火山 OpenAPI AK/SK 签名**（`open.volcengineapi.com`），
 * 与本项目火山语音渠道使用的 `X-Api-Key`（`openspeech.bytedance.com`）不是同一套凭据；
 * 渠道 profile 只存一个 API Key，无法直接调用该接口。
 *
 * 因此默认给一份离线可用的静态候选，来源为官方「豆包语音合成模型 2.0」音色列表
 * （https://www.volcengine.com/docs/DoubaoVoice/Tonelist-1 ，2026-10-02 抓取核对）。
 * 只收录 `*_uranus_bigtts` 系统音色；`ICL_*` 是账号复刻音色，不属于系统表，故排除。
 *
 * 需要按账号实时拉取（含复刻音色）的用户，可在渠道「音色获取」里改为自定义请求。
 */

/** 单条内置音色：value 是提交给 `speaker` 参数的值，label 是官方可读名。 */
export interface VolcengineSpeechVoiceEntry {
  value: string
  label: string
}

export const VOLCENGINE_SPEECH_VOICE_TABLE_SOURCE_URL =
  'https://www.volcengine.com/docs/DoubaoVoice/Tonelist-1'

/** 该表对应的官方文档核对日期，UI 上用于说明数据新鲜度。 */
export const VOLCENGINE_SPEECH_VOICE_TABLE_CHECKED_AT = '2026-10-02'

/** 豆包语音合成模型 2.0 系统音色（93 个）。 */
export const VOLCENGINE_SPEECH_VOICE_TABLE: readonly VolcengineSpeechVoiceEntry[] = [
  { value: 'zh_female_vv_uranus_bigtts', label: 'Vivi 2.0' },
  { value: 'zh_female_xiaohe_uranus_bigtts', label: '小何 2.0' },
  { value: 'zh_male_m191_uranus_bigtts', label: '云舟 2.0' },
  { value: 'zh_male_taocheng_uranus_bigtts', label: '小天 2.0' },
  { value: 'zh_male_liufei_uranus_bigtts', label: '刘飞 2.0' },
  { value: 'zh_female_sophie_uranus_bigtts', label: '魅力苏菲 2.0' },
  { value: 'zh_female_qingxinnvsheng_uranus_bigtts', label: '清新女声 2.0' },
  { value: 'zh_female_cancan_uranus_bigtts', label: '知性灿灿 2.0' },
  { value: 'zh_female_sajiaoxuemei_uranus_bigtts', label: '撒娇学妹 2.0' },
  { value: 'zh_female_tianmeixiaoyuan_uranus_bigtts', label: '甜美小源 2.0' },
  { value: 'zh_female_tianmeitaozi_uranus_bigtts', label: '甜美桃子 2.0' },
  { value: 'zh_female_shuangkuaisisi_uranus_bigtts', label: '爽快思思 2.0' },
  { value: 'zh_female_peiqi_uranus_bigtts', label: '佩奇猪 2.0' },
  { value: 'zh_female_linjianvhai_uranus_bigtts', label: '邻家女孩 2.0' },
  { value: 'zh_male_shaonianzixin_uranus_bigtts', label: '少年梓辛 2.0' },
  { value: 'zh_male_sunwukong_uranus_bigtts', label: '猴哥 2.0' },
  { value: 'zh_female_yingyujiaoxue_uranus_bigtts', label: 'Tina老师 2.0' },
  { value: 'zh_female_kefunvsheng_uranus_bigtts', label: '暖阳女声 2.0' },
  { value: 'zh_female_xiaoxue_uranus_bigtts', label: '儿童绘本 2.0' },
  { value: 'zh_male_dayi_uranus_bigtts', label: '大壹 2.0' },
  { value: 'zh_female_mizai_uranus_bigtts', label: '黑猫侦探社咪仔 2.0' },
  { value: 'zh_female_jitangnv_uranus_bigtts', label: '鸡汤女 2.0' },
  { value: 'zh_female_meilinvyou_uranus_bigtts', label: '魅力女友 2.0' },
  { value: 'zh_female_liuchangnv_uranus_bigtts', label: '流畅女声 2.0' },
  { value: 'zh_male_ruyayichen_uranus_bigtts', label: '儒雅逸辰 2.0' },
  { value: 'en_male_tim_uranus_bigtts', label: 'Tim' },
  { value: 'en_female_dacey_uranus_bigtts', label: 'Dacey' },
  { value: 'en_female_stokie_uranus_bigtts', label: 'Stokie' },
  { value: 'zh_female_wenroumama_uranus_bigtts', label: '温柔妈妈 2.0' },
  { value: 'zh_male_jieshuoxiaoming_uranus_bigtts', label: '解说小明 2.0' },
  { value: 'zh_female_tvbnv_uranus_bigtts', label: 'TVB女声 2.0' },
  { value: 'zh_male_yizhipiannan_uranus_bigtts', label: '译制片男 2.0' },
  { value: 'zh_female_qiaopinv_uranus_bigtts', label: '俏皮女声 2.0' },
  { value: 'zh_female_zhishuaiyingzi_uranus_bigtts', label: '直率英子 2.0' },
  { value: 'zh_male_linjiananhai_uranus_bigtts', label: '邻家男孩 2.0' },
  { value: 'zh_male_silang_uranus_bigtts', label: '四郎 2.0' },
  { value: 'zh_male_ruyaqingnian_uranus_bigtts', label: '儒雅青年 2.0' },
  { value: 'zh_male_qingcang_uranus_bigtts', label: '擎苍 2.0' },
  { value: 'zh_male_xionger_uranus_bigtts', label: '熊二 2.0' },
  { value: 'zh_female_yingtaowanzi_uranus_bigtts', label: '樱桃丸子 2.0' },
  { value: 'zh_male_wennuanahu_uranus_bigtts', label: '温暖阿虎 2.0' },
  { value: 'zh_male_naiqimengwa_uranus_bigtts', label: '奶气萌娃 2.0' },
  { value: 'zh_female_popo_uranus_bigtts', label: '婆婆 2.0' },
  { value: 'zh_female_gaolengyujie_uranus_bigtts', label: '高冷御姐 2.0' },
  { value: 'zh_male_aojiaobazong_uranus_bigtts', label: '傲娇霸总 2.0' },
  { value: 'zh_male_lanyinmianbao_uranus_bigtts', label: '懒音绵宝 2.0' },
  { value: 'zh_male_fanjuanqingnian_uranus_bigtts', label: '反卷青年 2.0' },
  { value: 'zh_female_wenroushunv_uranus_bigtts', label: '温柔淑女 2.0' },
  { value: 'zh_female_gufengshaoyu_uranus_bigtts', label: '古风少御 2.0' },
  { value: 'zh_male_huolixiaoge_uranus_bigtts', label: '活力小哥 2.0' },
  { value: 'zh_male_baqiqingshu_uranus_bigtts', label: '霸气青叔 2.0' },
  { value: 'zh_male_xuanyijieshuo_uranus_bigtts', label: '悬疑解说 2.0' },
  { value: 'zh_female_mengyatou_uranus_bigtts', label: '萌丫头 2.0' },
  { value: 'zh_female_tiexinnvsheng_uranus_bigtts', label: '贴心女声 2.0' },
  { value: 'zh_female_jitangmei_uranus_bigtts', label: '鸡汤妹妹 2.0' },
  { value: 'zh_male_cixingjieshuonan_uranus_bigtts', label: '磁性解说男声 2.0' },
  { value: 'zh_male_liangsangmengzai_uranus_bigtts', label: '亮嗓萌仔 2.0' },
  { value: 'zh_female_kailangjiejie_uranus_bigtts', label: '开朗姐姐 2.0' },
  { value: 'zh_male_gaolengchenwen_uranus_bigtts', label: '高冷沉稳 2.0' },
  { value: 'zh_male_shenyeboke_uranus_bigtts', label: '深夜播客 2.0' },
  { value: 'zh_male_lubanqihao_uranus_bigtts', label: '鲁班七号 2.0' },
  { value: 'zh_female_jiaochuannv_uranus_bigtts', label: '娇喘女声 2.0' },
  { value: 'zh_female_linxiao_uranus_bigtts', label: '林潇 2.0' },
  { value: 'zh_female_lingling_uranus_bigtts', label: '玲玲姐姐 2.0' },
  { value: 'zh_female_chunribu_uranus_bigtts', label: '春日部姐姐 2.0' },
  { value: 'zh_male_tangseng_uranus_bigtts', label: '唐僧 2.0' },
  { value: 'zh_male_zhuangzhou_uranus_bigtts', label: '庄周 2.0' },
  { value: 'zh_male_kailangdidi_uranus_bigtts', label: '开朗弟弟 2.0' },
  { value: 'zh_male_zhubajie_uranus_bigtts', label: '猪八戒 2.0' },
  { value: 'zh_female_ganmaodianyin_uranus_bigtts', label: '感冒电音姐姐 2.0' },
  { value: 'zh_female_chanmeinv_uranus_bigtts', label: '谄媚女声 2.0' },
  { value: 'zh_female_nvleishen_uranus_bigtts', label: '女雷神 2.0' },
  { value: 'zh_female_qinqienv_uranus_bigtts', label: '亲切女声 2.0' },
  { value: 'zh_male_kuailexiaodong_uranus_bigtts', label: '快乐小东 2.0' },
  { value: 'zh_male_kailangxuezhang_uranus_bigtts', label: '开朗学长 2.0' },
  { value: 'zh_male_youyoujunzi_uranus_bigtts', label: '悠悠君子 2.0' },
  { value: 'zh_female_wenjingmaomao_uranus_bigtts', label: '文静毛毛 2.0' },
  { value: 'zh_female_zhixingnv_uranus_bigtts', label: '知性女声 2.0' },
  { value: 'zh_male_qingshuangnanda_uranus_bigtts', label: '清爽男大 2.0' },
  { value: 'zh_male_yuanboxiaoshu_uranus_bigtts', label: '渊博小叔 2.0' },
  { value: 'zh_male_yangguangqingnian_uranus_bigtts', label: '阳光青年 2.0' },
  { value: 'zh_female_qingchezizi_uranus_bigtts', label: '清澈梓梓 2.0' },
  { value: 'zh_female_tianmeiyueyue_uranus_bigtts', label: '甜美悦悦 2.0' },
  { value: 'zh_female_xinlingjitang_uranus_bigtts', label: '心灵鸡汤 2.0' },
  { value: 'zh_male_wenrouxiaoge_uranus_bigtts', label: '温柔小哥 2.0' },
  { value: 'zh_female_roumeinvyou_uranus_bigtts', label: '柔美女友 2.0' },
  { value: 'zh_male_dongfanghaoran_uranus_bigtts', label: '东方浩然 2.0' },
  { value: 'zh_female_wenrouxiaoya_uranus_bigtts', label: '温柔小雅 2.0' },
  { value: 'zh_male_tiancaitongsheng_uranus_bigtts', label: '天才童声 2.0' },
  { value: 'zh_female_wuzetian_uranus_bigtts', label: '武则天 2.0' },
  { value: 'zh_female_gujie_uranus_bigtts', label: '顾姐 2.0' },
  { value: 'zh_male_guanggaojieshuo_uranus_bigtts', label: '广告解说 2.0' },
  { value: 'zh_female_shaoergushi_uranus_bigtts', label: '少儿故事 2.0' },
]
