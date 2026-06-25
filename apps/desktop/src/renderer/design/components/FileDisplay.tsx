import type { ReactNode } from 'react'

import cssIcon from '../../assets/file-icons/css.svg'
import dockerIcon from '../../assets/file-icons/docker.svg'
import htmlIcon from '../../assets/file-icons/html.svg'
import javascriptIcon from '../../assets/file-icons/javascript.svg'
import jsonIcon from '../../assets/file-icons/json.svg'
import jsxIcon from '../../assets/file-icons/jsx.svg'
import lessIcon from '../../assets/file-icons/less.svg'
import markdownIcon from '../../assets/file-icons/markdown.svg'
import pythonIcon from '../../assets/file-icons/python.svg'
import reactIcon from '../../assets/file-icons/react.svg'
import sassIcon from '../../assets/file-icons/sass.svg'
import svelteIcon from '../../assets/file-icons/svelte.svg'
import typescriptIcon from '../../assets/file-icons/typescript.svg'
import vueIcon from '../../assets/file-icons/vue.svg'
import xmlIcon from '../../assets/file-icons/xml.svg'
import yamlIcon from '../../assets/file-icons/yaml.svg'

export type PreviewFileType = 'markdown' | 'html' | 'image' | 'text' | 'universal'

export type FileTypeTone =
  | 'code'
  | 'style'
  | 'script'
  | 'json'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'config'
  | 'default'

export type FileTypeBadge = {
  label: string
  tone: FileTypeTone
  icon?: string
  documentKind?: 'word' | 'excel' | 'powerpoint' | 'pdf'
}

function createInlineFileIcon(label: string, color: string): string {
  const text = label.slice(0, 4).toUpperCase()
  const fontSize = text.length >= 4 ? 16 : text.length === 3 ? 18 : 22
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="12" fill="${color}" opacity=".14"/><path d="M18 8h22l10 10v38H18z" fill="${color}"/><path d="M40 8v10h10z" fill="#fff" opacity=".42"/><text x="32" y="40" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${fontSize}" font-weight="800" fill="#fff">${text}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const inlineFileIcons = {
  ansible: createInlineFileIcon('ANS', '#1f2937'),
  astro: createInlineFileIcon('AST', '#ff5d01'),
  c: createInlineFileIcon('C', '#5c6bc0'),
  clojure: createInlineFileIcon('CLJ', '#5881d8'),
  cmake: createInlineFileIcon('CMAK', '#064f8c'),
  cpp: createInlineFileIcon('C++', '#00599c'),
  csharp: createInlineFileIcon('C#', '#68217a'),
  dart: createInlineFileIcon('DART', '#0175c2'),
  deno: createInlineFileIcon('DENO', '#111827'),
  elixir: createInlineFileIcon('EX', '#6e4a7e'),
  erlang: createInlineFileIcon('ERL', '#a90533'),
  fortran: createInlineFileIcon('FOR', '#734f96'),
  go: createInlineFileIcon('GO', '#00add8'),
  gradle: createInlineFileIcon('GRAD', '#02303a'),
  graphql: createInlineFileIcon('GQL', '#e10098'),
  groovy: createInlineFileIcon('GRVY', '#4298b8'),
  java: createInlineFileIcon('JAVA', '#e76f00'),
  kotlin: createInlineFileIcon('KT', '#7f52ff'),
  lua: createInlineFileIcon('LUA', '#2c2d72'),
  node: createInlineFileIcon('NODE', '#539e43'),
  npm: createInlineFileIcon('NPM', '#cb3837'),
  perl: createInlineFileIcon('PL', '#39457e'),
  php: createInlineFileIcon('PHP', '#777bb4'),
  powershell: createInlineFileIcon('PS1', '#0277bd'),
  prisma: createInlineFileIcon('PRIS', '#0c344b'),
  protobuf: createInlineFileIcon('PB', '#3b82f6'),
  r: createInlineFileIcon('R', '#276dc3'),
  ruby: createInlineFileIcon('RB', '#cc342d'),
  rust: createInlineFileIcon('RS', '#b7410e'),
  shell: createInlineFileIcon('SH', '#4eaa25'),
  sql: createInlineFileIcon('SQL', '#336791'),
  swift: createInlineFileIcon('SWFT', '#f05138'),
  terraform: createInlineFileIcon('TF', '#844fba'),
  zig: createInlineFileIcon('ZIG', '#f7a41d'),
} as const

