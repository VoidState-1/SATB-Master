import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { deflateSync, inflateSync } from 'node:zlib'

const build = new URL('../build/', import.meta.url)
const samples = 4
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const white = [255, 255, 255]
const paper = [246, 246, 242]
const pine = [39, 109, 89]
const pineInk = [28, 84, 68]
const charcoal = [37, 42, 37]
const charcoalDesk = [23, 26, 23]
const rust = [152, 79, 71]

const voices = [
  [117, 82, 163], [45, 122, 104], [63, 111, 168], [135, 100, 61],
]
const paperMark = { tile: paper, staff: [199, 203, 194], ink: charcoal, voices }
const charcoalMark = {
  tile: [47, 52, 47], staff: [82, 88, 79], ink: [185, 190, 177],
  voices: [[147, 126, 163], [97, 147, 130], [110, 142, 175], [159, 130, 96]],
}
const appMark = { ...paperMark, voices: [[198, 83, 61], ...voices.slice(1)] }

function mix(first, second, amount) {
  return first.map((channel, index) => Math.round(channel + (second[index] - channel) * amount))
}

function raster(width, height, top, bottom = top) {
  const stride = width * samples
  const canvas = new Uint8Array(stride * height * samples * 4)

  if (top) {
    for (let y = 0; y < height * samples; y++) {
      const color = mix(top, bottom, y / (height * samples - 1))
      for (let x = 0; x < stride; x++) canvas.set([...color, 255], (y * stride + x) * 4)
    }
  }

  function roundRect(x, y, w, h, radius, color, opacity = 1) {
    for (let row = Math.max(0, Math.floor(y * samples)); row < Math.min(height * samples, Math.ceil((y + h) * samples)); row++) {
      for (let column = Math.max(0, Math.floor(x * samples)); column < Math.min(stride, Math.ceil((x + w) * samples)); column++) {
        const px = (column + 0.5) / samples
        const py = (row + 0.5) / samples
        if (px < x || px >= x + w || py < y || py >= y + h) continue
        const dx = Math.max(x + radius - px, px - (x + w - radius), 0)
        const dy = Math.max(y + radius - py, py - (y + h - radius), 0)
        if (dx * dx + dy * dy > radius * radius) continue

        const index = (row * stride + column) * 4
        for (let channel = 0; channel < 3; channel++) {
          canvas[index + channel] = Math.round(color[channel] * opacity + canvas[index + channel] * (1 - opacity))
        }
        canvas[index + 3] = Math.round(255 * opacity + canvas[index + 3] * (1 - opacity))
      }
    }
  }

  function pixels() {
    const output = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let red = 0
        let green = 0
        let blue = 0
        let alpha = 0
        for (let row = 0; row < samples; row++) {
          for (let column = 0; column < samples; column++) {
            const offset = ((y * samples + row) * stride + x * samples + column) * 4
            const coverage = canvas[offset + 3]
            red += canvas[offset] * coverage
            green += canvas[offset + 1] * coverage
            blue += canvas[offset + 2] * coverage
            alpha += coverage
          }
        }
        if (alpha === 0) continue
        output.set([
          Math.round(red / alpha), Math.round(green / alpha), Math.round(blue / alpha),
          Math.round(alpha / (samples * samples)),
        ], (y * width + x) * 4)
      }
    }
    return output
  }

  return { width, height, roundRect, pixels }
}

function drawMark(image, x, y, size, palette) {
  const scale = size / 256
  const round = (left, top, w, h, radius, color) =>
    image.roundRect(x + left * scale, y + top * scale, w * scale, h * scale, radius * scale, color)
  round(8, 8, 240, 240, 42, palette.tile)
  for (const line of [66, 96, 126, 156, 186]) round(39, line, 178, 4, 2, palette.staff)
  for (const [index, start] of [48, 61, 54, 70].entries()) {
    const top = 69 + index * 34
    round(start, top, 166 - start, 16, 8, palette.voices[index])
    round(161, top - 5, 26, 26, 13, palette.voices[index])
    round(184, top + 5, 23, 6, 3, palette.ink)
  }
  round(202, 61, 9, 132, 4.5, palette.ink)
  round(189, 110, 34, 34, 17, palette.ink)
  round(198, 119, 16, 16, 8, palette.tile)
}

function sidebar(uninstall) {
  const image = uninstall ? raster(164, 314, charcoal, charcoalDesk) : raster(164, 314, pine, pineInk)
  for (let line = 0; line < 5; line++) {
    image.roundRect(0, 116 + line * 17, 164, 0.8, 0, paper, uninstall ? 0.13 : 0.23)
  }
  drawMark(image, 29, 97, 106, uninstall ? charcoalMark : paperMark)
  image.roundRect(66, 223, 32, 1.5, 0.75, uninstall ? rust : paper, uninstall ? 0.9 : 0.44)
  return image
}

function header(uninstall) {
  const image = raster(150, 57, white)
  image.roundRect(92, 15, 1.5, 27, 0.75, uninstall ? rust : pine)
  drawMark(image, 100, 6.5, 44, uninstall ? charcoalMark : paperMark)
  return image
}

