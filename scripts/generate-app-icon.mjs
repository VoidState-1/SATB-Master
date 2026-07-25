import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 256
const pixels = new Uint8Array(SIZE * SIZE * 4)
const outputDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build')

function setPixel(x, y, color) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return
  const index = (y * SIZE + x) * 4
  pixels[index] = color[0]
  pixels[index + 1] = color[1]
  pixels[index + 2] = color[2]
  pixels[index + 3] = color[3] ?? 255
}

function fillRect(x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) setPixel(column, row, color)
  }
}

function fillCircle(centerX, centerY, radius, color) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) setPixel(x, y, color)
    }
  }
}

function fillRoundedRect(x, y, width, height, radius, color) {
  fillRect(x + radius, y, width - radius * 2, height, color)
  fillRect(x, y + radius, width, height - radius * 2, color)
  fillCircle(x + radius, y + radius, radius, color)
  fillCircle(x + width - radius - 1, y + radius, radius, color)
  fillCircle(x + radius, y + height - radius - 1, radius, color)
  fillCircle(x + width - radius - 1, y + height - radius - 1, radius, color)
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const output = Buffer.alloc(12 + data.length)
  output.writeUInt32BE(data.length, 0)
  typeBytes.copy(output, 4)
  Buffer.from(data).copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length)
  return output
}

// 图标完全由几何色块生成：四条独立声部在右侧连接到同一个纵向和声支架。
fillRoundedRect(8, 8, 240, 240, 42, [244, 243, 239, 255])
const charcoal = [45, 49, 45, 255]
for (const y of [66, 96, 126, 156, 186]) fillRoundedRect(39, y, 178, 3, 1, [195, 197, 190, 255])

const voices = [
  { y: 69, color: [198, 83, 61, 255], start: 48 },
  { y: 103, color: [45, 122, 104, 255], start: 61 },
  { y: 137, color: [63, 111, 168, 255], start: 54 },
  { y: 171, color: [135, 100, 61, 255], start: 70 },
]
for (const voice of voices) {
  fillRoundedRect(voice.start, voice.y, 118 - (voice.start - 48), 16, 8, voice.color)
  fillCircle(174, voice.y + 8, 13, voice.color)
  fillRoundedRect(184, voice.y + 5, 23, 6, 3, charcoal)
}
fillRoundedRect(202, 61, 9, 132, 4, charcoal)
fillCircle(206, 127, 17, charcoal)
fillCircle(206, 127, 8, [244, 243, 239, 255])

const scanlines = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y += 1) {
  const targetOffset = y * (SIZE * 4 + 1)
  scanlines[targetOffset] = 0
  Buffer.from(pixels.buffer, y * SIZE * 4, SIZE * 4).copy(scanlines, targetOffset + 1)
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8
header[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', header),
  pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
])

const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
icoHeader[6] = 0
icoHeader[7] = 0
icoHeader[8] = 0
icoHeader[9] = 0
icoHeader.writeUInt16LE(1, 10)
icoHeader.writeUInt16LE(32, 12)
icoHeader.writeUInt32LE(png.length, 14)
icoHeader.writeUInt32LE(22, 18)

await mkdir(outputDirectory, { recursive: true })
await writeFile(path.join(outputDirectory, 'icon.png'), png)
await writeFile(path.join(outputDirectory, 'icon.ico'), Buffer.concat([icoHeader, png]))
console.log(`Generated ${path.join(outputDirectory, 'icon.ico')} (${png.length} PNG bytes)`)
