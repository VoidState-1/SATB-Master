import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseMidi } from 'midi-file'

const executable = path.resolve(process.argv[2] ?? 'release-installer/win-unpacked/SATB Master.exe')
const appDirectory = process.argv[3] ? path.resolve(process.argv[3]) : undefined
const e2eRoot = path.resolve('node_modules/.satb-master-e2e')
await mkdir(e2eRoot, { recursive: true })
const e2eDirectory = await mkdtemp(path.join(e2eRoot, 'run-'))
const recoveryChoice = process.env.SATB_MASTER_E2E_RECOVERY_CHOICE === 'discard' ? 'discard' : 'recover'
// Chromium 子进程必须能写入 userData；项目内的临时目录也便于受限环境稳定执行。
await mkdir(path.join(e2eDirectory, 'user-data'), { recursive: true })
const recoveryTimestamp = new Date().toISOString()
const recoverySourcePath = path.join(e2eDirectory, 'project.satb')
const recoveryProject = {
  schemaVersion: 2,
  id: 'project-e2e-recovery',
  title: 'E2E 恢复焦点测试',
  author: '',
  notes: '',
  createdAt: recoveryTimestamp,
  updatedAt: recoveryTimestamp,
  ppq: 960,
  lengthTicks: 61_440,
  tempoEvents: [{ id: 'tempo-e2e', tick: 0, bpm: 80 }],
  meterEvents: [{ id: 'meter-e2e', tick: 0, numerator: 4, denominator: 4 }],
  keyEvents: [{ id: 'key-e2e', tick: 0, tonic: 0, mode: 'major' }],
  tracks: [
    ['soprano', '女高音', 'S', 0.2, 52],
    ['alto', '女低音', 'A', 0.08, 52],
    ['tenor', '男高音', 'T', -0.08, 52],
    ['bass', '男低音', 'B', -0.2, 53],
  ].map(([id, name, shortName, pan, program]) => ({
    id, name, shortName, notes: [], visible: true, muted: false, solo: false, locked: false,
    volume: 0.82, pan, program,
  })),
  chordTrack: { visible: true, locked: false, displayMode: 'roman', regions: [] },
  loop: { enabled: false, startTick: 0, endTick: 3840 },
  exercise: { instructions: '', editableRanges: [] },
  audio: { masterVolume: 0.78, soundFont: { kind: 'default', name: 'SATB Master 默认音色' } },
}
await writeFile(recoverySourcePath, JSON.stringify(recoveryProject, null, 2), 'utf8')
await writeFile(path.join(e2eDirectory, 'user-data', 'recovery.json'), JSON.stringify({
  format: 'satb-master-recovery-v1',
  savedAt: recoveryTimestamp,
  sourcePath: recoverySourcePath,
  project: recoveryProject,
}, null, 2), 'utf8')
const externalRuleSource = `SATB_RULE.register({
  manifest: {
    apiVersion: 3,
    packageId: "org.satbmaster.e2e",
    version: "1.0.0",
    rules: [{
      id: "phase-c-e2e",
      label: "Phase C E2E 规则",
      description: "验证外置规则私有库、QuickJS Worker 与诊断归并。",
      group: "custom",
      configVersion: 1,
      defaultSeverity: "suggestion",
      dependencyScope: "project",
    }],
  },
  rules: [{
    id: "phase-c-e2e",
    evaluate() {
      return [{
        tick: 0,
        endTick: 0,
        title: "Phase C 外置规则已运行",
        message: "该诊断来自无宿主权限的 QuickJS Worker。",
        noteIds: [], chordIds: [], voiceIds: [], evidence: [], confidence: 1,
      }];
    },
  }],
});`
const externalRuleHash = createHash('sha256').update(externalRuleSource, 'utf8').digest('hex')
await writeFile(path.join(e2eDirectory, 'example.satb-rule.js'), externalRuleSource, 'utf8')
const debugPort = 9_337
const pianoRollHeaderHeight = 88
const pianoRollMinMidi = 0
const pianoRollMaxMidi = 127
const pianoRollRowHeight = 22
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

const naturalPitchClasses = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
function midiOf(note) {
  return (note.pitch.octave + 1) * 12 + naturalPitchClasses[note.pitch.step] + note.pitch.alter
}

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

async function selectRuleByKey(ruleKey) {
  const selected = await evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(`[data-rule-key="${ruleKey}"]`)});
    if (!row) return false;
    row.click();
    return true;
  })()`)
  if (!selected) throw new Error(`规则详情不存在：${ruleKey}`)
  await delay(120)
}

async function clickPaletteOption(group, label) {
  const clicked = await evaluate(`(() => {
    const section = [...document.querySelectorAll('.chord-palette-column')].find((item) => item.querySelector('h3')?.textContent?.trim() === ${JSON.stringify(group)});
    const button = section && [...section.querySelectorAll('button')].find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
    if (!button || button.disabled) return false;
    button.focus();
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`和弦调色盘选项不可用：${group} / ${label}`)
  await delay(80)
}

async function verifyTimelineGuides() {
  const result = await evaluate(`(async () => {
    const roll = document.querySelector('.piano-roll');
    const ruler = document.querySelector('.ruler-lane');
    const chord = document.querySelector('.chord-lane');
    const rulerPlayhead = ruler?.querySelector('.timeline-playhead-segment');
    const chordPlayhead = chord?.querySelector('.timeline-playhead-segment');
    const rollPlayhead = document.querySelector('.roll-playhead');
    if (!roll || !ruler || !chord || !rulerPlayhead || !chordPlayhead || !rollPlayhead) return null;
    const rulerRect = ruler.getBoundingClientRect();
    const chordRect = chord.getBoundingClientRect();
    const rulerPlayheadRect = rulerPlayhead.getBoundingClientRect();
    const chordPlayheadRect = chordPlayhead.getBoundingClientRect();
    const rollPlayheadRect = rollPlayhead.getBoundingClientRect();
    const rulerGuides = [...ruler.querySelectorAll('.timeline-measure-line')].map((line) => line.getBoundingClientRect().left);
    const chordGuides = [...chord.querySelectorAll('.timeline-measure-line')].map((line) => line.getBoundingClientRect().left);
    roll.scrollLeft = 144;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const scrolledGuideLeft = ruler.querySelector('.timeline-measure-line')?.getBoundingClientRect().left;
    roll.scrollLeft = 0;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      rulerGuides,
      chordGuides,
      measureNumbers: ruler.querySelectorAll('.measure-number').length,
      playheadXDelta: Math.abs(rulerPlayheadRect.left - chordPlayheadRect.left),
      rollPlayheadXDelta: Math.abs(chordPlayheadRect.left - rollPlayheadRect.left),
      rulerTopDelta: Math.abs(rulerRect.top - rulerPlayheadRect.top),
      laneJoinOverlap: rulerPlayheadRect.bottom - chordPlayheadRect.top,
      chordBottomOverlap: chordPlayheadRect.bottom - chordRect.bottom,
      triangleWidth: getComputedStyle(rulerPlayhead, '::before').borderTopWidth,
      horizontalScrollDelta: rulerGuides[0] - scrolledGuideLeft,
    };
  })()`)
  if (!result || result.rulerGuides.length !== result.measureNumbers || result.chordGuides.length !== result.measureNumbers) {
    throw new Error(`Timeline measure guide count mismatch: ${JSON.stringify(result)}`)
  }
  const guidesAligned = result.rulerGuides.every((left, index) => Math.abs(left - result.chordGuides[index]) < 0.1)
  const triangleWidth = Number.parseFloat(result.triangleWidth)
  if (!guidesAligned || result.playheadXDelta >= 0.1 || result.rollPlayheadXDelta >= 0.1 || result.rulerTopDelta >= 0.1 || result.laneJoinOverlap < 0 || result.laneJoinOverlap > 2 || result.chordBottomOverlap < 0 || result.chordBottomOverlap > 2 || triangleWidth < 6 || triangleWidth > 7.1 || Math.abs(result.horizontalScrollDelta - 144) > 0.1) {
    throw new Error(`Timeline guide alignment mismatch: ${JSON.stringify(result)}`)
  }
}

