import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseMidi } from 'midi-file'

const executable = path.resolve(process.argv[2] ?? 'release-installer/win-unpacked/SATB Master.exe')
const appDirectory = process.argv[3] ? path.resolve(process.argv[3]) : undefined
const e2eRoot = path.resolve('node_modules/.satb-master-e2e')
await mkdir(e2eRoot, { recursive: true })
const e2eDirectory = await mkdtemp(path.join(e2eRoot, 'run-'))
// Chromium 子进程必须能写入 userData；项目内的临时目录也便于受限环境稳定执行。
await mkdir(path.join(e2eDirectory, 'user-data'), { recursive: true })
const debugPort = 9_337
const launchArguments = [`--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*', '--disable-gpu']
if (appDirectory) launchArguments.push(appDirectory)
let childLog = ''
const child = spawn(executable, launchArguments, {
  env: { ...process.env, SATB_MASTER_E2E_DIRECTORY: e2eDirectory },
  stdio: ['ignore', 'pipe', 'pipe'],
})
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    childLog = `${childLog}${String(chunk)}`.slice(-8_000)
  })
}

let client

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForTarget() {
  const deadline = Date.now() + 20_000
  let targetSummary = '调试端口无响应'
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json())
      targetSummary = JSON.stringify(targets.map((target) => ({ type: target.type, title: target.title, url: target.url })))
      const page = targets.find((target) => target.type === 'page' && target.title === 'SATB Master')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Electron 进程与调试端口启动存在短暂竞态，轮询期间的连接失败属于正常状态。
    }
    await delay(150)
  }
  throw new Error(`桌面应用未在 20 秒内提供调试页面（exit=${child.exitCode}）\n目标：${targetSummary}\n${childLog}`)
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

async function verifyInitialGridSelection() {
  const target = await evaluate(`(() => {
    const select = document.querySelector('select[aria-label="时值对齐"]');
    if (!select) return null;
    const rect = select.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return { x, y, topTag: document.elementFromPoint(x, y)?.tagName, value: select.value };
  })()`)
  if (!target || target.topTag !== 'SELECT' || target.value !== '480') {
    throw new Error(`时值对齐控件首次命中异常：${JSON.stringify(target)}`)
  }

  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 })
  await delay(100)
  const focused = await evaluate(`document.activeElement === document.querySelector('select[aria-label="时值对齐"]')`)
  if (!focused) throw new Error('时值对齐控件在应用首次点击时未获得焦点')

  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await waitFor(`document.querySelector('select[aria-label="时值对齐"]')?.value === '240'`, '首次选择 1/16 网格')

  await evaluate(`(() => {
    const select = document.querySelector('select[aria-label="时值对齐"]');
    select.value = '480';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await waitFor(`document.querySelector('select[aria-label="时值对齐"]')?.value === '480'`, '恢复 1/8 网格')
}

async function addNote(voiceIndex, tick, midiNote, pointerTick = tick) {
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
    const clientX = rect.left + 58 + (${pointerTick} / 960) * 72 + 6;
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

async function dragDrawNote(voiceIndex, startRawTick, endRawTick, midiNote) {
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
    const startX = rect.left + 58 + (${startRawTick} / 960) * 72;
    const endX = rect.left + 58 + (${endRawTick} / 960) * 72;
    const clientY = rect.top + localY;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, clientX: startX, clientY, button: 0 }));
    return { startX, endX, clientY };
  })()`)
  if (!pointer) throw new Error('无法开始拖绘音符')
  await delay(60)
  await evaluate(`(() => {
    const canvas = document.querySelector('.roll-canvas');
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 9, clientX: ${pointer.endX}, clientY: ${pointer.clientY}, button: 0, buttons: 1,
    }));
  })()`)
  await delay(60)
  await evaluate(`(() => {
    const canvas = document.querySelector('.roll-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 9, clientX: ${pointer.endX}, clientY: ${pointer.clientY}, button: 0,
    }));
  })()`)
  await delay(100)
}

async function resizeNote(startTick, durationTicks, midiNote, requestedEndTick) {
  const pointer = await evaluate(`(() => {
    const canvas = document.querySelector('.roll-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const noteX = 58 + (${startTick} / 960) * 72;
    const noteWidth = Math.max(10, (${durationTicks} / 960) * 72 - 2);
    const startX = rect.left + noteX + noteWidth - 3;
    const endX = rect.left + 58 + (${requestedEndTick} / 960) * 72;
    const clientY = rect.top + 72 + (84 - ${midiNote}) * 22 + 10;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 10, clientX: startX, clientY, button: 0 }));
    return { startX, endX, clientY };
  })()`)
  if (!pointer) throw new Error('无法开始缩放音符')
  await delay(60)
  await evaluate(`document.querySelector('.roll-canvas').dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerId: 10, clientX: ${pointer.endX}, clientY: ${pointer.clientY}, button: 0, buttons: 1,
  }))`)
  await delay(60)
  await evaluate(`document.querySelector('.roll-canvas').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 10, clientX: ${pointer.endX}, clientY: ${pointer.clientY}, button: 0,
  }))`)
  await delay(100)
}

async function middleDragCanvas() {
  const start = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const canvas = document.querySelector('.roll-canvas');
    if (!roll || !canvas) return null;
    roll.scrollLeft = 360;
    roll.scrollTop = 320;
    const rect = canvas.getBoundingClientRect();
    const clientX = Math.max(rect.left + 420, 480);
    const clientY = Math.max(rect.top + 360, 420);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX, clientY, button: 1, buttons: 4 }));
    return { clientX, clientY, left: roll.scrollLeft, top: roll.scrollTop };
  })()`)
  if (!start) throw new Error('无法开始中键画布拖拽')
  await delay(80)
  await evaluate(`document.querySelector('.roll-canvas').dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerId: 7, clientX: ${start.clientX + 90}, clientY: ${start.clientY + 60}, button: 1, buttons: 4,
  }))`)
  await delay(80)
  const result = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const canvas = document.querySelector('.roll-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 7, clientX: ${start.clientX + 90}, clientY: ${start.clientY + 60}, button: 1,
    }));
    return {
      left: roll.scrollLeft,
      top: roll.scrollTop,
      pencilActive: document.querySelector('button[aria-label^="铅笔工具"]')?.classList.contains('is-active') === true,
    };
  })()`)
  if (result.left >= start.left || result.top >= start.top || !result.pencilActive) {
    throw new Error(`中键拖拽结果无效：${JSON.stringify({ start, result })}`)
  }
}

try {
  const debuggerUrl = await waitForTarget()
  client = new CdpClient(debuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await waitFor(`document.readyState === 'complete' && document.body.innerText.includes('未命名练习')`, '应用首屏')
  await waitFor(`window.desktop.windowControls.isFocused().then((focused) => focused && document.hasFocus())`, '应用首屏原生窗口与网页焦点')
  await verifyInitialGridSelection()
  await waitFor(`Boolean(window.desktop?.windowControls) && Boolean(document.querySelector('button[aria-label="最大化"]'))`, '自定义窗口控件')
  await clickButton('最大化')
  await waitFor(`window.desktop.windowControls.isMaximized()`, '窗口最大化')
  await clickButton('还原')
  await waitFor(`window.desktop.windowControls.isMaximized().then((value) => !value)`, '窗口还原')

  const voices = [
    [72, 74],
    [65, 67],
    [60, 62],
    [48, 50],
  ]
  for (let voice = 0; voice < voices.length; voice += 1) {
    await addNote(voice, 0, voices[voice][0], voice === 0 ? 300 : 0)
    await addNote(voice, 480, voices[voice][1])
  }
  await middleDragCanvas()

  await dragDrawNote(0, 1_040, 1_520, 76)
  await clickButton('保存')
  const projectPath = path.join(e2eDirectory, 'project.satb')
  await waitForFile(projectPath, '拖绘工程保存')
  const drawProject = JSON.parse(await readFile(projectPath, 'utf8'))
  const drawnNote = drawProject.tracks[0].notes.find((note) => note.startTick === 960 && note.midiNote === 76)
  if (drawnNote?.durationTicks !== 960) throw new Error(`拖绘时值吸附错误：${drawnNote?.durationTicks}`)
  await clickButton('撤销')

  await addNote(0, 960, 76)
  await clickButton('选择工具（1）')
  await resizeNote(960, 480, 76, 1_500)
  await clickButton('保存')
  const resizeProject = JSON.parse(await readFile(projectPath, 'utf8'))
  const resizedNote = resizeProject.tracks[0].notes.find((note) => note.startTick === 960 && note.midiNote === 76)
  if (resizedNote?.durationTicks !== 960) throw new Error(`缩放时值吸附错误：${resizedNote?.durationTicks}`)
  await clickButton('撤销')
  await clickButton('撤销')
  await clickButton('铅笔工具（2）')

  await clickButton('保存')
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
    snapMode: 'floor-start-ceil-end',
    initialGridSelection: 'ready',
    initialWindowFocus: 'native-and-web-ready',
    middlePan: 'ready',
    customWindowFrame: 'ready',
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
