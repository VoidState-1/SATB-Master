import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { addCadenceAnnotation } from "../../../editing";
import { annotationFromCadenceCandidate } from "../model";

const score = `satb 1
key D minor
meter 4/4
bars 1..2 {
  S: | D5/4 r/4 E5/4 r/4 | D5/4 r/2. |
  A: | Bb4/4 r/4 G4/4 r/4 | F4/4 r/2. |
  T: | G4/4 r/4 C#4/4 r/4 | A3/4 r/2. |
  B: | G3/4 r/4 A2/4 r/4 | D3/4 r/2. |
  H: | iv/4 r/4 V7/4 r/4 | i/4 r/2. |
}`;

function analyze(text: string, cut?: number) {
  const { project } = compileScoreText(text);
  if (cut !== undefined) {
    project.structure.phraseBoundaries = [{ id: "cut", tick: cut, source: "manual", confidence: "certain" }];
  }
  return buildHarmonyAnalysis(project).cadenceCandidates.find(c =>
    c.kind === "full" && c.fromTick === 2 * project.ppq && c.toTick === 5 * project.ppq);
}

describe("顿奏节奏中的句末正格终止", () => {
  it.each([
    ["完整主和弦", score],
    ["三声写出主音、三音与旋律收束", score.replace("A3/4 r/2.", "r/1")],
  ])("%s 保留属七到主的实际起止", (_label, text) => {
    expect(analyze(text)).toMatchObject({
      form: "authentic", completion: "perfect", confidence: "probable",
      evidence: expect.arrayContaining([expect.objectContaining({ code: "detached-dominant-to-tonic" })]),
    });
  });

  it.each([
    ["低音在属七后的空隙仍响", score.replace("A2/4 r/4", "A2/2")],
    ["休止中掺入新旋律", score.replace("E5/4 r/4", "E5/4 D5/4")],
    ["属七标签与实奏七音不合", score.replace("G4/4 r/4 | F4", "E4/4 r/4 | F4")],
    ["低音先到另一个落点", score.replace("D3/4 r/2.", "A2/4 r/2.")],
    ["落点只有主音与五音", score.replace("F4/4 r/2.", "A4/4 r/2.")],
    ["准备和弦在初次休止期间持续", score.replace("Bb4/4 r/4", "Bb4/2")],
    ["强拍落点后仍有新乐音", score.replace("D5/4 r/2.", "D5/4 r/4 A4/2")],
    ["两次齐休的长度不同", score.replaceAll("/4 r/4 |", "/8 r/4. |").replace("V7/4 r/4", "V7/8 r/4.")],
    ["没有实写下属准备", score.replace("iv/4 r/4", "r/2")],
    ["谱中途明确另标一段和声", score.replace("V7/4 r/4", "V7/4 vi/4")],
    ["准备或落点的调号不符", score.replace("key D minor", "key G minor")],
  ])("%s 保留两侧的分隔", (_label, text) => {
    expect(analyze(text)).toBeUndefined();
  });

  it("同名调号在全休中重新起算时，保留调性边界", () => {
    const { project } = compileScoreText(score);
    project.keyEvents.push({ ...project.keyEvents[0], id: "retake", tick: 3000 });
    expect(buildHarmonyAnalysis(project).cadenceCandidates.some(c => c.kind === "full")).toBe(false);
  });

  it.each([2880, 3840])("尊重属和弦释放或主和弦起奏处的明确句界 %i", tick => {
    expect(analyze(score, tick)).toBeUndefined();
  });
});

const auxiliary = `satb 1
key B minor
meter 3/4
bars 1..2 {
 S: | F#5/2 C#5/8 D5/8 | B4/2. |
 A: | B4/2 A#4/4 | F#4/2. |
 T: | D4/2 E4/4~ | E4/4 D4/2 |
 B: | F#2/2. | B2/2. |
 H: | K46/2 V7/8 r/8 | i/2. |
}`;

