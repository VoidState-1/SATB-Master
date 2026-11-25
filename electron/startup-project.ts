import path from 'node:path'

export function extractProjectFilePathFromArgv(
  argv: readonly string[],
  cwd?: string,
): string | undefined {
  for (let index = 1; index < argv.length; index++) {
    const candidate = argv[index].replace(/^(["'])(.*)\1$/s, '$2')
    if (candidate === '--audit-package') {
      index++
      continue
    }
    if (candidate.startsWith('-')) continue
    if (path.extname(candidate).toLowerCase() === '.satb') {
      return path.resolve(cwd ?? process.cwd(), candidate)
    }
  }
}