async function verifyFullMidiRange() {
  const result = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const canvas = document.querySelector('.roll-canvas');
    const keys = [...document.querySelectorAll('.piano-key')];
    if (!roll || !canvas || keys.length === 0) return null;
    return {
      minMidi: Number(roll.dataset.minMidi),
      maxMidi: Number(roll.dataset.maxMidi),
      rowHeight: Number(roll.dataset.rowHeight),
      headerHeight: Number(roll.dataset.headerHeight),
      keyCount: keys.length,
      firstMidi: Number(keys[0].dataset.midi),
      lastMidi: Number(keys[keys.length - 1].dataset.midi),
      labels: keys.map((key) => key.textContent?.trim()).filter(Boolean),
      canvasHeight: Number.parseFloat(canvas.style.height),
    };
  })()`)
  const expectedHeight = pianoRollHeaderHeight +
    (pianoRollMaxMidi - pianoRollMinMidi + 1) * pianoRollRowHeight
  if (!result
    || result.minMidi !== pianoRollMinMidi
    || result.maxMidi !== pianoRollMaxMidi
    || result.rowHeight !== pianoRollRowHeight
    || result.headerHeight !== pianoRollHeaderHeight
    || result.keyCount !== pianoRollMaxMidi - pianoRollMinMidi + 1
    || result.firstMidi !== pianoRollMaxMidi
    || result.lastMidi !== pianoRollMinMidi
    || !result.labels.includes('C9')
    || !result.labels.includes('C-1')
    || result.canvasHeight !== expectedHeight) {
    throw new Error(`Full MIDI range mismatch: ${JSON.stringify(result)}`)
  }
}

async function verifyViewportCanvas() {
  const result = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const interactionCanvas = document.querySelector('.roll-canvas');
    const viewportCanvas = document.querySelector('.roll-viewport-canvas');
    if (!roll || !interactionCanvas || !viewportCanvas) return null;
    const ratio = window.devicePixelRatio || 1;
    return {
      ratio,
      clientWidth: roll.clientWidth,
      clientHeight: roll.clientHeight,
      scrollWidth: roll.scrollWidth,
      interactionWidth: Number.parseFloat(interactionCanvas.style.width),
      bitmapWidth: viewportCanvas.width,
      bitmapHeight: viewportCanvas.height,
    };
  })()`)
  if (!result
    || result.scrollWidth <= result.clientWidth
    || result.interactionWidth <= result.clientWidth
    || result.bitmapWidth > Math.ceil(result.clientWidth * result.ratio) + 1
    || result.bitmapHeight > Math.ceil(result.clientHeight * result.ratio) + 1) {
    throw new Error(`Viewport canvas allocation mismatch: ${JSON.stringify(result)}`)
  }
}

async function panelMetrics() {
  return evaluate(`(() => {
    const left = document.querySelector('.track-sidebar')?.getBoundingClientRect();
    const right = document.querySelector('.inspector')?.getBoundingClientRect();
    const bottom = document.querySelector('.bottom-panel')?.getBoundingClientRect();
    const editor = document.querySelector('.editor-area')?.getBoundingClientRect();
    const roll = document.querySelector('.piano-roll')?.getBoundingClientRect();
    const separators = [...document.querySelectorAll('[role="separator"]')];
    if (!left || !right || !bottom || !editor || !roll) return null;
    return {
      left: left.width,
      right: right.width,
      bottom: bottom.height,
      editor: editor.width,
      roll: roll.height,
      separators: separators.map((item) => ({
        label: item.getAttribute('aria-label'),
        orientation: item.getAttribute('aria-orientation'),
        value: Number(item.getAttribute('aria-valuenow')),
      })),
      resizingClassActive: document.body.classList.contains('is-resizing-columns') || document.body.classList.contains('is-resizing-rows'),
    };
  })()`)
}

async function dragPanelResizeHandle(label, deltaX, deltaY, pointerId) {
  const dragged = await evaluate(`(() => {
    const handle = [...document.querySelectorAll('[role="separator"]')].find((item) => item.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!handle) return false;
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    handle.hasPointerCapture = () => true;
    const rect = handle.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: ${pointerId}, clientX, clientY, button: 0 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: ${pointerId}, clientX: clientX + ${deltaX}, clientY: clientY + ${deltaY}, button: 0, buttons: 1 }));
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: ${pointerId}, clientX: clientX + ${deltaX}, clientY: clientY + ${deltaY}, button: 0 }));
    return true;
  })()`)
  if (!dragged) throw new Error(`Panel resize handle unavailable: ${label}`)
  await delay(100)
}

async function verifyPanelResizing() {
  const before = await panelMetrics()
  if (!before || before.separators.length !== 3) throw new Error(`Panel separators missing: ${JSON.stringify(before)}`)
  await dragPanelResizeHandle('调整声部面板宽度', 32, 0, 31)
  await dragPanelResizeHandle('调整属性面板宽度', -36, 0, 32)
  await dragPanelResizeHandle('调整底部面板高度', 0, -40, 33)
  const after = await panelMetrics()
  const orientations = after?.separators.map((item) => item.orientation).sort().join(',')
  if (!after || after.left < before.left + 28 || after.right < before.right + 32 || after.bottom < before.bottom + 36
    || after.editor < 360 || after.roll < 220 || after.resizingClassActive || orientations !== 'horizontal,vertical,vertical') {
    throw new Error(`Panel resizing failed: ${JSON.stringify({ before, after })}`)
  }

  for (const label of ['调整声部面板宽度', '调整属性面板宽度', '调整底部面板高度']) {
    await evaluate(`(() => {
      const handle = [...document.querySelectorAll('[role="separator"]')].find((item) => item.getAttribute('aria-label') === ${JSON.stringify(label)});
      handle?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
    })()`)
    await delay(80)
  }
  const reset = await panelMetrics()
  if (!reset || Math.abs(reset.left - before.left) > 1 || Math.abs(reset.right - before.right) > 1 || Math.abs(reset.bottom - before.bottom) > 1) {
    throw new Error(`Panel resize reset failed: ${JSON.stringify({ before, reset })}`)
  }
}

async function verifyRuleTestWorkbenchControls() {
  await clickButton('规则测试工作台')
  await waitFor("Boolean(document.querySelector('.rule-test-workspace'))", '进入规则测试工作台')
  const controls = await evaluate("(() => { const labels = [...document.querySelectorAll('button[aria-label]')].map((button) => button.getAttribute('aria-label')); return { newCase: labels.includes('新建规则用例'), exportMidi: labels.includes('导出 MIDI'), undo: labels.includes('撤销'), play: labels.includes('播放'), stop: labels.includes('停止'), soundFont: labels.includes('选择本地 SoundFont'), defaultSoundFont: labels.includes('恢复默认音色'), grid: Boolean(document.querySelector('.rule-test-toolbar select[aria-label=\\\"时值对齐\\\"]')), pianoRoll: Boolean(document.querySelector('.rule-test-workspace .piano-roll')) }; })()")
  if (!controls || Object.values(controls).some((value) => !value)) {
    throw new Error('规则测试工作台编辑/播放控件缺失：' + JSON.stringify(controls))
  }
  await clickButton('回到开头')
  const playheadAtStart = await evaluate("Number.parseFloat(document.querySelector('.rule-test-workspace .roll-playhead')?.style.left ?? 'NaN')")
  if (!Number.isFinite(playheadAtStart) || Math.abs(playheadAtStart - 58) > 0.1) {
    throw new Error(`规则测试播放前播放头未回到起点：${playheadAtStart}`)
  }
  await clickButton('播放')
  await waitFor("Number.parseFloat(document.querySelector('.rule-test-workspace .roll-playhead')?.style.left ?? 'NaN') > 58.1", '规则测试播放头移动', 10_000)
  await clickButton('停止')
  await clickButton('返回普通工程')
  await waitFor("document.body.innerText.includes('返回普通工程？')", '返回普通工程确认')
  await clickButton('返回')
  await waitFor("Boolean(document.querySelector('.workspace:not(.rule-test-workspace)'))", '返回普通工程')
}

