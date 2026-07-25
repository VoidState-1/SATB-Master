import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(repositoryRoot, 'dist-electron')
if (path.dirname(outputDirectory) !== repositoryRoot || path.basename(outputDirectory) !== 'dist-electron') {
  throw new Error(`拒绝清理非预期目录：${outputDirectory}`)
}

await rm(outputDirectory, { recursive: true, force: true })
