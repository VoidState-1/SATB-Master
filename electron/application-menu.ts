import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { DesktopMenuCommand } from '../shared/desktop.js'

export function installMacApplicationMenu(dispatch: (command: DesktopMenuCommand) => void) {
  const item = (label: string, command: DesktopMenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    id: command,
    label,
    accelerator,
    click: () => dispatch(command),
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'SATB Master', role: 'appMenu', submenu: [
      { role: 'about', label: '关于 SATB Master' },
      item('设置…', 'settings', 'Command+,'),
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit', label: '退出 SATB Master' },
    ] },
    // Configurable shortcuts belong to the renderer so each key is dispatched once.
    { label: '文件', submenu: [
      item('新建工程', 'newProject'),
      item('打开工程…', 'openProject'),
      { role: 'recentDocuments', label: '打开最近使用的工程', submenu: [
        { role: 'clearRecentDocuments', label: '清除菜单' },
      ] },
      { type: 'separator' },
      item('保存', 'saveProject'),
      item('另存为…', 'saveProjectAs'),
      { type: 'separator' },
      { role: 'close', label: '关闭窗口' },
    ] },
    { label: '编辑', submenu: [
      item('撤销', 'undo'),
      item('重做', 'redo'),
      { type: 'separator' },
      item('剪切', 'cutSelection'),
      item('复制', 'copySelection'),
      item('粘贴', 'pasteSelection'),
      item('全选', 'selectAll'),
    ] },
    { label: '显示', submenu: [
      item('放大时间轴', 'zoomIn'),
      item('缩小时间轴', 'zoomOut'),
      { type: 'separator' },
      { role: 'togglefullscreen', label: '切换全屏', accelerator: 'Control+Command+F' },
    ] },
    { label: '窗口', role: 'windowMenu', submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放窗口' },
      { type: 'separator' },
      { role: 'front', label: '前置全部窗口' },
    ] },
  ]))
}