async function verifyPanelLayoutAfterRuleTestRoundTrip() {
  await clickButton('设置')
  await clickButton('开发者')
  const developerModeEnabled = await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="启用开发者模式"]');
    if (!(input instanceof HTMLInputElement)) return false;
    if (!input.checked) input.click();
    return input.checked;
  })()`)
  if (!developerModeEnabled) throw new Error('无法启用开发者模式')
  await clickButton('关闭设置')

  await dragPanelResizeHandle('调整声部面板宽度', 40, 0, 41)
  await dragPanelResizeHandle('调整属性面板宽度', -48, 0, 42)
  await dragPanelResizeHandle('调整底部面板高度', 0, -52, 43)
  const before = await panelMetrics()
  if (!before) throw new Error('进入规则测试前无法读取面板尺寸')

  await clickButton('规则测试工作台')
  await waitFor(`Boolean(document.querySelector('.rule-test-workspace'))`, '进入规则测试工作台')
  await clickButton('返回普通工程')
  await waitFor(`document.body.innerText.includes('返回普通工程？')`, '返回普通工程确认')
  await clickButton('返回')
  await waitFor(`Boolean(document.querySelector('.workspace:not(.rule-test-workspace)'))`, '返回普通工程')

  const restored = await panelMetrics()
  if (!restored
    || Math.abs(restored.left - before.left) > 1
    || Math.abs(restored.right - before.right) > 1
    || Math.abs(restored.bottom - before.bottom) > 1) {
    throw new Error(`规则测试往返后面板尺寸未恢复：${JSON.stringify({ before, restored })}`)
  }

  await dragPanelResizeHandle('调整声部面板宽度', 24, 0, 44)
  await dragPanelResizeHandle('调整属性面板宽度', -24, 0, 45)
  await dragPanelResizeHandle('调整底部面板高度', 0, -24, 46)
  const resized = await panelMetrics()
  if (!resized
    || resized.left < restored.left + 20
    || resized.right < restored.right + 20
    || resized.bottom < restored.bottom + 20) {
    throw new Error(`规则测试往返后面板无法继续调整：${JSON.stringify({ restored, resized })}`)
  }
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
  await waitFor(
    `document.querySelector('select[aria-label="时值对齐"]')?.matches(':open') === true`,
    '时值对齐原生菜单首次展开',
  )
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
    const localY = ${pianoRollHeaderHeight} + (${pianoRollMaxMidi} - ${midiNote}) * ${pianoRollRowHeight} + 10;
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
    const localY = ${pianoRollHeaderHeight} + (${pianoRollMaxMidi} - ${midiNote}) * ${pianoRollRowHeight} + 10;
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
    const clientY = rect.top + ${pianoRollHeaderHeight} + (${pianoRollMaxMidi} - ${midiNote}) * ${pianoRollRowHeight} + 10;
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

async function verifyChordTrackEditing(projectPath) {
  await clickButton('铅笔工具（2）')
  const draw = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const lane = document.querySelector('.chord-lane');
    if (!roll || !lane) return null;
    roll.scrollLeft = 0;
    lane.setPointerCapture = () => {};
    lane.releasePointerCapture = () => {};
    lane.hasPointerCapture = () => true;
    const rect = lane.getBoundingClientRect();
    const startX = rect.left + 58 + (1920 / 960) * 72 + 3;
    const endX = rect.left + 58 + (2880 / 960) * 72 - 3;
    const clientY = rect.top + 20;
    lane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 30, clientX: startX, clientY, button: 0 }));
    return { startX, endX, clientY };
  })()`)
  if (!draw) throw new Error('无法开始绘制和弦区域')
  await evaluate(`document.querySelector('.chord-lane').dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerId: 30, clientX: ${draw.endX}, clientY: ${draw.clientY}, button: 0, buttons: 1,
  }))`)
  await evaluate(`document.querySelector('.chord-lane').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 30, clientX: ${draw.endX}, clientY: ${draw.clientY}, button: 0,
  }))`)
  await waitFor(`document.querySelectorAll('.chord-block:not(.chord-preview)').length === 1 && Boolean(document.querySelector('.chord-palette'))`, '绘制和弦范围并打开调色盘')
  const firstLabel = await evaluate(`document.querySelector('.chord-label')?.textContent`)
  if (firstLabel !== 'I') throw new Error(`和弦名称未由系统计算：${firstLabel}`)

  await clickPaletteOption('功能', 'D')
  await clickPaletteOption('形态', '七和弦')
  await clickPaletteOption('转位', '一转')
  await clickPaletteOption('离调目标', 'SII')
  await waitFor(`document.querySelector('.chord-label')?.textContent === 'V6/5/II'`, '调色盘更新和弦名称')
  const shortcutIsolated = await evaluate(`(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true }));
    return document.querySelector('button[aria-label^="铅笔工具"]')?.classList.contains('is-active') === true;
  })()`)
  if (!shortcutIsolated) throw new Error('和弦调色盘按键泄漏到编辑器快捷键')
  await evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`)
  await waitFor(`!document.querySelector('.chord-palette')`, '关闭和弦调色盘')

  await clickButton('选择工具（1）')
  const reopened = await evaluate(`(() => {
    const lane = document.querySelector('.chord-lane');
    const block = document.querySelector('.chord-block:not(.chord-preview)');
    if (!lane || !block) return false;
    const rect = block.getBoundingClientRect();
    lane.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0,
    }));
    return true;
  })()`)
  if (!reopened) throw new Error('无法双击和弦区域')
  await waitFor(`document.querySelector('.chord-palette')?.textContent.includes('V6/5/II')`, '双击重新打开和弦调色盘')
  await clickButton('关闭和弦设置')

  const move = await evaluate(`(() => {
    const lane = document.querySelector('.chord-lane');
    const block = document.querySelector('.chord-block:not(.chord-preview)');
    if (!lane || !block) return null;
    const rect = block.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const endX = startX + 36;
    const clientY = rect.top + rect.height / 2;
    lane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 31, clientX: startX, clientY, button: 0 }));
    return { startX, endX, clientY };
  })()`)
  if (!move) throw new Error('无法选择和弦区域')
  await evaluate(`document.querySelector('.chord-lane').dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerId: 31, clientX: ${move.endX}, clientY: ${move.clientY}, button: 0, buttons: 1,
  }))`)
  await evaluate(`document.querySelector('.chord-lane').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 31, clientX: ${move.endX}, clientY: ${move.clientY}, button: 0,
  }))`)
  await delay(100)

  const resize = await evaluate(`(() => {
    const lane = document.querySelector('.chord-lane');
    const block = document.querySelector('.chord-block:not(.chord-preview)');
    if (!lane || !block) return null;
    const rect = block.getBoundingClientRect();
    const startX = rect.right - 2;
    const endX = startX + 36;
    const clientY = rect.top + rect.height / 2;
    lane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 32, clientX: startX, clientY, button: 0 }));
    return { startX, endX, clientY };
  })()`)
  if (!resize) throw new Error('无法缩放和弦区域')
  await evaluate(`document.querySelector('.chord-lane').dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerId: 32, clientX: ${resize.endX}, clientY: ${resize.clientY}, button: 0, buttons: 1,
  }))`)
  await evaluate(`document.querySelector('.chord-lane').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 32, clientX: ${resize.endX}, clientY: ${resize.clientY}, button: 0,
  }))`)
  await delay(100)
  await clickButton('保存')
  await evaluate(`document.querySelector('.piano-roll')?.focus()`)
  await dispatchShortcut('Home')
  await dispatchShortcut('PageDown')
  await dispatchShortcut('PageDown')
  await evaluate(`(() => {
    const button = document.querySelectorAll('.loop-boundary')[1];
    button?.click();
  })()`)
  await dispatchShortcut('Home')
  await dispatchShortcut('PageDown')
  await evaluate(`(() => {
    const button = document.querySelectorAll('.loop-boundary')[0];
    button?.click();
  })()`)
  await delay(120)
  await clickButton('保存')
  const saved = JSON.parse(await readFile(projectPath, 'utf8'))
  const region = saved.chordTrack?.regions?.[0]
  const interpretation = region?.semantics?.interpretations?.find(
    (candidate) => candidate.id === region?.semantics?.primaryInterpretationId,
  )
  if (saved.schemaVersion !== 3
    || saved.loop?.enabled !== false
    || saved.loop?.startTick !== 3840
    || saved.loop?.endTick !== 7680
    || region?.startTick !== 2400
    || region?.durationTicks !== 1440
    || region?.identity?.structure?.quality !== 'dominant7'
    || region?.identity?.bass?.step !== 'C'
    || region?.identity?.bass?.alter !== 1
    || interpretation?.degree !== 5
    || interpretation?.appliedTarget?.degree !== 2
    || interpretation?.designation?.kind !== 'applied-dominant'
    || interpretation?.designation?.primaryFunction !== 'dominant'
    || 'label' in region) {
    throw new Error(`和弦范围保存结果错误：${JSON.stringify({ schemaVersion: saved.schemaVersion, region })}`)
  }

  await clickButton('切分工具（4）')
  const split = await evaluate(`(() => {
    const lane = document.querySelector('.chord-lane');
    const block = document.querySelector('.chord-block:not(.chord-preview)');
    if (!lane || !block) return false;
    const rect = block.getBoundingClientRect();
    lane.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId: 33, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0,
    }));
    return true;
  })()`)
  if (!split) throw new Error('无法切分和弦区域')
  await waitFor(`document.querySelectorAll('.chord-block:not(.chord-preview)').length === 2`, '切分和弦区域')

  await clickButton('擦除工具（3）')
  const erasedDuringPointer = await evaluate(`(() => {
    const lane = document.querySelector('.chord-lane');
    const block = document.querySelector('.chord-block:not(.chord-preview)');
    if (!lane || !block) return null;
    const rect = block.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    lane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 34, clientX, clientY, button: 0 }));
    return { clientX, clientY };
  })()`)
  if (!erasedDuringPointer) throw new Error('无法擦除和弦区域')
  await waitFor(`document.querySelectorAll('.chord-block:not(.chord-preview)').length === 1`, '和弦擦除实时预览')
  await evaluate(`document.querySelector('.chord-lane').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 34, clientX: ${erasedDuringPointer.clientX}, clientY: ${erasedDuringPointer.clientY}, button: 0,
  }))`)
  await clickButton('撤销')
  await waitFor(`document.querySelectorAll('.chord-block:not(.chord-preview)').length === 2`, '撤销和弦擦除')

  await clickButton('选择工具（1）')
  const selectedFirst = await evaluate(`(() => {
    const lane = document.querySelector('.chord-lane');
    const block = document.querySelectorAll('.chord-block:not(.chord-preview)')[0];
    if (!lane || !block) return false;
    const rect = block.getBoundingClientRect();
    const options = { bubbles: true, pointerId: 35, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
    lane.dispatchEvent(new PointerEvent('pointerdown', options));
    lane.dispatchEvent(new PointerEvent('pointerup', options));
    return true;
  })()`)
  if (!selectedFirst) throw new Error('无法选择第一个和弦区域')
  await delay(80)
  await evaluate(`(() => {
    const lane = document.querySelector('.chord-lane');
    const block = document.querySelectorAll('.chord-block:not(.chord-preview)')[1];
    const rect = block.getBoundingClientRect();
    const options = { bubbles: true, pointerId: 36, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0, shiftKey: true };
    lane.dispatchEvent(new PointerEvent('pointerdown', options));
    lane.dispatchEvent(new PointerEvent('pointerup', options));
  })()`)
  await waitFor(`document.body.innerText.includes('已选择 2 个和弦区域')`, '和弦追加多选')
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, bubbles: true }))`)
  await evaluate(`(() => {
    const ruler = document.querySelector('.ruler-lane');
    const rect = ruler.getBoundingClientRect();
    ruler.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, clientX: rect.left + 58 + (4800 / 960) * 72, clientY: rect.top + 12, button: 0,
    }));
  })()`)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true }))`)
  await waitFor(`document.querySelectorAll('.chord-block:not(.chord-preview)').length === 4`, '批量粘贴和弦区域')
  await clickButton('撤销')
  await waitFor(`document.querySelectorAll('.chord-block:not(.chord-preview)').length === 2`, '撤销批量粘贴')
  await clickButton('铅笔工具（2）')
  await clickButton('保存')
}

async function verifySelectionAndMovePreview() {
  await clickButton('停止')
  await assertSilence(100, '单选前')
  await clickButton('选择工具（1）')
  const pointer = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const canvas = document.querySelector('.roll-canvas');
    if (!roll || !canvas) return null;
    const localY = ${pianoRollHeaderHeight} + (${pianoRollMaxMidi} - 72) * ${pianoRollRowHeight} + 10;
    roll.scrollTop = Math.max(0, localY - 180);
    roll.scrollLeft = 0;
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + 58 + 17;
    const clientY = rect.top + localY;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 20, clientX, clientY, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 20, clientX, clientY, button: 0 }));
    return { clientX, clientY };
  })()`)
  if (!pointer) throw new Error('无法定位单选预听音符')
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) > 0.001`, '单选音符预听')

  await delay(450)
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) <= 0.001`, '单选预听结束')
  await evaluate(`document.querySelector('.roll-canvas').dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, pointerId: 21, clientX: ${pointer.clientX}, clientY: ${pointer.clientY}, button: 0,
  }))`)
  await delay(450)
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) <= 0.001`, '移动前预听结束')
  await evaluate(`document.querySelector('.roll-canvas').dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerId: 21, clientX: ${pointer.clientX}, clientY: ${pointer.clientY - 22}, button: 0, buttons: 1,
  }))`)
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) > 0.001`, '单音移动预听')
  await evaluate(`document.querySelector('.roll-canvas').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 21, clientX: ${pointer.clientX}, clientY: ${pointer.clientY - 22}, button: 0,
  }))`)
  await delay(100)
  await clickButton('停止')
  await clickButton('撤销')

  const multiSelected = await evaluate(`(() => {
    const canvas = document.querySelector('.roll-canvas');
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + 58 + (480 / 960) * 72 + 17;
    const clientY = rect.top + ${pianoRollHeaderHeight} + (${pianoRollMaxMidi} - 74) * ${pianoRollRowHeight} + 10;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 22, clientX, clientY, button: 0, shiftKey: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 22, clientX, clientY, button: 0, shiftKey: true }));
    return true;
  })()`)
  if (!multiSelected) throw new Error('无法建立多音符选择')
  await assertSilence(300, '多选音符')
  await clickButton('铅笔工具（2）')
}

