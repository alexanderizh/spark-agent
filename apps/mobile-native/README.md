# SparkWork 原生移动端样机

React Native 0.85.3 + Expo SDK 56，使用原生控件，沿用小程序的账号 API 和远程中继。首期只覆盖「账号密码与图形验证码 → 在线电脑 → 已有会话 → 最近历史与文字流式回复」。样机不保存登录凭据，重启后重新登录；不涵盖短信、邮箱验证码、微信登录、会话新建、附件、审批、历史翻页和完整离线补偿。

## 本地构建

此目录使用独立的 npm 锁文件，与桌面项目的 React 版本及 pnpm 锁文件隔离。需 Node.js 22.13+。`android/` 和 `ios/` 由固定版本的模板生成，不提交生成结果；不依赖云打包。

```sh
cd apps/mobile-native
npm ci
npm run typecheck
npm test
npm run bundle
npm run prebuild
```

`bundle` 产出双端 JavaScript 字节码，不是安装包。调试和发布构建在补齐平台工具后执行：

- Android：配置 JDK 17 与本机 Android SDK，`npm run android -- --device` 安装到调试设备。若要脱离 Metro 验证，生成原生目录后，在 `android/` 执行 `./gradlew :app:assembleRelease`；默认模板的签名不用于对外分发，正式内测须配置独立签名。
- iOS：安装完整 Xcode 和 CocoaPods，连接测试设备，`npm run ios -- --device` 调试。脱离 Metro 验证需在 Xcode 选择开发团队和已配置签名的设备，构建 Release；分发时用 Archive 后按渠道导出 IPA 或上传 TestFlight。
- 两端包标识 `com.sparkagent.companion.prototype` 仅为样机临时值；上架标识与签名未冻结。不要将签名配置或凭据提交到仓库。

## 真机验收

1. 两端分别安装 Release 样机，关闭 Metro 后仍能启动。使用桌面同一测试账号登录；桌面端需开启移动接入并连接云中继。
2. 选择在线电脑，打开有历史的会话，确认历史与桌面一致。提交一条测试消息，确认桌面只收到一条、手机能看到增量和最终回复。
3. 生成回复时断网或切至后台，再恢复前台。确认同一会话重新订阅、重新拉取最近历史，并且不重复显示最终回复。专门验证已提交但未收到回执的情形不会自动重发。
4. 切到另一台电脑及同名会话，确认事件不串流；退出后验证旧连接关闭。样机未完成签名、双端真机和真实账号验收前，不进入批量迁页。
