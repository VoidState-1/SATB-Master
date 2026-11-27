import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chooseProjectFile, readProjectFile, registerProjectIpc, rememberProjectFile } from './project-ipc.js'
import { registerRuleLibraryIpc } from './rule-library.js'
import { registerRuleTestCaseIpc } from './rule-test-cases.js'
import { registerSoundFontProtocol, registerSoundFontScheme } from './soundfont-resource.js'
import { installReactDevToolsIfAvailable } from './dev-extensions.js'
import { DESKTOP_CHANNELS, DESKTOP_TEXT_EDIT_COMMANDS, LOG_SESSION_ARGUMENT, MAX_AUDIT_FILE_BYTES, type DesktopInvokeChannel, type DesktopMenuCommand, type ExternalProjectOpenPayload } from '../shared/desktop.js'
import { type AppErrorCode, type LogScope } from '../shared/logging.js'
import { createMainLogEntry, initializeMainLogger, logMain, registerLoggingIpc } from './logger.js'
import { extractProjectFilePathFromArgv } from './startup-project.js'
import { handleDesktop, setDesktopIpcReporter } from './typed-ipc.js'
import { installMacApplicationMenu } from './application-menu.js'
import {
  loadSavedWindowState,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  trackWindowState,
} from './window-state.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const isMac = process.platform === 'darwin'
const developmentServerUrl = process.argv.includes('--dev')
  ? 'http://localhost:5173'
  : undefined
const shouldOpenDevTools = process.argv.includes('--devtools')
const auditArgument = process.argv.indexOf('--audit-package')
const startupAuditPath = auditArgument < 0 ? undefined : process.argv[auditArgument + 1]
const e2eDirectory = process.env.SATB_MASTER_E2E_DIRECTORY
const startupProjectPath = auditArgument < 0 ? extractProjectFilePathFromArgv(process.argv) : undefined
const pendingExternalProjectPaths = startupProjectPath ? [startupProjectPath] : []
let mainWindow: BrowserWindow | undefined
let applicationInitialized = false
let rendererAcceptsExternalProjects = false
let windowWithCloseHandler: BrowserWindow | undefined
let pendingSettings = false
let externalProjectQueue = Promise.resolve()

if (isMac) {
  // Finder can deliver this before ready, including when a file is dropped onto the Dock.
  app.on('open-file', (event, filePath) => {
    if (!isAbsoluteProjectPath(filePath)) return
    event.preventDefault()
    enqueueExternalProject(filePath)
  })
  app.on('before-quit', (event) => {
    if (requestNativeClose(true)) event.preventDefault()
  })
}

if (e2eDirectory) app.setPath('userData', path.join(e2eDirectory, 'user-data'))
const logger = initializeMainLogger(path.join(app.getPath('userData'), 'logs'))
const sessionId = randomUUID()

process.on('uncaughtException', (error, origin) => {
  try {
    logger.appendSync(createMainLogEntry('fatal', 'app', '主进程发生未捕获异常', {
      code: 'UNCAUGHT_EXCEPTION',
      error,
      context: { origin },
    }))
  } finally {
    process.exit(1)
  }
})

process.on('unhandledRejection', (reason) => {
  logger.appendSync(createMainLogEntry('fatal', 'app', '主进程存在未处理的 Promise 拒绝', {
    code: 'UNHANDLED_REJECTION',
    error: reason,
  }))
})

app.on('render-process-gone', (_event, webContents, details) => {
  if (details.reason === 'clean-exit') return
  logger.appendSync(createMainLogEntry('fatal', 'app', '渲染进程异常退出', {
    code: 'RENDER_CRASH',
    context: { ...details, webContentsId: webContents.id },
  }))
})

app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return
  logger.appendSync(createMainLogEntry('fatal', 'app', 'Electron 子进程异常退出', {
    context: { ...details },
  }))
})

