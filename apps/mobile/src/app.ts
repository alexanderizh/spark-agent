import { bootstrap } from './store/auth'

App({
  onLaunch() {
    // 启动时校验本地 token；失败会自动清理并跳登录页
    void bootstrap()
  },
  // 全局状态（页面经 getApp() 读取；响应式更新走 store/auth 的事件订阅）
  globalData: {
    appName: 'SparkWork',
  },
})