const revoiced = `satb 1
key C major
meter 3/4
bars 1..2 {
 S: | A4/2 D5/8 G5/8 | C5/2. |
 A: | F4/2 B4/4 | C5/2. |
 T: | D4/2 G4/4 | G4/2. |
 B: | F3/2. | E3/2. |
 H: | ii6/2 V2/8 r/8 | I6/2. |
}`;

function authenticCadence(project: ReturnType<typeof compileScoreText>["project"]) {
  return buildHarmonyAnalysis(project).cadenceCandidates.find(
    candidate => candidate.kind === "full" && candidate.form === "authentic",
  );
}

describe("终止前属七的弱位女高换音", () => {
  it.each([
    ["原位属七、女高辅助音与落主七音延留", auxiliary, 0, "perfect"],
    ["属二、女高转到根音后落主六", revoiced, 1920, "imperfect"],
  ])("%s 的半拍留白可证明连续的属到主", (_label, text, fromTick, completion) => {
    const { project } = compileScoreText(text);
    const originalChordTrack = structuredClone(project.chordTrack);
    expect(authenticCadence(project)).toMatchObject({
      fromTick, toTick: 5760, completion, confidence: "probable",
      evidence: expect.arrayContaining([expect.objectContaining({ code: "dominant-before-tonic-gap" })]),
    });
    expect(project.chordTrack).toEqual(originalChordTrack);
  });

  it.each([
    ["内声部同音重奏", auxiliary.replace("E4/4~ | E4/4", "E4/8 E4/8~ | E4/4")],
    ["低音同音重奏", auxiliary.replace("F#2/2.", "F#2/2 F#2/8 F#2/8")],
    ["女高等音异名", auxiliary.replace("D5/8", "C##5/8")],
    ["七音延留后跳进", auxiliary.replace("E4/4 D4/2", "E4/4 F#4/2")],
    ["标为属二但男高低于标注的低音", revoiced.replace("G4/4 | G4/2.", "G2/4 | G2/2.")],
    ["七音解决前已实奏另一组三和弦", auxiliary
      .replace("B4/2. |", "B4/8 G4/8 B4/2 |")
      .replace("F#4/2. |", "F#4/8 E4/8 F#4/2 |")],
    ["实际最高声部未落到主音", auxiliary.replace("A#4/4 | F#4/2.", "A#5/4 | F#5/2.")],
    ["属二的七音未下行", revoiced.replace("E3/2.", "C3/2.")],
    ["缺乏已确认的完整属七准备", auxiliary.replace("V7/8 r/8", "r/4")],
    ["完整书写和弦的留白", auxiliary.replace("D5/8", "C#6/8")],
    ["弱位已有独立和声标注", auxiliary.replace("V7/8 r/8", "V7/8 iv/8")],
  ])("%s 不凭留白产生新终止", (_label, text) => {
    expect(authenticCadence(compileScoreText(text).project)).toBeUndefined();
  });

  it.each([2400, 2640, 2880])("明确句界位于 %i 时阻断留白连接", tick => {
    const { project } = compileScoreText(auxiliary);
    project.structure.phraseBoundaries.push({ id: "boundary", tick, source: "manual", confidence: "certain" });
    expect(authenticCadence(project)).toBeUndefined();
  });

  it("留白内同主音调号事件也阻断连接", () => {
    const { project } = compileScoreText(auxiliary);
    project.keyEvents.push({ ...project.keyEvents[0], id: "new-key", tick: 2640 });
    expect(authenticCadence(project)).toBeUndefined();
  });
});

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  harmony?: string;
}

function fullExample({
  soprano = "D5/8 C#5/8 D5/8",
  alto = "F4/4.",
  tenor = "B3/8 A#3/8 B3/8",
  bass = "G2/4.",
  harmony = "V7/8 r/8 V7/8",
}: Example = {}) {
  return compileScoreText(`satb 1
key C major
meter 3/8
bars 1..2 {
  S: | ${soprano} | C5/4. |
  A: | ${alto} | E4/4. |
  T: | ${tenor} | G3/4. |
  B: | ${bass} | C3/4. |
  H: | ${harmony} | I/4. |
}`).project;
}