export const FLYFISH_VIEWER_EXTENSIONS = new Set([
  '.docx',
  '.docm',
  '.dotx',
  '.dotm',
  '.doc',
  '.dot',
  '.pptx',
  '.pptm',
  '.potx',
  '.potm',
  '.ppsx',
  '.ppsm',
  '.rtf',
  '.odt',
  '.odp',
  '.xlsx',
  '.xltx',
  '.xlsm',
  '.xlsb',
  '.xls',
  '.xlt',
  '.xltm',
  '.csv',
  '.ods',
  '.fods',
  '.numbers',
  '.pdf',
  '.ofd',
  '.typ',
  '.typst',
  '.zip',
  '.zipx',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.gzip',
  '.tgz',
  '.bz2',
  '.bzip2',
  '.tbz',
  '.tbz2',
  '.xz',
  '.txz',
  '.lzma',
  '.zst',
  '.tzst',
  '.cab',
  '.ar',
  '.cpio',
  '.iso',
  '.xar',
  '.lha',
  '.lzh',
  '.jar',
  '.war',
  '.ear',
  '.apk',
  '.cbz',
  '.cbr',
  '.eml',
  '.msg',
  '.mbox',
  '.dxf',
  '.dwg',
  '.dwf',
  '.dwfx',
  '.xps',
  '.glb',
  '.gltf',
  '.obj',
  '.stl',
  '.ply',
  '.fbx',
  '.dae',
  '.3ds',
  '.3mf',
  '.amf',
  '.usd',
  '.usda',
  '.usdc',
  '.usdz',
  '.kmz',
  '.step',
  '.stp',
  '.iges',
  '.igs',
  '.ifc',
  '.3dm',
  '.pcd',
  '.wrl',
  '.vrml',
  '.xyz',
  '.vtk',
  '.vtp',
  '.geojson',
  '.kml',
  '.gpx',
  '.shp',
  '.excalidraw',
  '.drawio',
  '.dio',
  '.epub',
  '.umd',
  '.avif',
  '.heic',
  '.heif',
  '.jxl',
  '.mp4',
  '.webm',
  '.m3u8',
  '.mp3',
  '.mpeg',
  '.wav',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aac',
  '.flac',
  '.weba',
  '.midi',
  '.mid',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.psd',
  '.ai',
  '.eps',
  '.sqlite',
  '.wasm',
  '.parquet',
  '.avro',
  '.webarchive',
])

export const COMMON_FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.markdown',
  '.mdx',
  '.html',
  '.htm',
  '.css',
  '.less',
  '.scss',
  '.sass',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.hxx',
  '.cs',
  '.php',
  '.swift',
  '.dart',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.lua',
  '.scala',
  '.clj',
  '.cljs',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.fs',
  '.fsx',
  '.vb',
  '.pl',
  '.pm',
  '.r',
  '.jl',
  '.zig',
  '.graphql',
  '.gql',
  '.proto',
  '.prisma',
  '.tf',
  '.tfvars',
  '.gradle',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.tiff',
  '.tif',
  '.txt',
  '.text',
  '.log',
  '.xml',
  '.vue',
  '.svelte',
  ...FLYFISH_VIEWER_EXTENSIONS,
])

