import { app, BrowserWindow, shell } from 'electron'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerProjectIpc } from './project-ipc.js'
import { registerRuleLibraryIpc } from './rule-library.js'
import { registerRuleTestCaseIpc } from './rule-test-cases.js'
import { registerSoundFontProtocol, registerSoundFontScheme } from './soundfont-resource.js'
import { installReactDevToolsIfAvailable } from './dev-extensions.js'
import { DESKTOP_CHANNELS, MAX_AUDIT_FILE_BYTES } from '../shared/desktop.js'
import { handleDesktop } from './typed-ipc.js'
import {
  loadSavedWindowState,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  trackWindowState,
} from './window-state.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const developmentServerUrl = process.argv.includes('--dev')
  ? 'http://localhost:5173'
  : undefined
const shouldOpenDevTools = process.argv.includes('--devtools')
const auditArgument = process.argv.indexOf('--audit-package')
const startupAuditPath = auditArgument < 0 ? undefined : process.argv[auditArgument + 1]
const e2eDirectory = process.env.SATB_MASTER_E2E_DIRECTORY

if (e2eDirectory) app.setPath('userData', path.join(e2eDirectory, 'user-data'))
registerSoundFontScheme()

function createWindow() {
  const windowState = loadSavedWindowState()
  const window = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    backgroundColor: '#f4f3ef',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: auditArgument < 0 ? [] : ['--satb-open-startup-audit'],
    },
  })

  trackWindowState(window)

  if (windowState.isMaximized) {
    window.maximize()
  }

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
  handleDesktop(DESKTOP_CHANNELS.auditReadStartupPackage, async () => {
    if (!startupAuditPath || !path.isAbsolute(startupAuditPath) || !startupAuditPath.toLowerCase().endsWith('.satb-audit.json')) {
      throw new Error('启动审计需要 .satb-audit.json 文件的绝对路径')
    }
    const file = await open(startupAuditPath, 'r').catch(() => { throw new Error('无法打开启动审计包，请确认文件存在且可读取') })
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error('启动审计包必须是普通文件')
      if (stat.size > MAX_AUDIT_FILE_BYTES) throw new Error('审计文件超过 32 MB，请拆成较小批次')
      const bytes = await file.readFile()
      if (bytes.length > MAX_AUDIT_FILE_BYTES) throw new Error('审计文件超过 32 MB，请拆成较小批次')
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
      catch { throw new Error('无法读取审计包，请使用 UTF-8 编码') }
    } finally { await file.close() }
  })
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