function fullCadence(project: ReturnType<typeof fullExample>) {
  return buildHarmonyAnalysis(project).cadenceCandidates.find(c =>
    c.kind === "full" && c.toTick === project.lengthTicks);
}

function remainsAtSecondDominant(project: ReturnType<typeof fullExample>) {
  const cadence = fullCadence(project);
  expect(cadence).toMatchObject({ fromTick: 960, toTick: 2880, form: "authentic", completion: "perfect" });
  expect(cadence?.evidence.some(item => item.code === "dominant-neighbor-prolongation")).toBe(false);
}

describe("双重辅助音装饰的终止属功能", () => {
  it("G7 两端同形、属低音和七音持续，确定已经存在的正格终止左端", () => {
    const cadence = fullCadence(fullExample());
    expect(cadence).toMatchObject({ fromTick: 0, toTick: 2880, form: "authentic", completion: "perfect" });
    expect(cadence?.evidence).toContainEqual(expect.objectContaining({
      code: "dominant-neighbor-prolongation", refs: ["note-S-480", "note-T-480"],
    }));
  });

  it("属三和弦之内的双辅助音不截断持续属和弦和此前相接的 K46 半终止", () => {
    const { project } = compileScoreText(`satb 1
key D major
meter 3/4
bars 1..1 {
 S: | F#5/4 E5/8 D#5/8 E5/4 |
 A: | A4/2. |
 T: | D4/4 C#4/8 B#3/8 C#4/4 |
 B: | A3/2. |
 H: | K46/4 V/8 r/8 V/4 |
}`);
    const [cadence] = buildHarmonyAnalysis(project).cadenceCandidates;
    expect(cadence).toMatchObject({ kind: "half", form: "authentic", fromTick: 0, toTick: 2880 });
    expect(cadence.evidence).toContainEqual(expect.objectContaining({ code: "dominant-neighbor-prolongation" }));
  });

  it.each<[string, Example]>([
    ["一个声部未返回原八度", { tenor: "B3/8 A#3/8 B4/8" }],
    ["同音异名冒充下方书写辅助音", { tenor: "B3/8 Bb3/8 B3/8" }],
    ["有声部休止", { soprano: "D5/8 r/8 D5/8" }],
    ["低音在缺口起奏同高音", { bass: "G2/8 G2/4" }],
    ["持留的上声部也重奏", { alto: "F4/8 F4/4" }],
    ["装饰占据比原和弦音更长的时值", { soprano: "D5/16 C#5/16~ C#5/8 D5/8" }],
  ])("%s 时保留原起点", (_label, change) => {
    remainsAtSecondDominant(fullExample(change));
  });

  it("双声部虽都级进折回，中段发全 C/G 时保留竞争解释", () => {
    remainsAtSecondDominant(fullExample({
      soprano: "D5/8 E5/8 D5/8",
      alto: "G4/4.",
      tenor: "B3/8 C4/8 B3/8",
      harmony: "V/8 r/8 V/8",
    }));
  });

  it("中间已有和弦标注时尊重实际和弦链", () => {
    remainsAtSecondDominant(fullExample({ harmony: "V7/8 IV/8 V7/8" }));
  });

  it("明确句界位于缺口内部时不从前一句借入起点", () => {
    const project = fullExample();
    project.structure.phraseBoundaries.push({ id: "manual-edge", tick: 720, source: "manual", confidence: "certain" });
    remainsAtSecondDominant(project);
  });

  it("调号在缺口内改变时不从原调借入起点", () => {
    const project = fullExample();
    project.keyEvents.push({ ...project.keyEvents[0], id: "changed-key", tick: 720 });
    remainsAtSecondDominant(project);
  });

  it("同一装饰若处在小节头，不作为弱位双辅助音桥接", () => {
    const project = fullExample();
    project.meterEvents[0] = { ...project.meterEvents[0], numerator: 1 };
    remainsAtSecondDominant(project);
  });
});

