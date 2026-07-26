import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerProjectIpc } from './project-ipc.js'
import { registerSoundFontProtocol, registerSoundFontScheme } from './soundfont-resource.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const developmentServerUrl = process.argv.includes('--dev')
  ? 'http://localhost:5173'
  : undefined
const shouldOpenDevTools = process.argv.includes('--devtools')
const e2eDirectory = process.env.SATB_MASTER_E2E_DIRECTORY

if (e2eDirectory) app.setPath('userData', path.join(e2eDirectory, 'user-data'))
registerSoundFontScheme()

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f4f3ef',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => {
    // Windows 必须先完成无边框窗口的原生激活，再把输入焦点交给网页。
    // 若在 show() 的同一调用栈里强制聚焦，Chromium 的原生下拉菜单会吞掉首次点击。
    window.once('focus', () => {
      setImmediate(() => {
        if (!window.isDestroyed() && window.isFocused()) window.webContents.focus()
      })
    })
    window.show()
  })
  window.on('maximize', () => window.webContents.send('window:maximized-changed', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized-changed', false))

  window.webContents.setWindowOpenHandler(({ url }) => {
    const protocol = new URL(url).protocol
    if (protocol === 'https:' || protocol === 'http:') {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (developmentServerUrl) {
    void window.loadURL(developmentServerUrl)
    if (shouldOpenDevTools) {
      window.webContents.openDevTools({ mode: 'detach', activate: false })
    }
  } else {
    void window.loadFile(path.join(currentDirectory, '../dist/index.html'))
  }
}

function registerWindowIpc() {
  const senderWindow = (event: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender)
  ipcMain.handle('window:minimize', (event) => senderWindow(event)?.minimize())
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = senderWindow(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle('window:is-maximized', (event) => senderWindow(event)?.isMaximized() ?? false)
  ipcMain.handle('window:is-focused', (event) => senderWindow(event)?.isFocused() ?? false)
  ipcMain.handle('window:close', (event) => senderWindow(event)?.close())
}

app.whenReady().then(() => {
  registerSoundFontProtocol()
  registerProjectIpc()
  registerWindowIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
