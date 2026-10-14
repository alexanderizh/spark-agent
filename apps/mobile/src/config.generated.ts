/**
 * 运行时配置 —— 由 scripts/build.mjs 在构建期生成，请勿手工修改。
 *
 * 为什么是 .ts 而不是 .json：
 *   小程序不支持 require('./config.json') —— 它的 require 会自动补 .js 后缀，
 *   去找 config.json.js，于是报
 *   "module 'config.json.js' is not defined, require args is './config.json'"。
 *   所以构建期把配置写成 TS 模块，编译成 require('./config.generated') 才可用。
 *
 * 覆盖方式：SPARK_EDUGEN_BASE_URL=http://192.168.x.x:7001 node scripts/build.mjs
 */

export const RUNTIME_CONFIG = {
  "baseUrl": "https://www.yiqibyte.com",
  "apiPrefix": "/api/v1"
} as const