const ipcFailures: Partial<Record<DesktopInvokeChannel, [LogScope, AppErrorCode, string]>> = {
  [DESKTOP_CHANNELS.projectOpen]: ['file', 'FILE_READ_FAILED', '打开工程失败'],
  [DESKTOP_CHANNELS.projectConsumePendingOpen]: ['file', 'FILE_READ_FAILED', '读取待打开的外部工程失败'],
  [DESKTOP_CHANNELS.projectSave]: ['file', 'FILE_WRITE_FAILED', '保存工程失败'],
  [DESKTOP_CHANNELS.projectExportBackup]: ['file', 'RECOVERY_FAILED', '紧急备份导出失败'],
  [DESKTOP_CHANNELS.projectAutosave]: ['file', 'RECOVERY_FAILED', '自动恢复保存失败'],
  [DESKTOP_CHANNELS.projectRecovery]: ['file', 'RECOVERY_FAILED', '读取自动恢复失败'],
  [DESKTOP_CHANNELS.projectDiscardRecovery]: ['file', 'RECOVERY_FAILED', '清除自动恢复失败'],
  [DESKTOP_CHANNELS.midiImport]: ['file', 'FILE_READ_FAILED', '读取 MIDI 文件失败'],
  [DESKTOP_CHANNELS.midiExport]: ['file', 'FILE_WRITE_FAILED', '导出 MIDI 失败'],
  [DESKTOP_CHANNELS.musicXmlExport]: ['file', 'FILE_WRITE_FAILED', '导出 MusicXML 失败'],
  [DESKTOP_CHANNELS.ruleLibraryList]: ['external-rule', 'EXTERNAL_RULE_FAILED', '读取外置规则库失败'],
  [DESKTOP_CHANNELS.ruleLibraryImport]: ['external-rule', 'EXTERNAL_RULE_FAILED', '读取外置规则包失败'],
  [DESKTOP_CHANNELS.ruleLibraryInstall]: ['external-rule', 'EXTERNAL_RULE_FAILED', '安装外置规则包失败'],
  [DESKTOP_CHANNELS.ruleLibraryLoadSource]: ['external-rule', 'EXTERNAL_RULE_FAILED', '读取外置规则源码失败'],
  [DESKTOP_CHANNELS.ruleLibraryRemove]: ['external-rule', 'EXTERNAL_RULE_FAILED', '移除外置规则包失败'],
}

setDesktopIpcReporter((level, context, error) => {
  if (level === 'warn') {
    logMain(level, 'ipc', 'IPC 调用耗时过长', { context })
    return
  }
  const [scope, code, message] = ipcFailures[context.channel] ?? ['ipc', 'IPC_FAILED', 'IPC 调用失败']
  logMain(level, scope, message, { code, error, context })
})

registerLoggingIpc(logger)
logMain('info', 'app', 'SATB Master 启动', {
  context: {
    sessionId,
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node,
  },
})
registerSoundFontScheme()

async function loadExternalProject(filePath: string): Promise<ExternalProjectOpenPayload> {
  const result = await readProjectFile(filePath)
  if ('project' in result) await rememberProjectFile(filePath)
  logMain('info', 'file', '已处理外部工程打开请求', {
    context: { valid: 'project' in result },
  })
  return { filePath, ...result }
}

function queueExternalProjectOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = externalProjectQueue.then(operation)
  externalProjectQueue = result.then(() => undefined, () => undefined)
  return result
}

function sendPendingExternalProjects() {
  void queueExternalProjectOperation(async () => {
    while (pendingExternalProjectPaths.length > 0) {
      const window = mainWindow
      if (!window || !rendererAcceptsExternalProjects || window.webContents.isLoadingMainFrame()) return
      const payload = await loadExternalProject(pendingExternalProjectPaths[0])
      // 读取期间窗口可能关闭或重载，保留路径供下一次拉取。
      if (mainWindow !== window || !rendererAcceptsExternalProjects || window.webContents.isLoadingMainFrame()) return
      window.webContents.send(DESKTOP_CHANNELS.projectOpenExternal, payload)
      pendingExternalProjectPaths.shift()
    }
  }).catch((error) => {
    logMain('error', 'file', '转发外部工程失败', { code: 'FILE_READ_FAILED', error })
  })
}

function isAbsoluteProjectPath(filePath: unknown): filePath is string {
  return typeof filePath === 'string' && path.isAbsolute(filePath) && path.extname(filePath).toLowerCase() === '.satb'
}

function showMainWindow() {
  if (!applicationInitialized) return
  const window = mainWindow
  if (!window) {
    createWindow()
    return
  }
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  if (window.isVisible()) window.focus()
}

function enqueueExternalProject(filePath: string) {
  pendingExternalProjectPaths.push(filePath)
  showMainWindow()
  sendPendingExternalProjects()
}

function onSecondInstance(_event: Electron.Event, commandLine: string[], workingDirectory: string) {
  const filePath = extractProjectFilePathFromArgv(commandLine, workingDirectory)
  if (filePath) enqueueExternalProject(filePath)
  else showMainWindow()
}

function requestNativeClose(quit: boolean) {
  const window = mainWindow
  if (!window || window !== windowWithCloseHandler || window.isDestroyed()) return false
  showMainWindow()
  window.webContents.send(DESKTOP_CHANNELS.windowCloseRequested, quit)
  return true
}

async function dispatchMacMenuCommand(command: DesktopMenuCommand) {
  if (mainWindow && rendererAcceptsExternalProjects) {
    mainWindow.webContents.send(DESKTOP_CHANNELS.menuCommand, command)
  } else if (command === 'openProject') {
    const filePath = await chooseProjectFile(mainWindow)
    if (filePath) enqueueExternalProject(filePath)
  } else if (command === 'newProject' || command === 'settings') {
    if (command === 'settings') pendingSettings = true
    showMainWindow()
  }
}