const FILE_TYPE_BY_EXTENSION: Record<string, FileTypeBadge> = {
  ts: { label: 'TS', tone: 'code', icon: typescriptIcon },
  tsx: { label: 'TSX', tone: 'code', icon: reactIcon },
  js: { label: 'JS', tone: 'script', icon: javascriptIcon },
  jsx: { label: 'JSX', tone: 'script', icon: jsxIcon },
  mjs: { label: 'MJS', tone: 'script', icon: javascriptIcon },
  cjs: { label: 'CJS', tone: 'script', icon: javascriptIcon },
  css: { label: 'CSS', tone: 'style', icon: cssIcon },
  less: { label: 'LESS', tone: 'style', icon: lessIcon },
  scss: { label: 'SCSS', tone: 'style', icon: sassIcon },
  sass: { label: 'SASS', tone: 'style', icon: sassIcon },
  html: { label: 'HTML', tone: 'script', icon: htmlIcon },
  vue: { label: 'VUE', tone: 'style', icon: vueIcon },
  svelte: { label: 'SVLT', tone: 'style', icon: svelteIcon },
  json: { label: 'JSON', tone: 'json', icon: jsonIcon },
  jsonl: { label: 'JSONL', tone: 'json', icon: jsonIcon },
  yaml: { label: 'YAML', tone: 'json', icon: yamlIcon },
  yml: { label: 'YML', tone: 'json', icon: yamlIcon },
  toml: { label: 'TOML', tone: 'config' },
  xml: { label: 'XML', tone: 'json', icon: xmlIcon },
  sql: { label: 'SQL', tone: 'code', icon: inlineFileIcons.sql },
  prisma: { label: 'PRIS', tone: 'code', icon: inlineFileIcons.prisma },
  graphql: { label: 'GQL', tone: 'code', icon: inlineFileIcons.graphql },
  gql: { label: 'GQL', tone: 'code', icon: inlineFileIcons.graphql },
  proto: { label: 'PB', tone: 'code', icon: inlineFileIcons.protobuf },
  md: { label: 'MD', tone: 'doc', icon: markdownIcon },
  mdx: { label: 'MDX', tone: 'doc', icon: markdownIcon },
  txt: { label: 'TXT', tone: 'doc' },
  doc: { label: 'DOC', tone: 'doc', documentKind: 'word' },
  docx: { label: 'DOCX', tone: 'doc', documentKind: 'word' },
  rtf: { label: 'RTF', tone: 'doc', documentKind: 'word' },
  xls: { label: 'XLS', tone: 'sheet', documentKind: 'excel' },
  xlsx: { label: 'XLSX', tone: 'sheet', documentKind: 'excel' },
  csv: { label: 'CSV', tone: 'sheet', documentKind: 'excel' },
  numbers: { label: 'NUM', tone: 'sheet', documentKind: 'excel' },
  ppt: { label: 'PPT', tone: 'slides', documentKind: 'powerpoint' },
  pptx: { label: 'PPTX', tone: 'slides', documentKind: 'powerpoint' },
  key: { label: 'KEY', tone: 'slides', documentKind: 'powerpoint' },
  pdf: { label: 'PDF', tone: 'pdf', documentKind: 'pdf' },
  png: { label: 'PNG', tone: 'image' },
  jpg: { label: 'JPG', tone: 'image' },
  jpeg: { label: 'JPEG', tone: 'image' },
  gif: { label: 'GIF', tone: 'image' },
  webp: { label: 'WEBP', tone: 'image' },
  svg: { label: 'SVG', tone: 'image' },
  mp4: { label: 'MP4', tone: 'video' },
  mov: { label: 'MOV', tone: 'video' },
  avi: { label: 'AVI', tone: 'video' },
  webm: { label: 'WEBM', tone: 'video' },
  mp3: { label: 'MP3', tone: 'audio' },
  wav: { label: 'WAV', tone: 'audio' },
  flac: { label: 'FLAC', tone: 'audio' },
  zip: { label: 'ZIP', tone: 'archive' },
  rar: { label: 'RAR', tone: 'archive' },
  '7z': { label: '7Z', tone: 'archive' },
  tar: { label: 'TAR', tone: 'archive' },
  gz: { label: 'GZ', tone: 'archive' },
  lock: { label: 'LOCK', tone: 'config' },
  env: { label: 'ENV', tone: 'config' },
  py: { label: 'PY', tone: 'script', icon: pythonIcon },
  rb: { label: 'RB', tone: 'script', icon: inlineFileIcons.ruby },
  go: { label: 'GO', tone: 'code', icon: inlineFileIcons.go },
  rs: { label: 'RS', tone: 'code', icon: inlineFileIcons.rust },
  java: { label: 'JAVA', tone: 'code', icon: inlineFileIcons.java },
  kt: { label: 'KT', tone: 'code', icon: inlineFileIcons.kotlin },
  kts: { label: 'KTS', tone: 'code', icon: inlineFileIcons.kotlin },
  c: { label: 'C', tone: 'code', icon: inlineFileIcons.c },
  h: { label: 'H', tone: 'code', icon: inlineFileIcons.c },
  cpp: { label: 'C++', tone: 'code', icon: inlineFileIcons.cpp },
  cc: { label: 'C++', tone: 'code', icon: inlineFileIcons.cpp },
  cxx: { label: 'C++', tone: 'code', icon: inlineFileIcons.cpp },
  hpp: { label: 'H++', tone: 'code', icon: inlineFileIcons.cpp },
  hxx: { label: 'H++', tone: 'code', icon: inlineFileIcons.cpp },
  cs: { label: 'C#', tone: 'code', icon: inlineFileIcons.csharp },
  php: { label: 'PHP', tone: 'script', icon: inlineFileIcons.php },
  swift: { label: 'SWFT', tone: 'code', icon: inlineFileIcons.swift },
  dart: { label: 'DART', tone: 'code', icon: inlineFileIcons.dart },
  sh: { label: 'SH', tone: 'script', icon: inlineFileIcons.shell },
  bash: { label: 'BASH', tone: 'script', icon: inlineFileIcons.shell },
  zsh: { label: 'ZSH', tone: 'script', icon: inlineFileIcons.shell },
  fish: { label: 'FISH', tone: 'script', icon: inlineFileIcons.shell },
  ps1: { label: 'PS1', tone: 'script', icon: inlineFileIcons.powershell },
  lua: { label: 'LUA', tone: 'script', icon: inlineFileIcons.lua },
  scala: { label: 'SCA', tone: 'code', icon: inlineFileIcons.java },
  clj: { label: 'CLJ', tone: 'code', icon: inlineFileIcons.clojure },
  cljs: { label: 'CLJS', tone: 'code', icon: inlineFileIcons.clojure },
  ex: { label: 'EX', tone: 'code', icon: inlineFileIcons.elixir },
  exs: { label: 'EXS', tone: 'code', icon: inlineFileIcons.elixir },
  erl: { label: 'ERL', tone: 'code', icon: inlineFileIcons.erlang },
  hrl: { label: 'HRL', tone: 'code', icon: inlineFileIcons.erlang },
  fs: { label: 'FS', tone: 'code', icon: inlineFileIcons.fortran },
  fsx: { label: 'FSX', tone: 'code', icon: inlineFileIcons.fortran },
  fsproj: { label: 'FSP', tone: 'config' },
  vb: { label: 'VB', tone: 'code' },
  pl: { label: 'PL', tone: 'script', icon: inlineFileIcons.perl },
  pm: { label: 'PM', tone: 'script', icon: inlineFileIcons.perl },
  r: { label: 'R', tone: 'code', icon: inlineFileIcons.r },
  jl: { label: 'JL', tone: 'code' },
  zig: { label: 'ZIG', tone: 'code', icon: inlineFileIcons.zig },
  tf: { label: 'TF', tone: 'config', icon: inlineFileIcons.terraform },
  tfvars: { label: 'TF', tone: 'config', icon: inlineFileIcons.terraform },
  gradle: { label: 'GRAD', tone: 'config', icon: inlineFileIcons.gradle },
  ini: { label: 'INI', tone: 'config' },
  conf: { label: 'CONF', tone: 'config' },
  config: { label: 'CONF', tone: 'config' },
  properties: { label: 'PROP', tone: 'config' },
  gitignore: { label: 'GIT', tone: 'config' },
  dockerignore: { label: 'DOCK', tone: 'config', icon: dockerIcon },
}

