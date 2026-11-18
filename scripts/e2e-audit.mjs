import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const parent = path.resolve("node_modules/.satb-audit-e2e");
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, "run-"));
await mkdir(path.join(directory, "user-data"));
const score = `satb 1\nkey C major\nbars 1..2 {\nS: | B4/1 | C5/1 |\nA: | G4/1 | G4/1 |\nT: | D4/1 | E4/1 |\nB: | G2/1 | C3/1 |\n}`;
const manifestValue = {
  format: "satb-audit-manifest", formatVersion: 2, id: "audit-e2e", title: "审计交互验证",
  cases: [{ id: "one", title: "手工接口样例", projectFile: "sample.satb", source: { title: "合成测试, 非教材参考答案" }, items: [
    { id: "finding", title: "检查导音与谱面位置", category: "diagnostic", severity: "warning", range: ["1:1", "3:1"], voices: ["soprano"], model: { conclusion: "待人工判断", reason: "测试人工意见和原始结果分别保存。" }, program: { conclusion: "此处为模拟诊断, 不代表规则实际判断。", ruleId: "synthetic.example" }, question: "请独立裁定模拟诊断的适用边界。", evidence: [{ title: "合成参考材料", locator: "E2E 布局验证", content: "此依据仅验证图文与意见分区，不构成教材结论。" }], questions: [
      { id: "spelling", type: "single", label: "是否完成逐音核对", required: true, options: [{ id: "yes", label: "已核对" }, { id: "unknown", label: "仍需核对" }], suggested: "yes" },
      { id: "conditions", type: "multiple", label: "已核对的条件", options: [{ id: "voice", label: "声部位置" }, { id: "pitch", label: "书写音高" }], suggested: ["voice", "pitch"] },
      { id: "limit", type: "text", label: "补证范围", suggested: "教材依据待补" },
    ] },
    { id: "proposal", title: "独立修复方案", category: "proposal", severity: "info", range: ["1:1", "2:1"], model: { conclusion: "待审批方案", reason: "只记录审批, 不执行代码。" } },
  ] }],
};
const input = path.join(directory, "sample.satb-audit.json");
const scoreInput = path.join(directory, "sample.satbt");
await writeFile(scoreInput, score);
execFileSync(process.execPath, ["scripts/score.mjs", "compile", scoreInput, "--out", path.join(directory, "sample.satb")], { windowsHide: true });
const manifestInput = path.join(directory, "manifest.json");
await writeFile(manifestInput, JSON.stringify(manifestValue));
execFileSync(process.execPath, ["scripts/audit.mjs", "pack", manifestInput, "--out", input], { windowsHide: true });
const packageValue = JSON.parse(await readFile(input, "utf8"));
const port = 9400 + Math.floor(Math.random() * 400);
let log = "";
const child = spawn(path.resolve("node_modules/electron/dist/electron.exe"), [`--remote-debugging-port=${port}`, "--remote-allow-origins=*", "--disable-gpu", root], { env: { ...process.env, SATB_MASTER_E2E_DIRECTORY: directory }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { log = (log + chunk).slice(-5000); });
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
async function assertReviewLayout(title, { questions = false, decision = "审计结论" } = {}) {
  await wait(`(() => {
    const analysis = document.querySelector('.audit-evidence-pane .audit-analysis');
    const detail = document.querySelector('.audit-detail-pane');
    const control = detail?.querySelector('[aria-label="${decision}"]');
    return document.querySelectorAll('.audit-analysis').length === 1 && analysis?.checkVisibility()
      && [...analysis.querySelectorAll('h2,h3')].some(e => e.textContent.trim() === ${JSON.stringify(title)}) && analysis.textContent.includes('模型判断')
      && analysis.textContent.includes('参考依据') && control?.checkVisibility()
      && !!detail.querySelector('.audit-human-review') && !!detail.querySelector('.audit-panel-bar nav')
      && ${questions ? "!!detail.querySelector('.audit-preflight')" : "!detail.querySelector('.audit-preflight')"};
  })()`, `中栏分析或右栏意见未就绪: ${title}`);
  if (!await evaluate(`(() => {
    const detail = document.querySelector('.audit-detail-pane');
    return !detail.querySelector('.audit-analysis,.audit-detail-heading,.audit-analysis-block,.audit-question,.audit-reference,.audit-review-tabs,[role="tablist"]')
      && ![...detail.querySelectorAll('button')].some(e => ['填写本条意见','填写意见','分析依据'].includes(e.textContent.trim()))
      && !!document.querySelector('.audit-evidence-pane [aria-label="谱例转写复核"]');
  })()`)) throw new Error("右栏仍混有分析内容或旧跳转，或转写复核离开了中栏");
}
async function assertImagePairs({ wide = false } = {}) {
  await wait(`(() => {
    const source = document.querySelector('.audit-analysis .audit-source-card')?.closest('.audit-evidence-pair');
    const score = document.querySelector('.audit-analysis .audit-score-card')?.closest('.audit-evidence-pair');
    if (!source?.querySelector('.audit-evidence-caption .model') || !score?.querySelector('.audit-evidence-caption')?.textContent.includes('程序结果')) return false;
    return ${wide} ? [source, score].every(pair => {
      const media = pair.querySelector('.audit-evidence-media').getBoundingClientRect();
      const caption = pair.querySelector('.audit-evidence-caption').getBoundingClientRect();
      return media.width > 0 && caption.width > 0 && caption.left >= media.right - 1 && Math.abs(media.top - caption.top) < 2;
    }) : true;
  })()`, `${wide ? "大窗口" : "谱面视图"}未将原图与模型、转写与程序结果对应排版`);
}
async function horizontallyVisible(selector) {
  return evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e?.checkVisibility()) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1; })()`);
}
async function checkNarrowLayout() {
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 820, deviceScaleFactor: 1, mobile: false });
  await wait(`innerWidth===900`, "窄窗口尺寸未应用");
  await assertReviewLayout("检查导音与谱面位置", { questions: true });
  if (!await horizontallyVisible(".audit-project-canvas") || !await horizontallyVisible(".audit-detail-pane") || await horizontallyVisible(".audit-sidebar") || !await horizontallyVisible(".audit-analysis")) throw new Error("窄窗口挤压或遮挡了工程、分析和意见");
  await capture("audit-synthetic-narrow.png");
  await click("审计目录");
  if (!await horizontallyVisible(".audit-sidebar") || !await horizontallyVisible(".audit-project-canvas")) throw new Error("窄窗口无法同时查看目录与工程");
  await evaluate(`document.querySelectorAll('.audit-item')[1].click()`);
  await assertReviewLayout("独立修复方案", { decision: "方案审阅决定" });
  if (await horizontallyVisible(".audit-sidebar") || !await horizontallyVisible(".audit-detail-pane")) throw new Error("选择条目后未回到意见面板");
  await click("上一条");
  await assertReviewLayout("检查导音与谱面位置", { questions: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
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
try {
  const deadline = Date.now() + 20_000;
  let target;
  while (Date.now() < deadline) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page"); if (target?.webSocketDebuggerUrl) break; } catch {}
    await delay(150);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`Electron failed to start\n${log}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (message) => { const p = JSON.parse(String(message.data)); const request = pending.get(p.id); if (!request) return; clearTimeout(request.timer); pending.delete(p.id); if (p.error) request.reject(new Error(p.error.message)); else request.resolve(p.result); });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory });
  await wait(`!!document.querySelector('button[aria-label="教材审计"]')`, "审计入口未出现");
  await click("教材审计");
  await wait(`!!document.querySelector('.audit-empty') && !document.querySelector('.audit-empty button.audit-primary').disabled`, "审计空态未就绪");
  await upload("审计包文件", input);
  await wait(`document.querySelectorAll('.audit-item').length===2 && !!document.querySelector('[data-audit-selected="true"]')`, "条目导入或五线谱定位失败");
  await assertReviewLayout("检查导音与谱面位置", { questions: true });
  await assertImagePairs();
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await assertImagePairs({ wide: true });
  await capture("audit-synthetic-wide.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  if (!await evaluate(`document.querySelector('.audit-evidence-pane .audit-analysis').textContent.includes('请独立裁定模拟诊断的适用边界。') && document.querySelector('.audit-evidence-pane .audit-analysis').textContent.includes('此处为模拟诊断') && document.querySelector('.audit-evidence-pane .audit-analysis').textContent.includes('合成参考材料')`)) throw new Error("中栏缺少待裁定、程序结果或参考材料");
  if (!await evaluate(`!document.querySelector('.audit-preflight input:checked') && document.querySelector('[aria-label="审计结论"] option[value="accept"]').disabled`)) throw new Error("模型建议被当作人工作答或未答必填题已可批准");
  await click("填入未作答项");
  await wait(`document.querySelectorAll('.audit-preflight input:checked').length===3`, "预填单选/多选没有应用");
  await setTextInput("预审：补证范围", "请明确原位与终止处的条件");
  await evaluate(`document.querySelector('[data-question-id="conditions"] input[value="pitch"]').click()`);
  if (await evaluate(`document.querySelector('[aria-label="审计结论"]').value`) !== "pending") throw new Error("采用建议意外批准了判断");
  await click("循环试听此段");
  await wait(`document.querySelector('.audit-score-transport')?.textContent.includes('暂停试听')`, "片段播放未启动");
  await click("停止");
  await wait(`document.querySelector('.audit-score-transport')?.textContent.includes('循环试听此段')`, "片段播放未停止");
  await setField("审计意见", "请补充教材例号，暂不批准修复", true);
  await setField("审计结论", "needs-evidence");
  await click("谱例转写复核");
  await setField("谱例转写核准", "accept");
  await wait(`document.querySelector('.audit-progress').textContent.includes('1/2') && document.querySelector('.audit-progress').textContent.includes('1/1') && document.querySelector('.audit-save-status').textContent.includes('已自动保存')`, "意见自动保存失败");
  if (!await evaluate(`document.querySelectorAll('.audit-source-card').length===1 && document.querySelectorAll('.audit-score-card').length===1`)) throw new Error("意见更新导致重复谱面卡片");
  await click("工程 · 钢琴卷帘");
  await wait(`!!document.querySelector('.audit-project-editor .piano-roll') && document.querySelector('.audit-project-editor')?.dataset.auditNoteCount==='8'`, "工程附件没有进入卷帘");
  await wait(`!!document.querySelector('.audit-project-properties select')`, "选中音符属性未显示");
  await assertReviewLayout("检查导音与谱面位置", { questions: true });
  await evaluate(`(() => { const label=[...document.querySelectorAll('.audit-project-properties label')].find(e=>e.querySelector('span')?.textContent==='音名'); const e=label.querySelector('select');e.value='A';e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  if (await selectedPitch() !== "A") throw new Error("条目工程副本不能编辑");
  await wait(`document.querySelector('[aria-label="审计结论"]').value==='pending'`, "修改副本未撤回原决定");
  await click("工程撤销");
  await wait(`(()=>{const e=[...document.querySelectorAll('.audit-project-properties label')].find(e=>e.querySelector('span')?.textContent==='音名');return e?.querySelector('select')?.value==='B'})()`, "工程撤销失败");
  await click("工程重做");
  await wait(`(()=>{const e=[...document.querySelectorAll('.audit-project-properties label')].find(e=>e.querySelector('span')?.textContent==='音名');return e?.querySelector('select')?.value==='A'})()`, "工程重做失败");
  await click("导出此条工程");
  const exportedProject = path.join(directory, "one-finding.satb");
  for (let i = 0; i < 50; i++) { try { await access(exportedProject); break; } catch { await delay(100); } }
  if (JSON.parse(await readFile(exportedProject, "utf8")).satbTracks[0].notes[0].pitch.step !== "A") throw new Error("工程导出未包含当前副本");
  await click("下一条");
  await assertReviewLayout("独立修复方案", { decision: "方案审阅决定" });
  await wait(`!!document.querySelector('.audit-project-properties select')`, "另一条工程未显示");
  if (await selectedPitch() !== "B") throw new Error("编辑一个条目污染了另一条工程副本");
  if (await evaluate(`document.querySelector('[aria-label="方案审阅决定"]').value`) !== "pending") throw new Error("谱例或判断审阅意外批准了修复方案");
  await click("上一条");
  await assertReviewLayout("检查导音与谱面位置", { questions: true });
  await wait(`!!document.querySelector('.audit-project-properties select')`, "返回原条目工程失败");
  if (await selectedPitch() !== "A") throw new Error("切换条目丢失了已修改的副本");
  await click("查看基准工程");
  await wait(`document.querySelector('.audit-project-editor')?.dataset.auditReadonly==='true'`, "基准工程不是只读");
  await click("导出此条工程");
  const exportedSource = path.join(directory, "one-source.satb");
  for (let i = 0; i < 50; i++) { try { await access(exportedSource); break; } catch { await delay(100); } }
  if (JSON.parse(await readFile(exportedSource, "utf8")).satbTracks[0].notes[0].pitch.step !== "B") throw new Error("提交基准被人工副本污染");
  await click("返回条目副本");
  await wait(`document.querySelector('.audit-project-editor')?.dataset.auditReadonly==='false'`, "无法返回独立副本");
  if (await selectedPitch() !== "A") throw new Error("只读基准往返丢失副本修改");
  await setField("审计结论", "needs-evidence");
  await click("原图与谱面");
  await wait(`!!document.querySelector('.audit-score-card')`, "原图选项卡未恢复");
  await assertReviewLayout("检查导音与谱面位置", { questions: true });
  await click("循环试听此段");
  await wait(`document.querySelector('.audit-score-transport')?.textContent.includes('暂停试听')`, "切换前片段未播放");
  await evaluate(`document.querySelectorAll('.audit-item')[1].click()`);
  await wait(`document.querySelector('.audit-score-transport')?.textContent.includes('循环试听此段')`, "切换条目后旧播放未停止");
  await evaluate(`document.querySelectorAll('.audit-item')[0].click()`);
  await click("导出意见");
  const exported = path.join(directory, "audit-e2e.audit-feedback.json");
  for (let i = 0; i < 50; i++) { try { await access(exported); break; } catch { await delay(100); } }
  const feedback = JSON.parse(await readFile(exported, "utf8"));
  if (feedback.cases[0].items[0].comment !== "请补充教材例号，暂不批准修复" || feedback.cases[0].items[1].decision !== "pending") throw new Error("意见导出内容或审批隔离失败");
  const answered = feedback.cases[0].items[0];
  if (answered.project?.satbTracks[0].notes[0].pitch.step !== "A" || answered.answers?.find(a=>a.id==='limit')?.value!=='请明确原位与终止处的条件' || JSON.stringify(answered.answers?.find(a=>a.id==='conditions')?.value)!==JSON.stringify(['voice'])) throw new Error("意见文件未包含问答和独立工程");
  if (feedback.cases[0].items[1].project || packageValue.cases[0].project.satbTracks[0].notes[0].pitch.step !== "B") throw new Error("反馈污染了提交工程或其他条目");
  await send("Page.reload");
  await wait(`!!document.querySelector('button[aria-label="教材审计"]')`, "重载失败");
  await click("教材审计");
  await wait(`document.querySelector('.audit-progress')?.textContent.includes('1/2') && document.querySelector('.audit-progress')?.textContent.includes('1/1')`, "重载后意见未恢复");
  if (await evaluate(`document.querySelector('[aria-label="预审：补证范围"]').value`) !== "请明确原位与终止处的条件") throw new Error("预审回答未从本机恢复");
  await click("工程 · 钢琴卷帘");
  await wait(`!!document.querySelector('.audit-project-properties select')`, "恢复工程失败");
  if (await selectedPitch() !== "A") throw new Error("工程副本未从本机恢复");
  await checkNarrowLayout();
  await click("原图与谱面");
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
  await wait(`document.querySelector('[aria-label="谱例转写核准"]')?.value==='pending'`, "变更谱面未使旧意见失效");
  await upload("审计意见文件", exported);
  await wait(`document.querySelector('.audit-notice')?.textContent.includes('未采用')`, "导入旧意见缺少过期提示");
  await capture("audit-workbench.png");
  if (process.argv[2]) {
    await upload("审计包文件", path.resolve(process.argv[2]));
    await wait(`document.querySelectorAll('.audit-item').length>2 && !!document.querySelector('img[alt*="教材原图"]') && !!document.querySelector('[data-audit-selected="true"]')`, "本地教材审计包未完成渲染");
    await delay(300);
    if (!await evaluate(`document.querySelectorAll('.audit-source-card').length===1 && document.querySelectorAll('.audit-score-card').length===1`)) throw new Error("切换审计包后残留旧谱面");
    await click("关闭审计提示");
    await capture("audit-pilot.png");
    const firstTitle = await evaluate(`document.querySelector('.audit-row-title').textContent`);
    await evaluate(`document.querySelector('.audit-group-toggle').click()`);
    await wait(`document.querySelector('.audit-group-toggle').getAttribute('aria-expanded')==='false'`, "目录分组未折叠");
    await setTextInput("搜索审计条目", firstTitle);
    await wait(`document.querySelector('.audit-row-title')?.textContent===${JSON.stringify(firstTitle)}`, "搜索结果仍藏在折叠分组中");
    await setTextInput("搜索审计条目", "");
    await evaluate(`document.querySelector('.audit-citation summary').click()`);
    await wait(`!!document.querySelector('.audit-citation[open] strong')?.textContent`, "无法展开教材来源");
    await evaluate(`document.querySelector('.audit-citation summary').click()`);
    await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await wait(`(() => {
      const analysis = document.querySelector('.audit-evidence-pane .audit-analysis');
      const detail = document.querySelector('.audit-detail-pane');
      return analysis?.checkVisibility() && analysis.textContent.includes('模型判断') && analysis.textContent.includes('程序结果') && !!detail?.querySelector('.audit-human-review select');
    })()`, "大窗口未同时展示图文分析与人工意见");
    if (!await horizontallyVisible('.audit-analysis') || !await horizontallyVisible('.audit-source-card') || !await horizontallyVisible('.audit-score-card') || !await horizontallyVisible('.audit-detail-pane')) throw new Error("大窗口图文与意见超出可用区域");
    await assertImagePairs({ wide: true });
    await capture("audit-wide.png");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await click("下一条");
    await wait(`document.querySelector('.audit-panel-bar nav span').textContent.startsWith('2 /')`, "下一条导航失败");
    await click("上一条");
    await click("工程 · 钢琴卷帘");
    await wait(`!!document.querySelector('.audit-project-editor .piano-roll')`, "教材工程附件未渲染");
    await capture("audit-piano-roll.png");
    await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 820, deviceScaleFactor: 1, mobile: false });
    await delay(300);
    const visible = selector => evaluate(`(() => {const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth;})()`);
    if (!await visible(".audit-project-canvas") || !await visible(".audit-detail-pane") || await visible(".audit-sidebar")) throw new Error("窄窗口布局挤压或遮挡了工程和意见");
    await capture("audit-narrow.png");
    await click("审计目录");
    if (!await visible(".audit-sidebar") || !await visible(".audit-project-canvas")) throw new Error("窄窗口无法同时查看目录与工程");
    await evaluate(`document.querySelectorAll('.audit-item')[1].click()`);
    if (await visible(".audit-sidebar") || !await visible(".audit-detail-pane")) throw new Error("选择条目后未回到审阅面板");
  }
  await click("返回工程");
  await wait(`!!document.querySelector('button[aria-label="教材审计"]') && !document.querySelector('.audit-workbench')`, "未能返回原工程");
  console.log("PASS: 工程附件打包、中栏常驻分析与右栏意见、原图/卷帘切换、单选/多选/输入题、显式采用建议、必填校验、副本编辑/撤销/隔离、工程与意见导出、自动保存恢复、条目联动、窄屏布局、筛选和版本失效");
  console.log(`Artifacts: ${directory}`);
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) await capture("audit-failure.png").catch(() => {});
  throw error;
} finally {
  socket?.close();
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("CDP closed")); }
  child.kill();
}
