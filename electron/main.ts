import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerProjectIpc } from './project-ipc.js'
import { registerRuleLibraryIpc } from './rule-library.js'
import { registerRuleTestCaseIpc } from './rule-test-cases.js'
import { registerSoundFontProtocol, registerSoundFontScheme } from './soundfont-resource.js'
import { installReactDevToolsIfAvailable } from './dev-extensions.js'
import { DESKTOP_CHANNELS } from '../shared/desktop.js'
import { handleDesktop } from './typed-ipc.js'

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
  window.on('maximize', () => window.webContents.send(DESKTOP_CHANNELS.windowMaximizedChanged, true))
  window.on('unmaximize', () => window.webContents.send(DESKTOP_CHANNELS.windowMaximizedChanged, false))

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
    void window.loadFile(path.join(currentDirectory, '../../dist/index.html'))
  }
}

function registerWindowIpc() {
  const senderWindow = (event: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender)
  handleDesktop(DESKTOP_CHANNELS.windowMinimize, (event) => senderWindow(event)?.minimize())
  handleDesktop(DESKTOP_CHANNELS.windowToggleMaximize, (event) => {
    const window = senderWindow(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  handleDesktop(DESKTOP_CHANNELS.windowIsMaximized, (event) => senderWindow(event)?.isMaximized() ?? false)
  handleDesktop(DESKTOP_CHANNELS.windowIsFocused, (event) => senderWindow(event)?.isFocused() ?? false)
  handleDesktop(DESKTOP_CHANNELS.windowClose, (event) => senderWindow(event)?.close())
}

app.whenReady().then(async () => {
  if (developmentServerUrl || shouldOpenDevTools) {
    await installReactDevToolsIfAvailable()
  }
  registerSoundFontProtocol()
  registerProjectIpc()
  registerRuleTestCaseIpc()
  registerRuleLibraryIpc()
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
