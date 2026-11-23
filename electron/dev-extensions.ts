import { session } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { logMain } from './logger.js'

const REACT_DEVTOOLS_EXTENSION_ID = 'fmkadmapgofadopljbjfkapdkoienihi'

export function getBrowserUserDataDirectories(): string[] {
  const home = os.homedir()
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    return [
      path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    ]
  }
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
      path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
    ]
  }
  return [
    path.join(home, '.config', 'google-chrome'),
    path.join(home, '.config', 'chromium'),
    path.join(home, '.config', 'microsoft-edge'),
    path.join(home, '.config', 'BraveSoftware', 'Brave-Browser'),
  ]
}

export async function findReactDevToolsPath(): Promise<string | undefined> {
  const userDataDirs = getBrowserUserDataDirectories()

  for (const baseDir of userDataDirs) {
    try {
      const entries = await readdir(baseDir, { withFileTypes: true })
      const profileDirs = entries
        .filter((entry) => entry.isDirectory() && (entry.name === 'Default' || entry.name.startsWith('Profile ')))
        .map((entry) => path.join(baseDir, entry.name, 'Extensions', REACT_DEVTOOLS_EXTENSION_ID))

      for (const extensionDir of profileDirs) {
        try {
          const versions = await readdir(extensionDir, { withFileTypes: true })
          const versionDirs = versions
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

          for (const version of versionDirs) {
            const candidatePath = path.join(extensionDir, version)
            const manifestPath = path.join(candidatePath, 'manifest.json')
            try {
              const manifestStat = await stat(manifestPath)
              if (manifestStat.isFile()) {
                return candidatePath
              }
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                logMain('warn', 'app', '读取 React DevTools 扩展清单失败', { code: 'FILE_READ_FAILED', error })
              }
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logMain('warn', 'app', '读取 React DevTools 扩展目录失败', { code: 'FILE_READ_FAILED', error })
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logMain('warn', 'app', '读取浏览器配置目录失败', { code: 'FILE_READ_FAILED', error })
      }
    }
  }

  return undefined
}

export async function installReactDevToolsIfAvailable(): Promise<boolean> {
  try {
    const extensionPath = await findReactDevToolsPath()
    if (!extensionPath) {
      logMain('info', 'app', '未在本地 Chrome/Edge 找到已安装的 React 调试插件')
      return false
    }
    await session.defaultSession.loadExtension(extensionPath, {
      allowFileAccess: true,
    })
    logMain('info', 'app', '已加载 React DevTools', { context: { extensionPath } })
    return true
  } catch (error) {
    logMain('warn', 'app', 'React DevTools 加载失败', { code: 'UNKNOWN', error })
    return false
  }
}
