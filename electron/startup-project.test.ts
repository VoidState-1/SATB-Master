import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractProjectFilePathFromArgv } from './startup-project'

describe('extractProjectFilePathFromArgv', () => {
  const cwd = path.resolve('launch-directory')

  it('reads a Windows path passed to the packaged executable', () => {
    const filePath = 'C:\\foo\\demo.satb'
    expect(extractProjectFilePathFromArgv(['SATB Master.exe', filePath])).toBe(path.resolve(filePath))
  })

  it.each(['my project.satb', '"my project.satb"', "'my project.satb'", 'demo.SATB'])(
    'resolves %s relative to the launching directory',
    (argument) => {
      expect(extractProjectFilePathFromArgv(['electron', '.', '--dev', argument], cwd))
        .toBe(path.join(cwd, argument.replace(/["']/g, '')))
    },
  )

  it('skips Electron entry points, flags and the audit package value', () => {
    expect(extractProjectFilePathFromArgv([
      'electron', 'dist-electron/electron/main.js', '--dev', '--switch.satb',
      '--audit-package', 'path.satb-audit.json', 'first.satb', 'second.satb',
    ], cwd)).toBe(path.join(cwd, 'first.satb'))
    expect(extractProjectFilePathFromArgv([
      'electron', '.', '--audit-package', 'audit-value.satb', 'project.satb',
    ], cwd)).toBe(path.join(cwd, 'project.satb'))
  })

  it('uses the current directory when no launch directory is supplied', () => {
    expect(extractProjectFilePathFromArgv(['SATB Master.exe', 'scores/demo.satb']))
      .toBe(path.resolve('scores/demo.satb'))
  })

  it.each([
    { argv: [] },
    { argv: ['executable.satb'] },
    { argv: ['electron', '.', 'dist-electron/electron/main.js', '--dev', 'demo.satb-audit.json'] },
    { argv: ['electron', '--audit-package'] },
    { argv: ['electron', '--audit-package', '"audit-value.satb"'] },
  ])('returns undefined when there is no project argument ($argv)', ({ argv }) => {
    expect(extractProjectFilePathFromArgv(argv, cwd)).toBeUndefined()
  })
})
