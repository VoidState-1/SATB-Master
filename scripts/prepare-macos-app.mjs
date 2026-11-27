import { execFileSync } from 'node:child_process'
import path from 'node:path'

export default function prepareMacApp({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== 'darwin') return
  const bundle = path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
  // Finder and synced build directories can attach metadata that codesign rejects.
  for (const attribute of ['com.apple.FinderInfo', 'com.apple.ResourceFork']) {
    execFileSync('/usr/bin/xattr', ['-rd', attribute, bundle])
  }
}
