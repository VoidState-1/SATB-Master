import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseMidi } from 'midi-file'

const executable = path.resolve(process.argv[2] ?? 'release-installer/win-unpacked/SATB Master.exe')
const appDirectory = process.argv[3] ? path.resolve(process.argv[3]) : undefined
const e2eDirectory = await mkdtemp(path.join(os.tmpdir(), 'satb-master-e2e-'))
const debugPort = 9_337
const launchArguments = [`--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*']
if (appDirectory) launchArguments.push(appDirectory)
const child = spawn(executable, launchArguments, {
  env: { ...process.env, SATB_MASTER_E2E_DIRECTORY: e2eDirectory },
  stdio: 'ignore',
})

let client

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForTarget() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json())
      const page = targets.find((target) => target.type === 'page' && target.title === 'SATB Master')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Electron 进程与调试端口启动存在短暂竞态，轮询期间的连接失败属于正常状态。
    }
    await delay(150)
  }
  throw new Error('桌面应用未在 20 秒内提供调试页面')
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.sequence = 0
    this.pending = new Map()
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (message) => {
      const payload = JSON.parse(String(message.data))
      if (!payload.id) return
      const pending = this.pending.get(payload.id)
      if (!pending) return
      this.pending.delete(payload.id)
      if (payload.error) pending.reject(new Error(payload.error.message))
      else pending.resolve(payload.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.sequence
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? 'Renderer 执行失败')
  return response.result.value
}

async function waitFor(predicateExpression, label, timeout = 8_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(predicateExpression)) return
    await delay(100)
  }
  const documentText = await evaluate('document.body.innerText')
  throw new Error(`等待超时：${label}\n--- Renderer text ---\n${documentText}`)
}

async function waitForFile(filePath, label, timeout = 8_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      await access(filePath)
      return
    } catch {
      await delay(100)
    }
  }
  throw new Error(`等待文件超时：${label}`)
}

async function assertSilence(duration, label) {
  const deadline = Date.now() + duration
  while (Date.now() < deadline) {
    const level = await evaluate(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow'))`)
    if (level > 0.001) throw new Error(`${label}检测到残留音频电平：${level}`)
    await delay(25)
  }
}

async function clickButton(label) {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`按钮不可用：${label}`)
  await delay(120)
}