function uninstallIcon() {
  const image = raster(256, 256)
  drawMark(image, 0, 0, 256, appMark)
  image.roundRect(147, 147, 104, 104, 52, paper)
  image.roundRect(154, 154, 90, 90, 45, [133, 55, 51])
  image.roundRect(174, 192, 50, 14, 7, paper)
  return image
}

function bmpRowBytes(width) {
  return Math.ceil(width * 3 / 4) * 4
}

function encodeBmp({ width, height, pixels }) {
  const stride = bmpRowBytes(width)
  const pixelOffset = 54
  const bmp = Buffer.alloc(pixelOffset + stride * height)
  bmp.write('BM')
  bmp.writeUInt32LE(bmp.length, 2)
  bmp.writeUInt32LE(pixelOffset, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(width, 18)
  bmp.writeInt32LE(height, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  bmp.writeUInt32LE(stride * height, 34)
  const rgba = pixels()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4
      const target = pixelOffset + (height - y - 1) * stride + x * 3
      bmp.set([rgba[source + 2], rgba[source + 1], rgba[source]], target)
    }
  }
  return bmp
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes])
  const chunk = Buffer.alloc(bytes.length + 12)
  chunk.writeUInt32BE(bytes.length, 0)
  data.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(data), data.length + 4)
  return chunk
}

function encodeIco({ width, height, pixels }) {
  const scanlineBytes = width * 4 + 1
  const scanlines = Buffer.alloc(height * scanlineBytes)
  const rgba = pixels()
  for (let y = 0; y < height; y++) rgba.copy(scanlines, y * scanlineBytes + 1, y * width * 4, (y + 1) * width * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6], 8)
  const png = Buffer.concat([
    pngSignature, pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })), pngChunk('IEND', Buffer.alloc(0)),
  ])
  const ico = Buffer.alloc(22)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)
  ico.writeUInt16LE(1, 10)
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(png.length, 14)
  ico.writeUInt32LE(ico.length, 18)
  return Buffer.concat([ico, png])
}

function verifyBmp(bmp, width, height) {
  const stride = bmpRowBytes(width)
  assert.equal(bmp.toString('ascii', 0, 2), 'BM')
  assert.equal(bmp.readUInt32LE(2), bmp.length)
  assert.equal(bmp.readUInt32LE(10), 54)
  assert.equal(bmp.readUInt32LE(14), 40)
  assert.equal(bmp.readInt32LE(18), width)
  assert.equal(bmp.readInt32LE(22), height)
  assert.equal(bmp.readUInt16LE(26), 1)
  assert.equal(bmp.readUInt16LE(28), 24)
  assert.equal(bmp.readUInt32LE(30), 0)
  assert.equal(bmp.readUInt32LE(34), stride * height)
  assert.equal(bmp.length, 54 + stride * height)
  for (let row = 0; row < height; row++) {
    assert(bmp.subarray(54 + row * stride + width * 3, 54 + (row + 1) * stride).every(byte => byte === 0))
  }
}

function verifyIco(ico) {
  assert.deepEqual([...ico.subarray(0, 14)], [0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 32, 0])
  assert.equal(ico.readUInt32LE(18), 22)
  assert.equal(ico.readUInt32LE(14), ico.length - 22)
  assert(ico.subarray(22, 30).equals(pngSignature))
  let offset = 30
  const chunks = {}
  for (const expected of ['IHDR', 'IDAT', 'IEND']) {
    const length = ico.readUInt32BE(offset)
    const type = ico.toString('ascii', offset + 4, offset + 8)
    const end = offset + 8 + length
    assert.equal(type, expected)
    assert.equal(crc32(ico.subarray(offset + 4, end)), ico.readUInt32BE(end))
    chunks[type] = ico.subarray(offset + 8, end)
    offset = end + 4
  }
  assert.equal(offset, ico.length)
  assert.deepEqual([...chunks.IHDR], [0, 0, 1, 0, 0, 0, 1, 0, 8, 6, 0, 0, 0])
  assert.equal(chunks.IEND.length, 0)
  const scanlines = inflateSync(chunks.IDAT)
  assert.equal(scanlines.length, 256 * 1025)
  for (let row = 0; row < 256; row++) assert.equal(scanlines[row * 1025], 0)
  assert.equal(scanlines[4], 0)
  assert.equal(scanlines[199 * 1025 + 199 * 4 + 4], 255)
}

await mkdir(build, { recursive: true })
for (const [name, image, width, height] of [
  ['installer-sidebar.bmp', sidebar(false), 164, 314],
  ['uninstaller-sidebar.bmp', sidebar(true), 164, 314],
  ['installer-header.bmp', header(false), 150, 57],
  ['uninstaller-header.bmp', header(true), 150, 57],
]) {
  const file = new URL(name, build)
  await writeFile(file, encodeBmp(image))
  verifyBmp(await readFile(file), width, height)
}
const icon = new URL('uninstaller-icon.ico', build)
await writeFile(icon, encodeIco(uninstallIcon()))
verifyIco(await readFile(icon))
console.log('Generated and verified four NSIS bitmaps and the uninstall icon.')