const anticipation = `satb 1
key C major
meter 2/4
bars 1..3 {
 S: | E4/2 | F4/4 F4/8 E4/8 | E4/2 |
 A: | C4/2 | C4/4 B3/4 | C4/2 |
 T: | G3/2 | A3/4 G3/4 | G3/2 |
 B: | C3/2 | F3/4 D3/8 C3/8 | C3/2 |
 H: | I/2 | IV/4 V43/8 r/8 | I/2 |
}`;

const delay = `satb 1
key D major
meter 3/4
bars 1..2 {
 S: | F#4/2 C#5/4 | E5/8. D5/16 D5/2 |
 A: | D4/2 G4/4~ | G4/8. F#4/16 F#4/2 |
 T: | A3/2 A3/4~ | A3/2. |
 B: | D3/2 A2/4 | D3/2. |
 H: | I/2 V7/4 | r/2. |
}
annotations {
 chord goal range=[2:1+3/4,3:1) symbol=I
}`;

type Project = ReturnType<typeof compileScoreText>["project"];

function closingCadence(p: Project) {
  return buildHarmonyAnalysis(p).cadenceCandidates.find(
    candidate => candidate.kind === "full" && candidate.form === "authentic",
  );
}

function stagedCadence(p: Project) {
  const candidate = closingCadence(p);
  return candidate?.evidence.some(evidence => evidence.code === "staged-tonic-arrival")
    ? candidate : undefined;
}

describe("主低音先于完整主和弦到达的正格终止", () => {
  it.each([
    ["弱位先现重奏", anticipation, 2880, 3840, 5760, "imperfect"],
    ["强拍提前落主并持续", delay, 1920, 3600, 5760, "perfect"],
  ])("%s，落点取上方声部完成解决的位置", (_label, text, fromTick, landing, toTick, completion) => {
    const project = compileScoreText(text).project;
    const expected = { fromTick, toTick, observedLandingTick: landing, completion, confidence: "probable" };
    const chords = structuredClone(project.chordTrack);
    const saved = stagedCadence(project);
    expect(saved).toMatchObject(expected);
    expect(project.chordTrack).toEqual(chords);
    const updated = addCadenceAnnotation(project, annotationFromCadenceCandidate(saved!, "arrival"));
    expect(updated.error).toBeUndefined()
    expect(buildHarmonyAnalysis(updated.project).cadenceAnnotations).toContainEqual(expect.objectContaining({
      id: "arrival", observedLandingTick: landing, stale: false,
    }));
  });

  it.each([
    ["主低音晚到", anticipation.replace("D3/8 C3/8", "D3/4")],
    ["持续导音等音改写", anticipation.replace("B3/4", "Cb4/4")],
    ["在先到低音上重奏未解决音", anticipation.replace("C4/4 B3/4", "C4/4 B3/8 B3/8")],
    ["空档包含已标独立和弦", anticipation.replace("V43/8 r/8", "V43/8 IV/8")],
    ["七音跨八度后才到三音", delay.replaceAll("F#4/16 F#4/2", "F#3/16 F#3/2")],
  ])("%s，缺少先到连接的充分证据", (_label, text) => {
    expect(stagedCadence(compileScoreText(text).project)).toBeUndefined();
  });

  it("未完成解决时经过换调或手动句界，候选不跨界", () => {
    const project = compileScoreText(delay).project;
    const { ppq } = project;
    const keySplit = structuredClone(project);
    keySplit.keyEvents.push({ ...keySplit.keyEvents[0], id: "written-key", tick: ppq * 3.5 });
    expect(stagedCadence(keySplit)).toBeUndefined();
    project.structure.phraseBoundaries.push({
      id: "split", tick: ppq * 3.5, source: "manual", confidence: "certain",
    });
    expect(stagedCadence(project)).toBeUndefined();
  });

  it("持续超过一记谱拍，后来的主和弦不能补认这次落点", () => {
    const text = delay.replace("E5/8. D5/16 D5/2", "E5/4. D5/4.")
      .replace("G4/8. F#4/16 F#4/2", "G4/4. F#4/4.")
      .replace("2:1+3/4", "2:2+1/2");
    expect(stagedCadence(compileScoreText(text).project)).toBeUndefined();
  });
});