async function addNote(voiceIndex, tick, midiNote) {
  const selected = await evaluate(`(() => {
    const track = document.querySelectorAll('.voice-track')[${voiceIndex}];
    if (!track) return false;
    track.click();
    return true;
  })()`)
  if (!selected) throw new Error(`无法选择声部索引：${voiceIndex}`)
  await delay(60)

  const pointer = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const canvas = document.querySelector('.roll-canvas');
    if (!roll || !canvas) return null;
    const localY = 72 + (84 - ${midiNote}) * 22 + 10;
    roll.scrollTop = Math.max(0, localY - 180);
    roll.scrollLeft = 0;
    const rect = canvas.getBoundingClientRect();
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    canvas.hasPointerCapture = () => true;
    const clientX = rect.left + 58 + (${tick} / 960) * 72 + 6;
    const clientY = rect.top + localY;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX, clientY, button: 0 }));
    return { clientX, clientY };
  })()`)
  if (!pointer) throw new Error('无法定位钢琴卷帘')
  await delay(80)
  await evaluate(`(() => {
    const canvas = document.querySelector('.roll-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 1,
      clientX: ${pointer.clientX},
      clientY: ${pointer.clientY},
      button: 0,
    }));
  })()`)
  await delay(100)
}

try {
  const debuggerUrl = await waitForTarget()
  client = new CdpClient(debuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await waitFor(`document.readyState === 'complete' && document.body.innerText.includes('未命名练习')`, '应用首屏')

  const voices = [
    [72, 74],
    [65, 67],
    [60, 62],
    [48, 50],
  ]
  for (let voice = 0; voice < voices.length; voice += 1) {
    await addNote(voice, 0, voices[voice][0])
    await addNote(voice, 480, voices[voice][1])
  }

  await clickButton('保存')
  const projectPath = path.join(e2eDirectory, 'project.satb')
  await waitForFile(projectPath, '工程保存')
  const draftProject = JSON.parse(await readFile(projectPath, 'utf8'))
  const draftNotes = draftProject.tracks.map((track) => track.notes.map((note) => [note.startTick, note.midiNote]))
  const expectedNotes = [[[0, 72], [480, 74]], [[0, 65], [480, 67]], [[0, 60], [480, 62]], [[0, 48], [480, 50]]]
  if (JSON.stringify(draftNotes) !== JSON.stringify(expectedNotes)) throw new Error('卷帘输入结果与预期不一致')
  await waitFor(`document.body.innerText.includes('平行纯五度') && document.body.innerText.includes('平行八度或同度')`, '和声规则诊断')
  await clickButton('撤销')
  await clickButton('重做')

  await clickButton('播放')
  await waitFor(`document.querySelector('.engine-status')?.classList.contains('playing') === true`, '播放状态')
  await waitFor(`document.body.innerText.includes('SoundFont 已就绪')`, '默认 SF2 加载')
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) > 0.001`, '默认 SF2 实际音频输出')
  await clickButton('停止')

  const userSoundFontPath = appDirectory
    ? path.join(appDirectory, 'public', 'soundfonts', 'default.sf2')
    : path.join(path.dirname(executable), 'resources', 'soundfonts', 'default.sf2')
  const userSoundFont = await evaluate(`window.desktop.soundFont.loadPath(${JSON.stringify(userSoundFontPath)}).then((result) => ({
    name: result.name,
    hash: result.hash,
    byteLength: result.bytes.byteLength,
  }))`)
  if (!userSoundFont.hash || userSoundFont.byteLength < 1) throw new Error('按工程路径读取用户 SoundFont 失败')
  draftProject.audio.soundFont = {
    kind: 'user',
    name: 'E2E User SoundFont',
    path: userSoundFontPath,
    hash: userSoundFont.hash,
  }
  await writeFile(projectPath, JSON.stringify(draftProject, null, 2), 'utf8')

  await waitFor(`document.body.innerText.includes(${JSON.stringify(path.join(e2eDirectory, 'project.satb'))})`, '工程保存')
  await clickButton('导出 MIDI')
  await delay(200)
  await clickButton('新建工程')
  await waitFor(`document.body.innerText.includes('0 个错误')`, '新建空工程')
  await clickButton('打开工程')
  await waitFor(`document.body.innerText.includes('平行纯五度')`, '重新打开工程')
  await clickButton('播放')
  await waitFor(`document.body.innerText.includes('SoundFont 已就绪')`, '重开工程后恢复用户 SF2')
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) > 0.001`, '用户 SF2 实际音频输出')
  await clickButton('暂停')
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) <= 0.001`, '暂停后输出归零')
  await assertSilence(800, '暂停后的未来调度')

  const project = JSON.parse(await readFile(path.join(e2eDirectory, 'project.satb'), 'utf8'))
  const midi = parseMidi(new Uint8Array(await readFile(path.join(e2eDirectory, 'export.mid'))))
  const noteCount = project.tracks.reduce((count, track) => count + track.notes.length, 0)
  const midiNoteOns = midi.tracks.flat().filter((event) => event.type === 'noteOn').length
  if (noteCount !== 8) throw new Error(`工程往返音符数错误：${noteCount}`)
  if (midi.header.format !== 1 || midi.tracks.length !== 5 || midiNoteOns !== 8) {
    throw new Error(`MIDI 往返结构错误：format=${midi.header.format} tracks=${midi.tracks.length} noteOns=${midiNoteOns}`)
  }

  await addNote(0, 960, 76)
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) > 0.001`, '暂停后绘制音符预听')
  await waitFor(`window.desktop.project.recovery().then((result) => (
    result.available && result.project.tracks.reduce((count, track) => count + track.notes.length, 0) === 9
  ))`, '自动恢复写入', 8_000)
  await clickButton('保存')
  await waitFor(`window.desktop.project.recovery().then((result) => result.available === false)`, '显式保存后清理恢复文件')

  console.log(JSON.stringify({
    executable,
    defaultSoundFont: 'ready',
    userSoundFontReload: 'path-hash-ready',
    audibleOutput: 'play-pause-preview-ready',
    projectNotes: noteCount,
    midiFormat: midi.header.format,
    midiTracks: midi.tracks.length,
    midiNoteOns,
    recoveryLifecycle: 'write-read-clear',
  }, null, 2))
} finally {
  try {
    void client?.send('Browser.close').catch(() => {})
    await delay(300)
  } catch {
    // 调试连接可能先于 Browser.close 响应断开，最终仍由子进程句柄兜底回收。
  }
  client?.close()
  if (!child.killed) child.kill()
  await rm(e2eDirectory, { recursive: true, force: true })
}
