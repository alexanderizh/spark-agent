import { clipboard } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { copyFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { showTrackedOpenDialog, showTrackedSaveDialog } from '../services/DialogPathMemory.js'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { readTextFileForRenderer } from './file-read.js'
import { typedIpcHandle } from './typed-ipc.js'

const MAX_CLIPBOARD_BYTES = 2 * 1024 * 1024
const execFileAsync = promisify(execFile)

async function resolveSource(filePath: string): Promise<string> {
  if (!path.isAbsolute(filePath)) throw new Error('需要本地文件的绝对路径')
  const source = await realpath(filePath)
  if (!isSafeFilePathAllowed(filePath) || (await realpath(filePath)) !== source) {
    throw new Error('文件不在允许操作的目录中，或路径已变化')
  }
  if (!(await stat(source)).isFile()) throw new Error('该路径不是普通文件')
  return source
}

function launch(command: string, args: string[], cwd?: string, detached = true): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached, stdio: 'ignore', shell: false })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function windowsSystemCommand(name: string): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name)
}

export function registerChatFileActionIpc(): void {
  typedIpcHandle('file:chat-action', async ({ filePath, action }) => {
    try {
      const source = await resolveSource(filePath)
      switch (action) {
        case 'copy-content': {
          const result = await readTextFileForRenderer({
            filePath: source,
            maxBytes: MAX_CLIPBOARD_BYTES,
            rejectBinary: true,
          })
          if (result.content == null) {
            throw new Error(
              result.errorCode === 'file-too-large'
                ? '只能复制 2 MB 以内的文本文件'
                : '无法复制非文本文件内容',
            )
          }
          clipboard.writeText(result.content)
          break
        }
        case 'save-as': {
          const result = await showTrackedSaveDialog({
            title: '另存为',
            defaultPath: path.basename(filePath),
          })
          if (result.canceled || !result.filePath) return { status: 'canceled' }
          const currentSource = await resolveSource(filePath)
          if (currentSource !== source) throw new Error('源文件路径已变化，请重试')
          const target = await stat(result.filePath).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') throw err
            return null
          })
          if (target != null) {
            const original = await stat(source)
            if (target.dev === original.dev && target.ino === original.ino) {
              throw new Error('请选择不同于源文件的保存位置')
            }
          }
          await copyFile(source, result.filePath)
          break
        }
        case 'open-terminal': {
          const cwd = path.dirname(source)
          if (process.platform === 'darwin')
            await execFileAsync('/usr/bin/open', ['-a', 'Terminal', cwd])
          else if (process.platform === 'win32') {
            // A detached Windows console process has no console to interact with.
            await launch(windowsSystemCommand('cmd.exe'), ['/d'], cwd, false)
          } else if (process.platform === 'linux') {
            await launch('x-terminal-emulator', [], cwd)
          } else throw new Error('当前系统不支持打开终端')
          break
        }
        case 'open-with': {
          if (process.platform === 'win32') {
            await launch(windowsSystemCommand('rundll32.exe'), [
              'shell32.dll,OpenAs_RunDLL',
              source,
            ])
          } else if (process.platform === 'darwin') {
            const selection = await showTrackedOpenDialog({
              title: '选择打开文件的应用',
              defaultPath: '/Applications',
              properties: ['openFile'],
              filters: [{ name: '应用程序', extensions: ['app'] }],
            })
            const selectedApp = selection.filePaths[0]
            if (selection.canceled || !selectedApp) return { status: 'canceled' }
            if (path.extname(selectedApp).toLowerCase() !== '.app')
              throw new Error('请选择应用程序')
            if ((await resolveSource(filePath)) !== source)
              throw new Error('源文件路径已变化，请重试')
            await execFileAsync('/usr/bin/open', ['-a', selectedApp, source])
          } else throw new Error('当前系统不支持选择打开方式')
          break
        }
      }
      return { status: 'done' }
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  })
}