async function verifyLiveErase() {
  await clickButton('擦除工具（3）')
  const target = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    if (!roll) return null;
    const localX = 58 + 17;
    const localY = ${pianoRollHeaderHeight} + (${pianoRollMaxMidi} - 72) * ${pianoRollRowHeight} + 10;
    roll.scrollTop = Math.max(0, localY - 180);
    roll.scrollLeft = 0;
    return { localX, localY };
  })()`)
  if (!target) throw new Error('无法定位实时擦除音符')
  await delay(100)
  const pointer = await evaluate(`(() => {
    const canvas = document.querySelector('.roll-canvas');
    const viewportCanvas = document.querySelector('.roll-viewport-canvas');
    if (!canvas || !viewportCanvas) return null;
    const localX = ${target.localX};
    const localY = ${target.localY};
    const rect = canvas.getBoundingClientRect();
    const viewportRect = viewportCanvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const clientX = rect.left + localX;
    const clientY = rect.top + localY;
    const pixelX = Math.round((clientX - viewportRect.left) * ratio);
    const pixelY = Math.round((clientY - viewportRect.top) * ratio);
    const before = [...viewportCanvas.getContext('2d').getImageData(pixelX, pixelY, 1, 1).data];
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 23, clientX, clientY, button: 0 }));
    return { clientX, clientY, pixelX, pixelY, before };
  })()`)
  if (!pointer) throw new Error('无法开始实时擦除验证')
  await delay(100)
  const during = await evaluate(`(() => {
    const canvas = document.querySelector('.roll-viewport-canvas');
    return [...canvas.getContext('2d').getImageData(
      ${pointer.pixelX}, ${pointer.pixelY}, 1, 1,
    ).data];
  })()`)
  if (JSON.stringify(pointer.before) === JSON.stringify(during)) throw new Error('擦除按下后音符画面未实时更新')
  await evaluate(`document.querySelector('.roll-canvas').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 23, clientX: ${pointer.clientX}, clientY: ${pointer.clientY}, button: 0,
  }))`)
  await delay(100)
  await clickButton('撤销')
  await clickButton('铅笔工具（2）')
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

async function dispatchShortcut(code, options = {}) {
  const keyByCode = {
    ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp',
    Backspace: 'Backspace', BracketLeft: '[', BracketRight: ']', Delete: 'Delete', End: 'End',
    Equal: '=', Escape: 'Escape', Home: 'Home', Minus: '-', PageDown: 'PageDown', PageUp: 'PageUp',
    Space: ' ', Tab: 'Tab',
  }
  const key = options.key ?? keyByCode[code] ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code)
  await evaluate(`(() => {
    const target = document.activeElement ?? window;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: ${JSON.stringify(code)},
      key: ${JSON.stringify(key)},
      ctrlKey: ${Boolean(options.ctrlKey)},
      altKey: ${Boolean(options.altKey)},
      shiftKey: ${Boolean(options.shiftKey)},
    }));
  })()`)
  await delay(options.delay ?? 80)
}

async function releaseModifier(code, key) {
  await evaluate(`(document.activeElement ?? window).dispatchEvent(new KeyboardEvent('keyup', {
    bubbles: true, cancelable: true, code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)},
  }))`)
  await delay(60)
}

async function verifyShortcutSettings() {
  await clickButton('设置')
  await waitFor(`Boolean(document.querySelector('.settings-dialog'))`, '快捷键设置页打开')
  await clickButton('快捷键')
  const tabCount = await evaluate(`document.querySelectorAll('.settings-tabs button').length`)
  if (tabCount !== 4) throw new Error(`设置页选项卡数量错误：${tabCount}`)
  const dialogLayout = await evaluate(`(() => {
    const dialog = document.querySelector('.settings-dialog');
    const content = document.querySelector('.shortcut-settings-content');
    const row = document.querySelector('.shortcut-row');
    if (!dialog || !content || !row) return null;
    const dialogRect = dialog.getBoundingClientRect();
    return {
      dialog: { left: dialogRect.left, top: dialogRect.top, right: dialogRect.right, bottom: dialogRect.bottom },
      contentOverflow: content.scrollWidth - content.clientWidth,
      rowOverflow: row.scrollWidth - row.clientWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  })()`)
  if (!dialogLayout
    || dialogLayout.dialog.left < 0
    || dialogLayout.dialog.top < 0
    || dialogLayout.dialog.right > dialogLayout.viewport.width
    || dialogLayout.dialog.bottom > dialogLayout.viewport.height
    || dialogLayout.contentOverflow > 1
    || dialogLayout.rowOverflow > 1) {
    throw new Error(`快捷键设置页布局溢出：${JSON.stringify(dialogLayout)}`)
  }

  await evaluate(`document.querySelector('[aria-label="修改“选择工具”快捷键"]')?.click()`)
  await delay(60)
  await dispatchShortcut('Digit5')
  await waitFor(`document.querySelector('button[aria-label^="选择工具（5）"]') !== null`, '快捷键重映射更新工具提示')
  const persistedBinding = await evaluate(`JSON.parse(localStorage.getItem('satb-master-shortcuts-v1')).selectTool`)
  if (JSON.stringify(persistedBinding) !== JSON.stringify(['Digit5'])) {
    throw new Error(`快捷键重映射未持久化：${JSON.stringify(persistedBinding)}`)
  }
  await clickButton('关闭设置')
  await dispatchShortcut('Digit5')
  const remapped = await evaluate(`document.querySelector('button[aria-label^="选择工具"]')?.classList.contains('is-active') === true`)
  if (!remapped) throw new Error('重映射后的选择工具快捷键未生效')

  await clickButton('设置')
  await clickButton('快捷键')
  await evaluate(`document.querySelector('[aria-label="修改“铅笔工具”快捷键"]')?.click()`)
  await delay(60)
  await dispatchShortcut('Digit5')
  await waitFor(`document.querySelector('.shortcut-capture-error')?.textContent?.includes('选择工具') === true`, '快捷键冲突提示')
  await dispatchShortcut('Escape')
  const resetAll = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.shortcut-settings-toolbar button')].find((item) => item.textContent?.includes('恢复默认'));
    button?.click();
    return Boolean(button);
  })()`)
  if (!resetAll) throw new Error('无法恢复默认快捷键')
  await delay(100)
  await clickButton('关闭设置')
  await waitFor(`document.querySelector('button[aria-label^="选择工具（1）"]') !== null`, '工具快捷键恢复默认')
}

