import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Arch, build, Platform } from 'electron-builder'

const require = createRequire(import.meta.url)
const nsis = require('app-builder-lib/out/targets/nsis/nsisUtil.js')
const originalTemplates = nsis.nsisTemplatesDir

// Use a disposable copy of the pinned templates to localize fallback messages
// and connect data cleanup after the program removal step.
async function localizeTemplates(directory) {
  const elevationError = '无法请求管理员权限。错误代码：$0'
  const replacements = {
    'installer.nsi': [
      ['Var newStartMenuLink', '!define SATB_LOCALIZED_NSIS_TEMPLATES\nVar newStartMenuLink'],
      ['Unable to elevate, error $0', elevationError],
    ],
    'multiUserUi.nsh': [
      ['(must run as admin)', '（需要管理员权限）'],
      ['Logon service not running, aborting!', '无法请求管理员权限。请启动 Windows 的辅助登录服务后重试。'],
      ['Unable to elevate, error $0', elevationError],
    ],
    'include/allowOnlyOneInstallerInstance.nsh': [
      ['Waiting for "${PRODUCT_NAME}" to close.', '正在等待 ${PRODUCT_NAME} 关闭。'],
    ],
    'include/extractAppPackage.nsh': [
      ["Can't modify \"${PRODUCT_NAME}\"'s files.", '无法写入 ${PRODUCT_NAME} 的程序文件。'],
    ],
    'include/installUtil.nsh': [
      // Internal upgrades always preserve user data, even if the setup command was given this flag.
      [[
        '  ${if} ${isDeleteAppData}',
        '    StrCpy $0 "$0 --delete-app-data"',
        '  ${else}',
        '    # always pass --updated flag - to ensure that if DELETE_APP_DATA_ON_UNINSTALL is defined, user data will be not removed',
        '    StrCpy $0 "$0 --updated"',
        '  ${endif}',
      ].join('\n'), '  StrCpy $0 "$0 --updated"'],
      ['Uninstall was not successful. Not able to launch uninstaller!', '无法启动旧版本的卸载程序。'],
      ['Uninstall was not successful. Uninstaller error code: $R0.', '旧版本卸载失败。错误代码：$R0'],
    ],
    'assistedMessages.yml': [
      ['  zh_CN: 安装选项\n', '  zh_CN: 选择安装范围\n'],
      ['  zh_CN: 卸载选项\n', '  zh_CN: 选择卸载范围\n'],
      ['  zh_CN: 仅为我安装\n', '  zh_CN: 仅当前用户\n'],
      ['  zh_CN: 为使用这台电脑的任何人安装 (所有用户)\n', '  zh_CN: 所有用户\n'],
    ],
    'messages.yml': [
      ['decompressionFailed:\n', 'decompressionFailed:\n  zh_CN: 解压程序文件失败。请重新运行安装程序。\n'],
      ['uninstallFailed:\n', 'uninstallFailed:\n  zh_CN: 无法移除旧版本的程序文件。请重新运行安装程序。\n'],
      ['appClosing:\n', 'appClosing:\n  zh_CN: 正在关闭 ${PRODUCT_NAME}。\n'],
    ],
    'uninstaller.nsh': [
      ['File is busy, aborting: $R0', '文件仍在使用，卸载已中止：$R0'],
      ['Can\'t rename "$INSTDIR" to "$PLUGINSDIR\\old-install".', '无法暂存旧版本的程序文件。请关闭占用文件的程序后重试。'],
      ['  Var /GLOBAL isDeleteAppData\n', [
        '  !ifmacrodef customRemoveAppData',
        '    !insertmacro customRemoveAppData',
        '  !else',
        '  Var /GLOBAL isDeleteAppData',
        '',
      ].join('\n')],
      ['  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"', [
        '  !endif',
        '',
        '  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"',
      ].join('\n')],
      ['!ifmacrodef customUnInstallSection', [
        '!ifmacrodef customUninstallFunctions',
        '  !insertmacro customUninstallFunctions',
        '!endif',
        '',
        '!ifmacrodef customUnInstallSection',
      ].join('\n')],
    ],
  }

  for (const [file, edits] of Object.entries(replacements)) {
    const target = path.join(directory, file)
    let source = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n')
    for (const [original, localized] of edits) {
      const first = source.indexOf(original)
      if (first < 0 || source.indexOf(original, first + original.length) !== -1) {
        throw new Error('The pinned NSIS template changed: ' + file + ' (' + original + ')')
      }
      source = source.replace(original, () => localized)
    }
    await writeFile(target, source, 'utf8')
  }
}

const templates = await mkdtemp(path.join(tmpdir(), 'satb-nsis-templates-'))
try {
  await cp(originalTemplates, templates, { recursive: true })
  await localizeTemplates(templates)
  nsis.nsisTemplatesDir = templates
  await build({
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    config: { directories: { output: 'release-installer' } },
  })
} finally {
  nsis.nsisTemplatesDir = originalTemplates
  await rm(templates, { recursive: true, force: true })
}
