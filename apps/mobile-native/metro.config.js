const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
// The native app shares platform-independent behavior and navigation assets with the mini-program.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, '../mobile/src/utils'),
  path.resolve(__dirname, '../mobile/src/assets/tabbar'),
  path.resolve(__dirname, '../mobile/src/assets/brand'),
]

module.exports = config