const imperfect = `satb 1
key D major
meter 3/4
bars 1..2 {
 S: | A4/2 G4/4~ | G4/4 F#4/2 |
 A: | F#4/2 E4/4~ | E4/4 D4/2 |
 T: | D4/2 C#4/4~ | C#4/4 D4/2 |
 B: | A2/2 A2/4 | D3/2. |
 H: | K46/2 V7/4 | r/4 I/2 |
}`;

const perfect = `satb 1
key Eb major
meter 3/4
bars 1..2 {
 S: | Ab5/2 F5/4~ | F5/4 Eb5/2 |
 A: | C5/2 Ab4/4~ | Ab4/4 G4/2 |
 T: | Eb4/2 D4/4~ | D4/4 Eb4/2 |
 B: | Ab2/2 Bb2/4 | Eb3/2. |
 H: | IV/2 V7/4 | r/4 I/2 |
}`;

function authentic(project: ReturnType<typeof compileScoreText>["project"]) {
  return buildHarmonyAnalysis(project).cadenceCandidates.find(
    cadence => cadence.kind === "full" && cadence.form === "authentic",
  );
}

describe("主低音先到、上三声部延留的正格终止", () => {
  it.each([
    ["属七音在高音，保持 K46 左界", imperfect, 0, "imperfect"],
    ["属五音在高音，落在主音", perfect, 1920, "perfect"],
  ])("%s", (_label, text, fromTick, completion) => {
    const { project } = compileScoreText(text);
    const chords = structuredClone(project.chordTrack);
    expect(authentic(project)).toMatchObject({
      fromTick, toTick: 5760, completion, confidence: "probable",
      evidence: expect.arrayContaining([expect.objectContaining({
        code: "tonic-bass-suspension",
        refs: expect.arrayContaining(["note-B-2880", "note-T-1920", "note-T-3840"]),
      })]),
    });
    expect(project.chordTrack).toEqual(chords);
    expect(buildHarmonyAnalysis(project).slices.find(slice => slice.tick === 2880)?.chord).toBeUndefined();
  });

  it.each([
    ["女高同音重奏", imperfect.replace("G4/4~ | G4/4", "G4/4 | G4/4")],
    ["女高未持续", imperfect.replace("G4/4~ | G4/4", "G4/4 | r/4")],
    ["低音未持续过解决", imperfect.replace("D3/2.", "D3/4 D3/2")],
    ["跨八度延留解决", imperfect.replace("F#4/2 |", "F#5/2 |")],
    ["属导音未升至主音", imperfect.replace("C#4/4 D4/2", "C#4/4 A3/2")],
    ["七音被另一声部接替", imperfect.replace("G4/4 F#4/2", "G4/4 D5/2").replace("E4/4 D4/2", "E4/4 F#4/2")],
    ["起始属七拼写错误", imperfect.replaceAll("C#4", "Db4")],
    ["中间已有独立和弦标注", imperfect.replace("r/4 I/2", "ii/4 I/2")],
  ])("%s 不用该证据补终止", (_label, text) => {
    expect(authentic(compileScoreText(text).project)).toBeUndefined();
  });

  it.each([2880, 3360, 3840])("句界 %i 阻断延留连接", tick => {
    const { project } = compileScoreText(imperfect);
    project.structure.phraseBoundaries.push({ id: "boundary", tick, source: "manual", confidence: "certain" });
    expect(authentic(project)).toBeUndefined();
  });

  it("延留中新增同名调事件也阻断连接", () => {
    const { project } = compileScoreText(imperfect);
    project.keyEvents.push({ ...project.keyEvents[0], id: "repeat-key", tick: 3360 });
    expect(authentic(project)).toBeUndefined();
  });
});