async function configureHarmonyRuleSeverity() {
  await clickButton('设置')
  await clickButton('检查规则')
  await waitFor(`document.querySelectorAll('.rule-row').length === 69`, '列出全部检查规则')
  await selectRuleByKey('builtin:voice-leading.parallel-fifths')
  const layout = await evaluate(`(() => {
    const content = document.querySelector('.rule-settings-content');
    const row = document.querySelector('.rule-row');
    return content && row ? {
      contentOverflow: content.scrollWidth - content.clientWidth,
      rowOverflow: row.scrollWidth - row.clientWidth,
    } : null;
  })()`)
  if (!layout || layout.contentOverflow > 1 || layout.rowOverflow > 1) {
    throw new Error(`检查规则设置页布局溢出：${JSON.stringify(layout)}`)
  }
  const changed = await evaluate(`(() => {
    const select = document.querySelector('select[aria-label="设置“平行或反向纯五度”严重程度"]');
    if (!select) return false;
    select.value = 'suggestion';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
  if (!changed) throw new Error('无法修改平行或反向纯五度严重程度')
  await waitFor(`document.querySelector('select[aria-label="设置“平行或反向纯五度”严重程度"]')?.value === 'suggestion'`, '检查规则严重度更新')
  await clickButton('关闭设置')
}

async function verifyExternalRuleSandbox() {
  await clickButton('设置')
  await clickButton('检查规则')
  await clickButton('导入外置规则包')
  await waitFor(
    `document.querySelector(${JSON.stringify(`[data-rule-key="external:org.satbmaster.e2e@1.0.0:${externalRuleHash}:phase-c-e2e"]`)}) !== null`,
    '外置规则包导入并挂载',
    15_000,
  )
  await waitForFile(
    path.join(e2eDirectory, 'user-data', 'rule-library', `${externalRuleHash}.satb-rule.js`),
    '外置规则私有副本',
  )
  await selectRuleByKey('external:org.satbmaster.e2e@1.0.0:' + externalRuleHash + ':phase-c-e2e')
  const mounted = await evaluate(`(() => {
    const checkbox = document.querySelector('input[aria-label="启用外置规则“Phase C E2E 规则”"]');
    return Boolean(checkbox?.checked);
  })()`)
  if (!mounted) throw new Error('外置规则未以启用状态挂载到工程')
  await clickButton('关闭设置')
  await waitFor(`document.body.innerText.includes('Phase C 外置规则已运行')`, 'QuickJS 外置诊断归并', 15_000)

  await clickButton('设置')
  await clickButton('检查规则')
  await selectRuleByKey('external:org.satbmaster.e2e@1.0.0:' + externalRuleHash + ':phase-c-e2e')
  const disabled = await evaluate(`(() => {
    const checkbox = document.querySelector('input[aria-label="启用外置规则“Phase C E2E 规则”"]');
    if (!checkbox) return false;
    if (checkbox.checked) checkbox.click();
    return !checkbox.checked;
  })()`)
  if (!disabled) throw new Error('无法关闭外置规则')
  await clickButton('关闭设置')
  await waitFor(`!document.body.innerText.includes('Phase C 外置规则已运行')`, '关闭外置规则后移除诊断')

  await clickButton('设置')
  await clickButton('检查规则')
  await selectRuleByKey('external:org.satbmaster.e2e@1.0.0:' + externalRuleHash + ':phase-c-e2e')
  await evaluate(`(() => {
    const checkbox = document.querySelector('input[aria-label="启用外置规则“Phase C E2E 规则”"]');
    if (!checkbox.checked) checkbox.click();
  })()`)
  await clickButton('移除规则包“org.satbmaster.e2e”的本机副本')
  await clickButton('移除')
  await waitFor(
    `document.querySelector('.rule-unimplemented-badge')?.textContent?.includes('未挂载') && window.desktop.ruleLibrary.list().then((items) => items.length === 0)`,
    '移除本机副本但保留工程引用',
  )
  await clickButton('导入外置规则包')
  await waitFor(`window.desktop.ruleLibrary.list().then((items) => items.length === 1 && !document.querySelector('.rule-unimplemented-badge'))`, '重新挂载匹配规则包', 15_000)
  await clickButton('关闭设置')
  await waitFor(`document.body.innerText.includes('Phase C 外置规则已运行')`, '重新导入后恢复外置诊断', 15_000)
}

async function verifyHarmonyRuleSeverityApplication() {
  await waitFor(`(() => {
    const item = [...document.querySelectorAll('.diagnostic-item')].find((candidate) => candidate.textContent?.includes('平行或反向纯五度'));
    return item?.classList.contains('suggestion') === true && document.querySelector('.bottom-panel-context')?.textContent?.includes('个建议');
  })()`, '平行或反向纯五度改为建议')

  await clickButton('设置')
  await clickButton('检查规则')
  await selectRuleByKey('builtin:voice-leading.parallel-fifths')
  await evaluate(`(() => {
    const select = document.querySelector('select[aria-label="设置“平行或反向纯五度”严重程度"]');
    select.value = 'off';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await clickButton('关闭设置')
  await waitFor(`![...document.querySelectorAll('.diagnostic-item')].some((item) => item.textContent?.includes('平行或反向纯五度'))`, '严重度为无时关闭规则')

  await clickButton('设置')
  await clickButton('检查规则')
  await selectRuleByKey('builtin:voice-leading.parallel-fifths')
  await clickButton('恢复“平行或反向纯五度”默认严重程度')
  await clickButton('关闭设置')
  await waitFor(`(() => {
    const item = [...document.querySelectorAll('.diagnostic-item')].find((candidate) => candidate.textContent?.includes('平行或反向纯五度'));
    return item?.classList.contains('error') === true;
  })()`, '恢复平行或反向纯五度默认严重度')
}

async function verifyEditorShortcutGestures() {
  await clickButton('选择工具（1）')
  await evaluate(`document.querySelector('.piano-roll')?.focus()`)
  await dispatchShortcut('ControlLeft', { key: 'Control', ctrlKey: true })
  const controlTool = await evaluate(`document.querySelector('.roll-canvas')?.classList.contains('tool-pencil') === true`)
  if (!controlTool) throw new Error('按住 Ctrl 未临时切换到铅笔工具')
  await releaseModifier('ControlLeft', 'Control')
  const restoredSelect = await evaluate(`document.querySelector('.roll-canvas')?.classList.contains('tool-select') === true`)
  if (!restoredSelect) throw new Error('松开 Ctrl 后未恢复选择工具')

  await dispatchShortcut('AltLeft', { key: 'Alt', altKey: true })
  const altTool = await evaluate(`document.querySelector('.roll-canvas')?.classList.contains('tool-eraser') === true`)
  if (!altTool) throw new Error('按住 Alt 未临时切换到擦除工具')
  await releaseModifier('AltLeft', 'Alt')

  await dispatchShortcut('ControlLeft', { key: 'Control', ctrlKey: true })
  await dispatchShortcut('AltLeft', { key: 'Alt', ctrlKey: true, altKey: true })
  const modifierPriority = await evaluate(`document.querySelector('.roll-canvas')?.classList.contains('tool-eraser') === true`)
  if (!modifierPriority) throw new Error('Ctrl+Alt 未按 Alt 优先使用擦除工具')
  await evaluate(`window.dispatchEvent(new Event('blur'))`)
  await delay(80)
  const blurRestored = await evaluate(`document.querySelector('.roll-canvas')?.classList.contains('tool-select') === true`)
  if (!blurRestored) throw new Error('窗口失焦后临时工具未复原')

  await evaluate(`document.querySelector('.piano-roll')?.focus()`)
  await dispatchShortcut('Tab')
  const nextVoice = await evaluate(`document.querySelectorAll('.voice-track')[1]?.classList.contains('is-active') === true`)
  if (!nextVoice) throw new Error('Tab 未切换到下一声部')
  await dispatchShortcut('Tab', { shiftKey: true })
  const previousVoice = await evaluate(`document.querySelectorAll('.voice-track')[0]?.classList.contains('is-active') === true`)
  if (!previousVoice) throw new Error('Shift+Tab 未反向切换声部')

  const zoom = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    if (!roll) return null;
    roll.scrollLeft = 240;
    const rect = roll.getBoundingClientRect();
    const viewportX = Math.min(520, rect.width - 80);
    const beforeTick = ((roll.scrollLeft + viewportX - 58) / 72) * 960;
    return {
      beforeTick,
      viewportX,
      x: rect.left + viewportX,
      y: rect.top + Math.min(160, rect.height / 2),
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth,
    };
  })()`)
  if (!zoom) throw new Error('无法定位时间轴缩放锚点')
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: zoom.x,
    y: zoom.y,
    deltaX: 0,
    deltaY: -100,
    modifiers: 2,
  })
  await delay(120)
  const zoomed = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const pixels = Number(document.querySelector('.zoom-value')?.textContent);
    return {
      pixels,
      afterTick: ((roll.scrollLeft + ${zoom.viewportX} - 58) / pixels) * 960,
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth,
    };
  })()`)
  if (zoomed.pixels !== 82
    || Math.abs(zoomed.afterTick - zoom.beforeTick) > 2
    || zoomed.devicePixelRatio !== zoom.devicePixelRatio
    || zoomed.innerWidth !== zoom.innerWidth) {
    throw new Error(`Ctrl+滚轮锚点缩放错误：${JSON.stringify({ zoom, zoomed })}`)
  }
  await dispatchShortcut('Minus', { ctrlKey: true })
  await waitFor(`document.querySelector('.zoom-value')?.textContent?.trim() === '72'`, '键盘缩小时间轴')
  await dispatchShortcut('Equal', { ctrlKey: true })
  await waitFor(`document.querySelector('.zoom-value')?.textContent?.trim() === '82'`, '键盘放大时间轴')
  await dispatchShortcut('Minus', { ctrlKey: true })
  await waitFor(`document.querySelector('.zoom-value')?.textContent?.trim() === '72'`, '键盘恢复时间轴缩放')

  const horizontalWheelTarget = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    roll.scrollLeft = 300;
    const rect = roll.getBoundingClientRect();
    return { x: rect.left + Math.min(300, rect.width / 2), y: rect.top + Math.min(160, rect.height / 2) };
  })()`)
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: horizontalWheelTarget.x,
    y: horizontalWheelTarget.y,
    deltaX: 0,
    deltaY: 120,
    modifiers: 8,
  })
  await delay(100)
  const horizontal = await evaluate(`document.querySelector('.piano-roll').scrollLeft`)
  if (horizontal < 415 || horizontal > 425) throw new Error(`Shift+滚轮横向滚动量错误：${horizontal}`)

  const trackpadWheelTarget = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    roll.scrollLeft = 300;
    const rect = roll.getBoundingClientRect();
    return { x: rect.left + Math.min(300, rect.width / 2), y: rect.top + Math.min(160, rect.height / 2) };
  })()`)
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: trackpadWheelTarget.x,
    y: trackpadWheelTarget.y,
    deltaX: 72,
    deltaY: 0,
  })
  await delay(100)
  const trackpadHorizontal = await evaluate(`document.querySelector('.piano-roll').scrollLeft`)
  if (trackpadHorizontal < 367 || trackpadHorizontal > 377) {
    throw new Error(`原生触控板横向滚动量错误：${trackpadHorizontal}`)
  }

  await evaluate(`document.querySelector('.piano-roll')?.focus()`)
  await dispatchShortcut('BracketRight')
  await waitFor(`document.querySelector('select[aria-label="时值对齐"]')?.value === '240'`, '快捷键细化吸附网格')
  await dispatchShortcut('BracketLeft')
  await waitFor(`document.querySelector('select[aria-label="时值对齐"]')?.value === '480'`, '快捷键加粗吸附网格')

  await dispatchShortcut('Home')
  await waitFor(`document.querySelector('.timeline-playhead-segment')?.style.left === '58px'`, 'Home 回到开头')
  await dispatchShortcut('PageDown')
  await waitFor(`document.querySelector('.timeline-playhead-segment')?.style.left === '346px'`, 'PageDown 下一小节')
  await dispatchShortcut('PageUp')
  await waitFor(`document.querySelector('.timeline-playhead-segment')?.style.left === '58px'`, 'PageUp 上一小节')
  await dispatchShortcut('End')
  const endLeft = await evaluate(`Number.parseFloat(document.querySelector('.timeline-playhead-segment')?.style.left)`)
  if (Math.abs(endLeft - 4_666) > 0.1) throw new Error(`End 工程末尾定位错误：${endLeft}`)
  await dispatchShortcut('PageUp')
  await waitFor(`document.querySelector('.timeline-playhead-segment')?.style.left === '4378px'`, '工程末尾 PageUp 回到最后小节')
  await dispatchShortcut('Home')

  await dispatchShortcut('Digit2')
  const pendingDraw = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const canvas = document.querySelector('.roll-canvas');
    const localY = ${pianoRollHeaderHeight} + (${pianoRollMaxMidi} - 72) * ${pianoRollRowHeight} + 10;
    roll.scrollLeft = 0;
    roll.scrollTop = Math.max(0, localY - 180);
    const rect = canvas.getBoundingClientRect();
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    canvas.hasPointerCapture = () => true;
    const clientX = rect.left + 58 + 6;
    const clientY = rect.top + localY;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 41, clientX, clientY, button: 0 }));
    return { clientX, clientY };
  })()`)
  await delay(100)
  await dispatchShortcut('Escape')
  await evaluate(`document.querySelector('.roll-canvas').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 41, clientX: ${pendingDraw.clientX}, clientY: ${pendingDraw.clientY}, button: 0,
  }))`)
  await delay(80)
}

async function verifySelectionShortcuts(projectPath) {
  await evaluate(`document.querySelector('.piano-roll')?.focus()`)
  await dispatchShortcut('KeyA', { ctrlKey: true })
  await dispatchShortcut('KeyA', { ctrlKey: true, shiftKey: true })
  await dispatchShortcut('KeyX', { ctrlKey: true })
  await clickButton('保存')
  const cleared = JSON.parse(await readFile(projectPath, 'utf8'))
  const clearedCount = cleared.satbTracks.reduce((count, track) => count + track.notes.length, 0)
  if (clearedCount !== 8) throw new Error(`Ctrl+Shift+A 未清除选择：${clearedCount}`)

  await dispatchShortcut('KeyA', { ctrlKey: true })
  await dispatchShortcut('Escape')
  await dispatchShortcut('KeyX', { ctrlKey: true })
  await clickButton('保存')
  const escaped = JSON.parse(await readFile(projectPath, 'utf8'))
  const escapedCount = escaped.satbTracks.reduce((count, track) => count + track.notes.length, 0)
  if (escapedCount !== 8) throw new Error(`Esc 未清除选择：${escapedCount}`)

  await dispatchShortcut('KeyA', { ctrlKey: true })
  await dispatchShortcut('KeyD', { ctrlKey: true })
  await clickButton('保存')
  const duplicated = JSON.parse(await readFile(projectPath, 'utf8'))
  const duplicateCount = duplicated.satbTracks.reduce((count, track) => count + track.notes.length, 0)
  if (duplicateCount !== 16) throw new Error(`Ctrl+A / Ctrl+D 批量重复错误：${duplicateCount}`)
  await clickButton('撤销')

  await dispatchShortcut('KeyA', { ctrlKey: true })
  await dispatchShortcut('KeyX', { ctrlKey: true })
  await clickButton('保存')
  const cut = JSON.parse(await readFile(projectPath, 'utf8'))
  const cutCount = cut.satbTracks.reduce((count, track) => count + track.notes.length, 0)
  if (cutCount !== 0) throw new Error(`Ctrl+X 未剪切全部音符：${cutCount}`)
  await dispatchShortcut('Home')
  await dispatchShortcut('KeyV', { ctrlKey: true })
  await clickButton('保存')
  const pasted = JSON.parse(await readFile(projectPath, 'utf8'))
  const pastedCount = pasted.satbTracks.reduce((count, track) => count + track.notes.length, 0)
  if (pastedCount !== 8) throw new Error(`剪切后 Ctrl+V 恢复音符错误：${pastedCount}`)
}

async function verifyDoubleClickVoiceActivation() {
  await clickButton('选择工具（1）')
  const activated = await evaluate(`(() => {
    const roll = document.querySelector('.piano-roll');
    const canvas = document.querySelector('.roll-canvas');
    const localY = ${pianoRollHeaderHeight} + (${pianoRollMaxMidi} - 72) * ${pianoRollRowHeight} + 10;
    roll.scrollLeft = 0;
    roll.scrollTop = Math.max(0, localY - 180);
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, clientX: rect.left + 58 + 12, clientY: rect.top + localY, button: 0,
    }));
    return true;
  })()`)
  if (!activated) throw new Error('无法双击非当前声部音符')
  await delay(100)
  const sopranoActive = await evaluate(`document.querySelectorAll('.voice-track')[0]?.classList.contains('is-active') === true`)
  if (!sopranoActive) throw new Error('双击非当前声部音符未切换当前声部')
}

async function verifySponsorDialog() {
  await clickButton('赞助作者')
  await waitFor(`(() => {
    const dialog = document.querySelector('.sponsor-dialog[role="dialog"]');
    const image = dialog?.querySelector('.sponsor-qr');
    return Boolean(dialog && image?.complete && image.naturalWidth > 0);
  })()`, '赞助二维码加载')
  const layout = await evaluate(`(() => {
    const dialog = document.querySelector('.sponsor-dialog');
    const image = document.querySelector('.sponsor-qr');
    const rect = dialog.getBoundingClientRect();
    return {
      source: image.getAttribute('src'),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    };
  })()`)
  if (
    layout.source !== './assets/sponsor-alipay.jpg' ||
    layout.naturalWidth <= 0 ||
    layout.naturalHeight <= 0 ||
    !layout.insideViewport
  ) {
    throw new Error(`赞助二维码资源或布局错误：${JSON.stringify(layout)}`)
  }
  await dispatchShortcut('Escape')
  await waitFor(`!document.querySelector('.sponsor-dialog')`, '关闭赞助二维码')
  const focusRestored = await evaluate(`document.activeElement?.getAttribute('aria-label') === '赞助作者'`)
  if (!focusRestored) throw new Error('关闭赞助二维码后未恢复入口焦点')
}

try {
  const debuggerUrl = await waitForTarget()
  client = new CdpClient(debuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await waitFor(`document.readyState === 'complete' && document.body.innerText.includes('未命名练习')`, '应用首屏')
  await waitFor(`window.desktop.windowControls.isFocused().then((focused) => focused && document.hasFocus())`, '应用首屏原生窗口与网页焦点')
  await waitFor(`document.body.innerText.includes('恢复未保存内容')`, '启动恢复提示')
  await clickButton(recoveryChoice === 'recover' ? '恢复内容' : '不恢复')
  if (recoveryChoice === 'recover') {
    await waitFor(`document.body.innerText.includes('E2E 恢复焦点测试')`, '确认恢复内容')
  } else {
    await waitFor(`window.desktop.project.recovery().then((result) => result.available === false)`, '确认放弃恢复内容')
  }
  await waitFor(`document.body.innerText.includes('SoundFont 已就绪')`, '应用启动时默认 SF2 预载', 20_000)
  await verifySponsorDialog()
  await verifyTimelineGuides()
  await verifyFullMidiRange()
  await verifyViewportCanvas()
  await verifyPanelResizing()
  await verifyPanelLayoutAfterRuleTestRoundTrip()
  await verifyRuleTestWorkbenchControls()
  await verifyInitialGridSelection()
  await verifyShortcutSettings()
  await configureHarmonyRuleSeverity()
  await verifyExternalRuleSandbox()
  await verifyEditorShortcutGestures()
  await waitFor(`Boolean(window.desktop?.windowControls) && Boolean(document.querySelector('button[aria-label="最大化"]'))`, '自定义窗口控件')
  await clickButton('最大化')
  await waitFor(`window.desktop.windowControls.isMaximized()`, '窗口最大化')
  await clickButton('还原')
  await waitFor(`window.desktop.windowControls.isMaximized().then((value) => !value)`, '窗口还原')

  await evaluate(`(() => {
    window.__satbE2eCanvasTexts = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.__satbE2eCanvasTexts.push(String(text));
      return original.call(this, text, ...args);
    };
  })()`)

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
  const canvasTexts = await evaluate('[...new Set(window.__satbE2eCanvasTexts)]')
  if (!canvasTexts.includes('C5') || !canvasTexts.includes('D5') || canvasTexts.includes('S')) {
    throw new Error(`音符块音高文字错误：${JSON.stringify(canvasTexts)}`)
  }
  await verifyHarmonyRuleSeverityApplication()
  await verifyDoubleClickVoiceActivation()
  await verifySelectionAndMovePreview()
  await verifyLiveErase()
  await middleDragCanvas()

  await dragDrawNote(0, 1_040, 1_520, 76)
  await clickButton('保存')
  const projectPath = path.join(e2eDirectory, 'project.satb')
  await waitForFile(projectPath, '拖绘工程保存')
  const migrationBackupPath = path.join(e2eDirectory, 'project.schema-v2-backup.satb')
  if (recoveryChoice === 'recover') {
    await waitForFile(migrationBackupPath, 'v2 迁移备份')
    const migrationBackup = JSON.parse(await readFile(migrationBackupPath, 'utf8'))
    if (migrationBackup.schemaVersion !== 2 || !Array.isArray(migrationBackup.tracks)) {
      throw new Error(`v2 迁移备份内容错误：${migrationBackupPath}`)
    }
  }
  const drawProject = JSON.parse(await readFile(projectPath, 'utf8'))
  const drawnNote = drawProject.satbTracks[0].notes.find((note) => note.startTick === 960 && midiOf(note) === 76)
  if (drawnNote?.durationTicks !== 960) throw new Error(`拖绘时值吸附错误：${drawnNote?.durationTicks}`)
  await clickButton('撤销')

  await addNote(0, 960, 76)
  await clickButton('选择工具（1）')
  await resizeNote(960, 480, 76, 1_500)
  await clickButton('保存')
  const resizeProject = JSON.parse(await readFile(projectPath, 'utf8'))
  const resizedNote = resizeProject.satbTracks[0].notes.find((note) => note.startTick === 960 && midiOf(note) === 76)
  if (resizedNote?.durationTicks !== 960) throw new Error(`缩放时值吸附错误：${resizedNote?.durationTicks}`)
  await clickButton('撤销')
  await clickButton('撤销')
  await clickButton('铅笔工具（2）')

  await clickButton('保存')
  await waitForFile(projectPath, '工程保存')
  await verifySelectionShortcuts(projectPath)
  await verifyChordTrackEditing(projectPath)
  const draftProject = JSON.parse(await readFile(projectPath, 'utf8'))
  const draftNotes = draftProject.satbTracks.map((track) => track.notes.map((note) => [note.startTick, midiOf(note)]))
  const expectedNotes = [[[0, 72], [480, 74]], [[0, 65], [480, 67]], [[0, 60], [480, 62]], [[0, 48], [480, 50]]]
  if (JSON.stringify(draftNotes) !== JSON.stringify(expectedNotes)) throw new Error('卷帘输入结果与预期不一致')
  await waitFor(`document.body.innerText.includes('平行或反向纯五度') && document.body.innerText.includes('平行或反向八度、同度')`, '和声规则诊断')
  await clickButton('撤销')
  await clickButton('重做')

  await clickButton('回到开头')
  await clickButton('播放')
  await waitFor(`document.querySelector('.engine-status')?.classList.contains('playing') === true`, '播放状态')
  await waitFor(`document.body.innerText.includes('SoundFont 已就绪')`, '默认 SF2 加载')
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) > 0.001`, '默认 SF2 实际音频输出')
  await clickButton('停止')

  const userSoundFontPath = appDirectory
    ? path.join(appDirectory, 'public', 'soundfonts', 'default.sf2')
    : path.join(path.dirname(executable), 'resources', 'soundfonts', 'default.sf2')
  const userSoundFont = await evaluate(`(async () => {
    const result = await window.desktop.soundFont.loadPath(${JSON.stringify(userSoundFontPath)});
    try {
      const [hash, response] = await Promise.all([
        window.desktop.soundFont.hash(result.token, () => {}),
        fetch(result.sourceUrl, { cache: 'no-store' }),
      ]);
      const buffer = await response.arrayBuffer();
      return { name: result.name, hash, byteLength: buffer.byteLength };
    } finally {
      await window.desktop.soundFont.release(result.token);
    }
  })()`)
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
  await waitFor(`Boolean(document.querySelector('.midi-export-form'))`, 'MIDI 导出选项')
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.export-format-tab')].find((item) => item.textContent.includes('MIDI 序列'));
    if (!tab) throw new Error('MIDI 格式选项卡缺失');
    tab.click();
  })()`)
  await waitFor(`document.querySelector('.export-format-tab[aria-selected="true"]')?.textContent.includes('MIDI 序列')`, '选择 MIDI 导出格式')
  await evaluate(`document.querySelector('.midi-export-form').requestSubmit()`)
  await waitFor(`document.body.innerText.includes('MIDI 已导出')`, 'MIDI 导出成功提示')
  await waitForFile(path.join(e2eDirectory, 'export.mid'), 'MIDI 导出完成')
  await waitFor(`!document.querySelector('.midi-export-dialog')`, '关闭 MIDI 导出选项')
  await evaluate(`document.querySelector('.piano-roll')?.focus()`)
  await dispatchShortcut('KeyN', { ctrlKey: true })
  await waitFor(`document.body.innerText.includes('0 个错误')`, '新建空工程')
  await clickButton('打开工程')
  await waitFor(`document.body.innerText.includes('平行或反向纯五度')`, '重新打开工程')
  await clickButton('播放')
  await waitFor(`document.body.innerText.includes('SoundFont 已就绪')`, '重开工程后恢复用户 SF2')
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) > 0.001`, '用户 SF2 实际音频输出')
  await clickButton('暂停')
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) <= 0.001`, '暂停后输出归零')
  await assertSilence(800, '暂停后的未来调度')

  const project = JSON.parse(await readFile(path.join(e2eDirectory, 'project.satb'), 'utf8'))
  const midi = parseMidi(new Uint8Array(await readFile(path.join(e2eDirectory, 'export.mid'))))
  const noteCount = [...project.satbTracks, ...project.auxiliaryTracks]
    .reduce((count, track) => count + track.notes.length, 0)
  const midiNoteOns = midi.tracks.flat().filter((event) => event.type === 'noteOn').length
  if (noteCount !== 8) throw new Error(`工程往返音符数错误：${noteCount}`)
  if (midi.header.format !== 1 || midi.tracks.length !== 6 || midiNoteOns !== 8) {
    throw new Error(`MIDI 往返结构错误：format=${midi.header.format} tracks=${midi.tracks.length} noteOns=${midiNoteOns}`)
  }

  await addNote(0, 960, 76)
  await waitFor(`Number(document.querySelector('.output-meter')?.getAttribute('aria-valuenow')) > 0.001`, '暂停后绘制音符预听')
  await waitFor(`window.desktop.project.recovery().then((result) => (
    result.available && result.project.satbTracks.reduce((count, track) => count + track.notes.length, 0) === 9
  ))`, '自动恢复写入', 8_000)
  await clickButton('保存')
  await waitFor(`window.desktop.project.recovery().then((result) => result.available === false)`, '显式保存后清理恢复文件')

  console.log(JSON.stringify({
    executable,
    defaultSoundFont: 'ready',
    startupDefaultSoundFont: 'preloaded',
    sponsorDialog: 'asset-focus-dismiss-ready',
    userSoundFontReload: 'path-hash-ready',
    audibleOutput: 'play-pause-preview-ready',
    selectionPreview: 'single-only-ready',
    liveErase: 'visual-before-commit-ready',
    noteLabels: 'pitch-ready',
    snapMode: 'floor-start-ceil-end',
    initialGridSelection: 'ready',
    initialWindowFocus: 'native-and-web-ready',
    middlePan: 'ready',
    customWindowFrame: 'ready',
    chordPalette: 'draw-edit-double-click-ready',
    timelineGuides: 'measure-lines-and-full-playhead-ready',
    pianoRollRange: 'midi-0-127-ready',
    viewportCanvas: 'bounded-allocation-ready',
    panelResizing: 'left-right-bottom-drag-and-reset-ready',
    shortcutSettings: 'remap-conflict-persist-reset-ready',
    harmonyRuleSettings: 'list-severity-disable-persist-reset-ready',
    externalRuleSandbox: 'private-library-quickjs-limits-mount-remove-ready',
    shortcutGestures: 'modifiers-voice-zoom-navigation-ready',
    selectionShortcuts: 'select-clear-duplicate-cut-paste-ready',
    doubleClickVoice: 'ready',
    panelRuleTestRoundTrip: 'size-preserved-and-resizable',
    projectNotes: noteCount,
    midiFormat: midi.header.format,
    midiTracks: midi.tracks.length,
    midiNoteOns,
    recoveryPrompt: `${recoveryChoice}-dropdown-ready`,
    recoveryLifecycle: 'write-read-clear',
    v2MigrationBackup: recoveryChoice === 'recover' ? path.basename(migrationBackupPath) : 'not-applicable',
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