function createWindow() {
  const windowState = loadSavedWindowState()
  const window = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171a17' : '#ecece8',
    show: false,
    ...(isMac
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 14, y: 13 } }
      : { frame: false, autoHideMenuBar: true }),
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        LOG_SESSION_ARGUMENT + sessionId,
        ...(auditArgument < 0 ? [] : ['--satb-open-startup-audit']),
      ],
    },
  })

  mainWindow = window
  if (isMac) {
    window.on('close', (event) => {
      if (requestNativeClose(false)) event.preventDefault()
    })
  }
  window.on('closed', () => {
    mainWindow = undefined
    rendererAcceptsExternalProjects = false
    windowWithCloseHandler = undefined
  })
  const resetRendererState = () => {
    rendererAcceptsExternalProjects = false
    windowWithCloseHandler = undefined
  }
  window.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) resetRendererState()
  })
  window.webContents.on('render-process-gone', resetRendererState)
  window.webContents.on('did-finish-load', sendPendingExternalProjects)

  trackWindowState(window)

  if (windowState.isMaximized) {
    window.maximize()
  }

  window.once('ready-to-show', () => {
    // Windows 必须先完成无边框窗口的原生激活，再把输入焦点交给网页。
    // 若在 show() 的同一调用栈里强制聚焦，Chromium 的原生下拉菜单会吞掉首次点击。
    if (!isMac) {
      window.once('focus', () => {
        setImmediate(() => {
          if (!window.isDestroyed() && window.isFocused()) window.webContents.focus()
        })
      })
    }
    window.show()
  })
  window.on('enter-full-screen', () => window.webContents.send(DESKTOP_CHANNELS.windowFullScreenChanged, true))
  window.on('leave-full-screen', () => window.webContents.send(DESKTOP_CHANNELS.windowFullScreenChanged, false))
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
  const senderMainWindow = (event: Electron.IpcMainInvokeEvent) =>
    event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame ? mainWindow : undefined
  handleDesktop(DESKTOP_CHANNELS.windowMinimize, (event) => senderWindow(event)?.minimize())
  handleDesktop(DESKTOP_CHANNELS.windowToggleMaximize, (event) => {
    const window = senderWindow(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  handleDesktop(DESKTOP_CHANNELS.windowIsMaximized, (event) => senderWindow(event)?.isMaximized() ?? false)
  handleDesktop(DESKTOP_CHANNELS.windowIsFullScreen, (event) => senderWindow(event)?.isFullScreen() ?? false)
  handleDesktop(DESKTOP_CHANNELS.windowIsFocused, (event) => senderWindow(event)?.isFocused() ?? false)
  handleDesktop(DESKTOP_CHANNELS.windowClose, (event, request) => {
    const window = senderMainWindow(event)
    if (!window) return
    windowWithCloseHandler = undefined
    if (request?.quit === true) app.quit()
    else window.close()
  })
  handleDesktop(DESKTOP_CHANNELS.windowSetCloseHandler, (event, request) => {
    const window = senderMainWindow(event)
    if (isMac && window && typeof request?.enabled === 'boolean') {
      windowWithCloseHandler = request.enabled ? window : undefined
    }
  })
  handleDesktop(DESKTOP_CHANNELS.windowSetDocument, (event, request) => {
    const window = senderMainWindow(event)
    if (!isMac || !window || typeof request?.isDirty !== 'boolean') return
    window.setRepresentedFilename(isAbsoluteProjectPath(request.filePath) ? request.filePath : '')
    window.setDocumentEdited(request.isDirty)
  })
  handleDesktop(DESKTOP_CHANNELS.menuEditText, (event, request) => {
    const window = senderMainWindow(event)
    if (isMac && window && Object.hasOwn(DESKTOP_TEXT_EDIT_COMMANDS, request?.command)) {
      window.webContents[DESKTOP_TEXT_EDIT_COMMANDS[request.command]]()
    }
  })
}

async function initializeApplication() {
  if (developmentServerUrl || shouldOpenDevTools) {
    await installReactDevToolsIfAvailable()
  }
  registerSoundFontProtocol()
  registerProjectIpc()
  registerRuleTestCaseIpc()
  registerRuleLibraryIpc()
  registerWindowIpc()
  handleDesktop(DESKTOP_CHANNELS.projectConsumePendingOpen, (event) =>
    queueExternalProjectOperation(async () => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return null
      // renderer 先订阅事件，再用此调用声明已准备好接收剩余请求。
      const filePath = pendingExternalProjectPaths.shift()
      rendererAcceptsExternalProjects = true
      if (pendingSettings) {
        pendingSettings = false
        event.sender.send(DESKTOP_CHANNELS.menuCommand, 'settings')
      }
      sendPendingExternalProjects()
      return filePath ? loadExternalProject(filePath) : null
    }),
  )
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
  applicationInitialized = true
  if (isMac) {
    installMacApplicationMenu((command) => void dispatchMacMenuCommand(command).catch((error) => {
      logMain('error', 'app', '应用菜单命令失败', { error, context: { command } })
    }))
  }
  createWindow()
  app.on('activate', showMainWindow)
}

if (e2eDirectory === undefined && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (e2eDirectory === undefined) app.on('second-instance', onSecondInstance)
  void app.whenReady().then(initializeApplication)
}

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})
