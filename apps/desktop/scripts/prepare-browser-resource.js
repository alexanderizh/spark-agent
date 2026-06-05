#!/usr/bin/env node
/**
 * prepare-browser-resource.js — Ensure electron-builder's optional browser
 * resource directory exists without downloading Chromium.
 *
 * Build scripts call this before electron-builder because electron-builder's
 * `extraResources.from: browsers` expects the source directory to exist. If
 * `pnpm download-browser` was run beforehand, the downloaded browser is bundled;
 * otherwise an empty directory is packaged and runtime falls back to system
 * Chrome/Edge or Playwright's default cache.
 */
const fs = require('node:fs')
const path = require('node:path')

const browsersDir = path.resolve(__dirname, '..', 'browsers')

fs.mkdirSync(browsersDir, { recursive: true })