const FILE_TYPE_BY_NAME: Record<string, FileTypeBadge> = {
  dockerfile: { label: 'DOCK', tone: 'config', icon: dockerIcon },
  'compose.yaml': { label: 'DOCK', tone: 'config', icon: dockerIcon },
  'compose.yml': { label: 'DOCK', tone: 'config', icon: dockerIcon },
  'docker-compose.yaml': { label: 'DOCK', tone: 'config', icon: dockerIcon },
  'docker-compose.yml': { label: 'DOCK', tone: 'config', icon: dockerIcon },
  makefile: { label: 'MAKE', tone: 'config' },
  'cmakelists.txt': { label: 'CMAK', tone: 'config', icon: inlineFileIcons.cmake },
  'package.json': { label: 'NPM', tone: 'config', icon: inlineFileIcons.npm },
  'package-lock.json': { label: 'NPM', tone: 'config', icon: inlineFileIcons.npm },
  'pnpm-lock.yaml': { label: 'LOCK', tone: 'config' },
  'yarn.lock': { label: 'LOCK', tone: 'config' },
  'bun.lockb': { label: 'BUN', tone: 'config' },
  'deno.json': { label: 'DENO', tone: 'config', icon: inlineFileIcons.deno },
  'deno.lock': { label: 'DENO', tone: 'config', icon: inlineFileIcons.deno },
  'tsconfig.json': { label: 'TS', tone: 'config', icon: typescriptIcon },
  'jsconfig.json': { label: 'JS', tone: 'config', icon: javascriptIcon },
  'vite.config.ts': { label: 'VITE', tone: 'config' },
  'vite.config.js': { label: 'VITE', tone: 'config' },
  'astro.config.mjs': { label: 'AST', tone: 'config', icon: inlineFileIcons.astro },
  'tailwind.config.js': { label: 'TW', tone: 'config' },
  'tailwind.config.ts': { label: 'TW', tone: 'config' },
  '.editorconfig': { label: 'EDIT', tone: 'config' },
  '.env': { label: 'ENV', tone: 'config' },
  '.gitignore': { label: 'GIT', tone: 'config' },
  'ansible.cfg': { label: 'ANS', tone: 'config', icon: inlineFileIcons.ansible },
  license: { label: 'LIC', tone: 'doc' },
}

