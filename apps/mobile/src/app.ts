import { bootstrap } from './store/auth'
import { reconcileImageCache } from './api/image-cache'
import { initTheme } from './utils/theme'

App({
  onLaunch() {
    initTheme()
    // 启动时校验本地 token；失败会自动清理并跳登录页
    void bootstrap()
    // 图片缓存目录对账（清孤儿索引/孤儿文件；系统清理缓存目录后的自愈）
    reconcileImageCache()
  },
  onShow() {
    // 回前台时重新解析系统主题；固定浅色/深色时仅校正原生窗口
    initTheme()
  },
  // 全局状态（页面经 getApp() 读取；响应式更新走 store/auth 的事件订阅）
  globalData: {
    appName: 'SparkWork',
  },
})
