import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerProjectIpc } from './project-ipc.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const developmentServerUrl = process.argv.includes('--dev')
  ? 'http://localhost:5173'
  : undefined
const e2eDirectory = process.env.SATB_MASTER_E2E_DIRECTORY

if (e2eDirectory) app.setPath('userData', path.join(e2eDirectory, 'user-data'))

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f4f3ef',
    show: false,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    const protocol = new URL(url).protocol
    if (protocol === 'https:' || protocol === 'http:') {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (developmentServerUrl) {
    void window.loadURL(developmentServerUrl)
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    void window.loadFile(path.join(currentDirectory, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  registerProjectIpc()
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