export function getFileExtension(filePath: string): string {
  const clean = stripTrailingFilePunctuation(filePath)
  const fileName = clean.split(/[\\/]/).pop() ?? clean
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot < 0) return ''
  return fileName.slice(lastDot)
}

export function getPreviewFileType(filePath: string): PreviewFileType | null {
  const ext = getFileExtension(filePath).toLowerCase()
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown'
  // HTML 文件不再走应用内预览，统一交给 OS 默认浏览器打开（file:open → shell.openPath）。
  // 详见各调用点的「不可预览 → 用默认应用打开」回退分支。
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) {
    return 'image'
  }
  if (ext === '.txt' || ext === '.text' || ext === '.log') return 'text'
  if (FLYFISH_VIEWER_EXTENSIONS.has(ext)) return 'universal'
  return null
}

export function getFileTypeBadge(filePath: string): FileTypeBadge {
  const fileName = normalizeFileReference(filePath).split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const exact = FILE_TYPE_BY_NAME[fileName]
  if (exact != null) return exact
  if (fileName.endsWith('.d.ts')) return { label: 'D.TS', tone: 'code', icon: typescriptIcon }

  const ext = fileName.includes('.') ? fileName.split('.').pop() : undefined
  if (ext == null || ext.length === 0) return { label: 'FILE', tone: 'default' }

  return FILE_TYPE_BY_EXTENSION[ext] ?? { label: ext.slice(0, 4).toUpperCase(), tone: 'default' }
}

export function isFileUrl(value: string): boolean {
  return /^file:\/\//i.test(value.trim())
}

export function decodeFileUrl(value: string): string | null {
  if (!isFileUrl(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    return decodeURIComponent(url.pathname)
  } catch {
    return null
  }
}

export function normalizeFileReference(value: string): string {
  const trimmed = stripTrailingFilePunctuation(value.trim())
  return decodeFileUrl(trimmed) ?? trimmed
}

export function isLocalFileReference(value: string): boolean {
  const normalized = normalizeFileReference(value)
  return (
    normalized.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    /^[.]{1,2}[\\/]/.test(normalized)
  )
}

export function isPreviewableFileReference(value: string): boolean {
  return getPreviewFileType(normalizeFileReference(value)) != null
}

export function stripTrailingFilePunctuation(value: string): string {
  return value.replace(/[)\]>}！？，。；：、,.;:!?]+$/u, '')
}

export function FileTypeIcon({
  filePath,
  className,
  size = 18,
}: {
  filePath: string
  className?: string
  size?: number
}): ReactNode {
  const type = getFileTypeBadge(filePath)
  if (type.icon) {
    return (
      <img
        className={className}
        src={type.icon}
        alt=""
        aria-hidden="true"
        style={{ width: size, height: size }}
      />
    )
  }
  if (type.documentKind != null) {
    return (
      <span
        className={`document-file-icon document-file-icon--${type.documentKind} ${className ?? ''}`}
      >
        {type.label}
      </span>
    )
  }
  return (
    <span
      className={`file-type-text-tag file-type-text-tag--${type.tone} ${className ?? ''}`}
      style={{ minWidth: Math.max(size + 10, Math.min(42, type.label.length * 8 + 10)) }}
    >
      {type.label}
    </span>
  )
}
