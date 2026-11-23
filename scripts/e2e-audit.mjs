import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { assertCleanSessionLogs, waitForElectronExit } from "./e2e-session-logs.mjs";

const root = process.cwd();
const [firstArgument, packageArgument, exeFlag, exeArgument] = process.argv.slice(2);
const startupMode = firstArgument === "--startup-package";
if (startupMode && (!packageArgument || (exeFlag !== undefined && (exeFlag !== "--exe" || !exeArgument)) || process.argv.length > 6)) {
  throw new Error('Usage: node scripts/e2e-audit.mjs --startup-package <package> [--exe <packaged executable>]');
}
const startupPackage = startupMode ? path.resolve(packageArgument) : undefined;
const packagedExe = startupMode && exeArgument ? path.resolve(exeArgument) : undefined;
if (startupPackage) await access(startupPackage);
if (packagedExe) await access(packagedExe);
const parent = path.resolve("node_modules/.satb-audit-e2e");
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, "run-"));
await mkdir(path.join(directory, "user-data"));
const score = `satb 1\nkey C major\nbars 1..2 {\nS: | B4/1 | C5/1 |\nA: | G4/1 | G4/1 |\nT: | D4/1 | E4/1 |\nB: | G2/1 | C3/1 |\n}`;
const manifestValue = {
  format: "satb-audit-manifest", formatVersion: 2, id: "audit-e2e", title: "审计交互验证",
  cases: [{ id: "one", title: "手工接口样例", projectFile: "sample.satb", source: {
    title: "合成双谱表定位测试", imageFile: "source.png",
    beatAnchors: [{ position: "1:1", x: 85 / 480, top: .1, bottom: .9 }, { position: "2:1", x: 280 / 480, top: .1, bottom: .9 }],
  }, items: [
    { id: "finding", title: "检查导音与谱面位置", category: "diagnostic", severity: "warning", range: ["1:1", "3:1"], voices: ["soprano"], model: { conclusion: "待人工判断", reason: "测试人工意见和原始结果分别保存。" }, program: { conclusion: "此处为模拟诊断, 不代表规则实际判断。", ruleId: "synthetic.example" }, question: "请独立裁定模拟诊断的适用边界。", evidence: [{ title: "合成参考材料", locator: "E2E 布局验证", content: "此依据仅验证图文与意见分区，不构成教材结论。" }], questions: [
      { id: "spelling", type: "single", label: "是否完成逐音核对", required: true, options: [{ id: "yes", label: "已核对" }, { id: "unknown", label: "仍需核对" }], suggested: "yes" },
      { id: "conditions", type: "multiple", label: "已核对的条件", options: [{ id: "voice", label: "声部位置" }, { id: "pitch", label: "书写音高" }], suggested: ["voice", "pitch"] },
      { id: "limit", type: "text", label: "补证范围", suggested: "教材依据待补" },
    ], sourceRegion: { x: .12, y: .1, width: .60, height: .8 },
    annotations: [{ source: "model", kind: "chord", range: ["1:1", "2:1"], label: "D" }] },
    { id: "proposal", title: "独立修复方案", category: "proposal", severity: "info", range: ["1:1", "2:1"], model: { conclusion: "待审批方案", reason: "只记录审批, 不执行代码。" } },
  ] }],
};
const input = path.join(directory, "sample.satb-audit.json");
async function prepareFixture() {
  const scoreInput = path.join(directory, "sample.satbt");
  await writeFile(scoreInput, score);
  execFileSync(process.execPath, ["scripts/score.mjs", "compile", scoreInput, "--out", path.join(directory, "sample.satb")], { windowsHide: true });
  const manifestInput = path.join(directory, "manifest.json");
  await writeFile(path.join(directory, "source.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAeAAAAB4AQAAAAAC7RyiAAAA/0lEQVR4nO2YPQ6CQBBGZ0cLqWws7OAYlh7Fo3kTW48BvYUFiRSYMTES1h9WPyZqYOe18GD4dhfYcUL9YYVLJoMwKviYHEdgpFjP4oJyNfvJMxcaebdWyPkWl10DFe6RxIUgJmmgVB45SQjyys42aNnUXiiX13eunyu68cEkKctlZ2BvqReKuT2vutRp0L6WfZxI/7KnB+ovJ6uuI+5vS5IG/ybB4b/JZGlHMc5sMgaD599hMgijgo/JIIwKPiaDMCr4mBxHYGT/YRhMGkShOttjgMhY0z5nCvm0V8j1iLsVBdyt4PeduEk+tE6cfLET59oxLFKFHM33mU3GGGhgFwgD7XAl1TI+AAAAAElFTkSuQmCC", "base64"));
  await writeFile(manifestInput, JSON.stringify(manifestValue));
  execFileSync(process.execPath, ["scripts/audit.mjs", "pack", manifestInput, "--out", input], { windowsHide: true });
  return JSON.parse(await readFile(input, "utf8"));
}
let child;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
const pending = new Map(); let sequence = 0;
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 12_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? "Renderer error");
  return response.result.value;
}
async function wait(expression, label) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(100); }
  throw new Error(`${label}\n${await evaluate("document.body.innerText")}`);
}
async function click(label) {
  const result = await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)}); if(!b||b.disabled||!b.checkVisibility())return false;b.click();return true;})()`);
  if (!result) throw new Error(`Missing button: ${label}`);
}
async function clickElement(selector) {
  await wait(`!!document.querySelector(${JSON.stringify(selector)})`, `缺少控件 ${selector}`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function assertReviewLayout(title) {
  const heading = title === "检查导音与谱面位置" ? "请独立裁定模拟诊断的适用边界。" : title;
  await wait(`(() => {
    const analysis = document.querySelector('.audit-evidence-pane .audit-analysis');
    const detail = document.querySelector('.audit-detail-pane');
    return !!analysis && analysis.querySelector('h2')?.textContent===${JSON.stringify(heading)} &&
      detail?.querySelector('[aria-label="自填答案"]')?.checkVisibility() &&
      detail?.querySelector('[aria-label="提交审计答案"]')?.checkVisibility() &&
      !detail.querySelector('select, .audit-analysis, .audit-reference, [role=tablist]') &&
      !!analysis.querySelector('[role=tablist]') && !!detail.querySelector('[data-question-id]');
  })()`, `图文与意见未就绪: ${title}`);
}
async function assertCursor(tick, evidenceSelector) {
  await wait(`document.querySelector('[data-audit-cursor-tick]')?.dataset.auditCursorTick === '${tick}' && !!document.querySelector(${JSON.stringify(evidenceSelector)})`,
    `视图没有定位到 ${tick} ${evidenceSelector}`);
}
async function checkNarrowLayout() {
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 820, deviceScaleFactor: 1, mobile: false });
  await wait("innerWidth===900", "窄窗口尺寸未应用");
  await assertReviewLayout("检查导音与谱面位置");
  if (!await horizontallyVisible(".audit-project-canvas") || !await horizontallyVisible(".audit-detail-pane")) throw new Error("窄窗口的工程或答案被横向截断");
  await capture("audit-synthetic-narrow.png");
  await click("审计目录");
  if (!await horizontallyVisible(".audit-sidebar")) throw new Error("窄窗口目录未打开");
  await clickElement(".audit-item:nth-of-type(2)");
  await assertReviewLayout("独立修复方案");
  await click("上一条");
  await assertReviewLayout("检查导音与谱面位置");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
}
async function horizontallyVisible(selector) {
  return evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e?.checkVisibility()) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1; })()`);
}
async function downloadJson(filename) {
  const full = path.join(directory, filename);
  for (let i = 0; i < 80; i++) { try { await access(full); break; } catch { await delay(100); } }
  return JSON.parse(await readFile(full, "utf8"));
}
async function setField(label, value, textarea = false) {
  await evaluate(`(() => {const e=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(${textarea ? "HTMLTextAreaElement" : "HTMLSelectElement"}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${textarea ? "input" : "change"}',{bubbles:true}));})()`);
}
async function setTextInput(label, value) {
  await evaluate(`(() => { const e=document.querySelector('[aria-label="${label}"]');const prototype=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
async function selectedPitch() {
  return evaluate(`(() => { const label=[...document.querySelectorAll('.audit-project-properties label')].find(e=>e.querySelector('span')?.textContent==='音名');return label?.querySelector('select')?.value; })()`);
}
async function upload(label, filename) {
  const doc = await send("DOM.getDocument");
  const node = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: `input[aria-label="${label}"]` });
  await send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [filename] });
}
async function capture(name) {
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  const filename = path.join(directory, name);
  await writeFile(filename, Buffer.from(screenshot.data, "base64"));
  console.log(`Screenshot: ${filename}`);
}
async function launch() {
  const args = ["--remote-debugging-port=0", "--remote-allow-origins=*", "--disable-gpu", `--user-data-dir=${path.join(directory, "user-data")}`];
  if (!packagedExe) args.push(root);
  if (startupPackage) args.push("--audit-package", startupPackage);
  child = spawn(packagedExe ?? path.resolve("node_modules/electron/dist/electron.exe"), args, {
    env: { ...process.env, SATB_MASTER_E2E_DIRECTORY: directory }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let log = "";
  let port;
  let spawnError;
  child.once("error", error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
    log = (log + chunk).slice(-5000);
    port ??= /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(log)?.[1];
  });
  const deadline = Date.now() + 20_000;
  let target;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) break;
    if (port) {
      try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page"); if (target?.webSocketDebuggerUrl) break; } catch {}
    }
    await delay(150);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`Electron failed to start\n${log}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (message) => { const p = JSON.parse(String(message.data)); const request = pending.get(p.id); if (!request) return; clearTimeout(request.timer); pending.delete(p.id); if (p.error) request.reject(new Error(p.error.message)); else request.resolve(p.result); });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory });
}
async function runWorkbenchChecks(packageValue) {
  await wait(`!!document.querySelector('button[aria-label="教材审计"]')`, "审计入口未出现");
  await click("教材审计");
  await wait(`!!document.querySelector('.audit-empty') && !document.querySelector('.audit-empty button.audit-primary').disabled`, "审计空态未就绪");
  await upload("审计包文件", input);
  await wait(`document.querySelectorAll('.audit-item').length===2 && !!document.querySelector('[data-audit-selected="true"]')`, "条目导入或五线谱定位失败");
  await assertReviewLayout("检查导音与谱面位置");
  await assertCursor(0, '.audit-score-playhead[data-tick="0"]');
  await wait(`document.querySelector('.audit-beat-annotation')?.textContent.includes('模型标注D')`, "未按拍显示模型和弦来源");
  await wait(`document.querySelector('.audit-review-footer').dataset.decision==='pending' && document.querySelector('[aria-label="提交审计答案"]').disabled && !document.querySelector('.audit-answer-questions input:checked')`, "模型建议未保持为待作答");
  await setTextInput("自填答案", "请明确终止处的适用条件");
  await clickElement('input[aria-label="对照原谱"]');
  await wait(`document.querySelector('.audit-source-image img')?.naturalWidth===480 && !!document.querySelector('.audit-score-card')`, "并排原图未载入");
  await evaluate(`(() => {
    const view = document.querySelector('.audit-source-image'), image = view.querySelector('img').getBoundingClientRect();
    view.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: image.left + image.width * .59, clientY: image.top + image.height * .55 }));
  })()`);
  await assertCursor(3840, '.audit-score-playhead[data-tick="3840"]');
  if (!await evaluate(`(() => {
    const image = document.querySelector('.audit-source-image img').getBoundingClientRect();
    const marker = document.querySelector('.audit-source-cursor').getBoundingClientRect();
    return Math.abs(marker.left + marker.width/2 - image.left - image.width * 280/480) < 2;
  })()`)) throw new Error("聚焦裁图后的原谱拍线与实际音符锚点未对齐");
  await clickElement('[data-audit-beat-tick="0"]');
  await assertCursor(0, '[data-audit-source-tick="0"][aria-pressed="true"]');
  await click("原谱");
  await click("下一拍");
  await assertCursor(960, ".audit-source-row");
  if (await evaluate(`!!document.querySelector('.audit-source-cursor')`)) throw new Error("未标定的原谱拍点被画成了精确位置");
  await click("上一拍");
  await assertCursor(0, '[data-audit-source-tick="0"][aria-pressed="true"]');
  await click("钢琴卷帘");
  await assertCursor(0, '.audit-project-editor[data-cursor-tick="0"]');
  await evaluate(`(() => {
    const lane=document.querySelector('.ruler-lane');
    const x=lane.querySelectorAll('.measure-number')[1].getBoundingClientRect().left;
    lane.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x+1}));
  })()`);
  await assertCursor(3840, '[data-audit-source-tick="3840"][aria-pressed="true"]');
  await click("转写谱");
  await assertCursor(3840, '.audit-score-playhead[data-tick="3840"]');
  if (await evaluate(`document.querySelector('[aria-label="自填答案"]').value`) !== "请明确终止处的适用条件") throw new Error("切换谱面丢失作答草稿");
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await wait(`!!document.querySelector('.audit-score-playhead')`, "大窗口谱面未渲染");
  await capture("audit-synthetic-wide.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelectorAll('.audit-analysis details').forEach(d=>d.open=true)`);
  await wait(`document.querySelector('.audit-analysis').textContent.includes('此处为模拟诊断') && document.querySelector('.audit-analysis').textContent.includes('合成参考材料')`, "缺少程序诊断或参考材料");
  await click("循环试听此段");
  await wait(`!!document.querySelector('button[aria-label="暂停试听"]')`, "局部试听未启动");
  await click("停止");
  await wait(`!!document.querySelector('button[aria-label="循环试听此段"]')`, "局部试听未停止");
  // An independent free answer can decide a question even when the supplied choices do not fit.
  await click("提交审计答案");
  await assertReviewLayout("独立修复方案");
  await wait(`document.querySelectorAll('.audit-item')[0].classList.contains('is-answered') && document.querySelectorAll('.audit-item')[1].classList.contains('is-pending')`, "自填答案未独立记录");
  await clickElement('[data-question-id="proposal-verdict"] input[value="accept"]');
  await wait(`document.querySelector('.audit-review-footer').dataset.decision==='pending'`, "勾选方案意外批准了修复");
  await click("提交审计答案");
  await wait(`document.querySelector('.audit-review-footer').dataset.decision==='accept'`, "显式提交没有批准指定方案");
  await click("撤回本条答案");
  await click("上一条");
  await assertReviewLayout("检查导音与谱面位置");
  await click("谱例转写复核");
  await clickElement('[aria-label="谱例转写核准"] input[value="accept"]');
  await click("谱例转写复核");
  await click("钢琴卷帘");
  await click("编辑选中属性");
  await wait(`document.querySelector('.audit-project-editor')?.dataset.auditNoteCount==='8' && !!document.querySelector('.audit-project-properties select')`, "工程副本/选中属性未显示");
  await evaluate(`(() => { const label=[...document.querySelectorAll('.audit-project-properties label')].find(e=>e.querySelector('span')?.textContent==='音名'); const e=label.querySelector('select');e.value='A';e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  if (await selectedPitch() !== "A") throw new Error("条目工程副本不能编辑");
  await wait(`document.querySelector('.audit-review-footer').dataset.decision==='pending'`, "修改工程未撤回已提交的决定");
  await click("工程撤销");
  if (await selectedPitch() !== "B") throw new Error("工程撤销失败");
  await click("工程重做");
  if (await selectedPitch() !== "A") throw new Error("工程重做失败");
  await click("导出此条工程");
  if ((await downloadJson("one-finding.satb")).satbTracks[0].notes[0].pitch.step !== "A") throw new Error("工程导出未包含修改");
  await click("下一条");
  await click("钢琴卷帘");
  await wait(`document.querySelector('.audit-project-editor')?.dataset.auditReadonly==='false'`, "另一条工程未载入");
  await click("导出此条工程");
  if ((await downloadJson("one-proposal.satb")).satbTracks[0].notes[0].pitch.step !== "B") throw new Error("条目修改污染了相邻工程");
  await click("上一条");
  await click("谱例转写复核");
  await click("查看基准工程");
  await wait(`document.querySelector('.audit-project-editor')?.dataset.auditReadonly==='true'`, "基准工程未保持只读");
  await click("导出此条工程");
  if ((await downloadJson("one-source.satb")).satbTracks[0].notes[0].pitch.step !== "B") throw new Error("人工副本污染基准");
  await click("返回条目副本");
  await click("编辑选中属性");
  await wait(`document.querySelector('.audit-project-editor')?.dataset.auditReadonly==='false' && !!document.querySelector('.audit-project-properties select')`, "无法恢复条目副本");
  if (await selectedPitch() !== "A") throw new Error("切换基准丢失修改");
  await setTextInput("自填答案", "");
  await clickElement('[data-question-id="spelling"] input[value="yes"]');
  await clickElement('[data-question-id="conditions"] input[value="voice"]');
  await setTextInput("补证范围", "补查教材例号");
  await click("提交审计答案");
  await assertReviewLayout("独立修复方案");
  await wait(`document.querySelector('.audit-save-status').textContent.includes('已自动保存')`, "自动保存未完成");
  await click("导出意见");
  const exported = path.join(directory, "audit-e2e.audit-feedback.json");
  const feedback = await downloadJson(path.basename(exported));
  const [answer, proposal] = feedback.cases[0].items;
  if (answer.decision !== "answered" || answer.answers.find(a=>a.id==="spelling")?.value!=="yes" ||
    answer.answers.find(a=>a.id==="limit")?.value!=="补查教材例号" ||
    JSON.stringify(answer.answers.find(a=>a.id==="conditions")?.value)!=='["voice"]' ||
    answer.project?.satbTracks[0].notes[0].pitch.step!=="A" || proposal.decision!=="pending" || proposal.project ||
    feedback.cases[0].source.decision!=="accept") throw new Error("问答、独立副本或转写核准导出不正确");
  await send("Page.reload");
  await wait(`!!document.querySelector('button[aria-label="教材审计"]')`, "重载失败");
  await click("教材审计");
  await assertReviewLayout("检查导音与谱面位置");
  await wait(`document.querySelector('.audit-review-footer').dataset.decision==='answered' && document.querySelector('[aria-label="补证范围"]').value==='补查教材例号'`, "重新打开后作答未恢复");
  await click("钢琴卷帘");
  await click("编辑选中属性");
  await wait(`!!document.querySelector('.audit-project-properties select')`, "重新打开后工程未恢复");
  if (await selectedPitch() !== "A") throw new Error("副本未从本机恢复");
  await checkNarrowLayout();
  await click("筛选条目");
  await setField("层级筛选", "error");
  await wait(`document.querySelectorAll('.audit-item').length===0`, "层级筛选无效");
  await setField("层级筛选", "");
  packageValue.cases[0].project.satbTracks[0].notes[0].pitch.step = "D";
  const changed = path.join(directory, "changed.satb-audit.json");
  await writeFile(changed, JSON.stringify(packageValue));
  await upload("审计包文件", changed);
  await wait(`document.querySelector('.audit-notice')?.textContent.includes('需重新审阅')`, "变更谱面未提示旧意见失效");
  await click("谱例转写复核");
  await wait(`document.querySelector('[aria-label="谱例转写核准"] input:checked')?.value==='pending'`, "旧核准未失效");
  await upload("审计意见文件", exported);
  await wait(`document.querySelector('.audit-notice')?.textContent.includes('未采用')`, "导入旧意见缺少过期提示");
  await capture("audit-workbench.png");
  if (process.argv[2]) {
    await upload("审计包文件", path.resolve(process.argv[2]));
    await wait(`!!document.querySelector('.audit-item') && !document.querySelector('.audit-row-title').textContent.includes('检查导音与谱面位置')`, "本地教材包未导入");
    const title = await evaluate(`document.querySelector('.audit-row-title').textContent`);
    await clickElement(".audit-group-toggle");
    await setTextInput("搜索审计条目", title);
    await wait(`document.querySelector('.audit-row-title')?.textContent===${JSON.stringify(title)}`, "折叠目录未显示搜索结果");
    await setTextInput("搜索审计条目", "");
    await click("原谱");
    await wait(`document.querySelector('.audit-source-card img')?.naturalWidth>0`, "教材原图未载入");
    await clickElement('input[aria-label="对照转写谱"]');
    await wait(`!!document.querySelector('.audit-score-playhead')`, "原谱与工程未对照显示");
    await capture("audit-pilot.png");
    await click("钢琴卷帘");
    await wait(`!!document.querySelector('.audit-project-editor .piano-roll')`, "教材工程附件未载入");
    await capture("audit-piano-roll.png");
  }
  await click("返回工程");
  await wait(`!!document.querySelector('button[aria-label="教材审计"]') && !document.querySelector('.audit-workbench')`, "未能返回原工程");
  console.log("PASS: 三视图双向拍点、稀疏原图标定、草稿保留、自填与备选意见、方案独立批准、工程副本与基准、自动保存与导出、宽窄布局、旧意见失效");
}

async function checkStartupPackage() {
  const pkg = JSON.parse(await readFile(startupPackage, "utf8"));
  const titles = pkg.cases.flatMap(c => c.items.map(item => item.title));
  if (pkg.cases[0]?.id !== "N035" || titles.length !== 3) throw new Error("启动回归需要以 N035 为首题的三题审计包");
  const heading = JSON.stringify(pkg.cases[0].title);
  const itemTitle = JSON.stringify(titles[0]);
  const directoryReady = `document.querySelector('.audit-case-heading h1')?.textContent===${heading} &&
    document.querySelector('.audit-item[aria-pressed="true"] .audit-row-title')?.textContent===${itemTitle} &&
    JSON.stringify([...document.querySelectorAll('.audit-row-title')].map(el=>el.textContent))===${JSON.stringify(JSON.stringify(titles))}`;
  await wait(directoryReady, "启动未直接显示 N035 或三条审计目录不符");
  await wait(`document.querySelector('[aria-label="自填答案"]')?.value==='' && document.querySelector('.audit-review-footer')?.dataset.decision==='pending'`, "新用户目录已有草稿或人工结果");
  await click("原谱");
  await wait(`document.querySelector('.audit-source-card img')?.naturalWidth>0 && !!document.querySelector('.audit-source-cursor')`, "原谱或拍点标记未显示");
  const tick = await evaluate("document.querySelector('[data-audit-cursor-tick]').dataset.auditCursorTick");
  await assertCursor(tick, `[data-audit-source-tick="${tick}"][aria-pressed="true"]`);
  await click("转写谱");
  await assertCursor(tick, `.audit-score-playhead[data-tick="${tick}"]`);
  await click("钢琴卷帘");
  await assertCursor(tick, `.audit-project-editor[data-cursor-tick="${tick}"] .piano-roll`);

  const draft = "仅用于启动回归的审计草稿";
  await setTextInput("自填答案", draft);
  await wait(`document.querySelector('[aria-label="自填答案"]').value===${JSON.stringify(draft)} && document.querySelector('.audit-save-status')?.textContent.includes('已自动保存')`, "测试草稿未自动保存");
  // Allow Runtime.evaluate to respond before the native window tears down its CDP connection.
  await evaluate(`setTimeout(()=>document.querySelector('button[aria-label="关闭窗口"]').click(), 50); true`);
  await waitForElectronExit(child);
  socket.close();
  await launch();
  await wait(directoryReady, "在同一用户目录重开后未恢复审计包");
  await wait(`document.querySelector('[aria-label="自填答案"]')?.value===${JSON.stringify(draft)} && document.querySelector('.audit-review-footer')?.dataset.decision==='pending'`, "重启后未恢复待提交的草稿");
  console.log("PASS: 命令行直达 N035、三题目录与三视图拍点、独立用户目录保存草稿及重启恢复");
}

try {
  const packageValue = startupMode ? undefined : await prepareFixture();
  await launch();
  if (startupMode) await checkStartupPackage();
  else await runWorkbenchChecks(packageValue);
  await evaluate(`setTimeout(() => void window.desktop.windowControls.close().catch(() => {}), 50); true`);
  await waitForElectronExit(child);
  const { files, entries } = await assertCleanSessionLogs(path.join(directory, "user-data"));
  console.log(`PASS: JSONL 日志门禁，${files} 个文件、${entries} 条日志`);
  console.log(`Artifacts: ${directory}`);
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) await capture("audit-failure.png").catch(() => {});
  throw error;
} finally {
  socket?.close();
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("CDP closed")); }
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await waitForElectronExit(child, { requireSuccess: false });
  }
}
