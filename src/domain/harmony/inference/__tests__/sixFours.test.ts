import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { inferChords, applyChordInference, applyHarmonyInference, inferHarmony } from "../pipeline";
import { checkHarmony } from "../../registry";
import { PPQ } from "../../../project";
import { phraseInferenceFingerprint } from "../../phrase/fingerprint";
import type { ChordInferenceResult, ChordInferenceOptions } from "../types";

function chords(s: string, a: string, t: string, b: string) {
  const project = compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
  S: | ${s} |
  A: | ${a} |
  T: | ${t} |
  B: | ${b} |
}`).project;
  return inferChords(project).regions;
}

describe("乐句和调性边界两侧的四六", () => {
  const passing = `satb 1
key F major
meter 3/4
bars 1..1 {
  S: | F4/4 G4/4 A4/4 |
  A: | C4/2. |
  T: | F3/4 E3/4 F3/4 |
  B: | A2/4 G2/4 F2/4 |
}`;
  const pedal = passing.replace("F4/4 G4/4 A4/4", "A4/4 Bb4/4 A4/4")
    .replace("C4/2.", "C4/4 D4/4 C4/4").replace("F3/4 E3/4 F3/4", "F3/2.")
    .replace("A2/4 G2/4 F2/4", "F2/2.");

  it.each([{ text: passing, role: "passing64" }, { text: pedal, role: "pedal64" }])(
    "只用同一句中的两个端点识别 $role", ({ text, role }) => {
      const project = compileScoreText(text).project;
      const middle = () => inferChords(project).regions.find(r => r.fromTick <= 960 && 960 < r.toTick);
      expect(middle()?.selected?.semantics?.cadenceRole).toBe(role);
      for (const tick of [960, 1440, 1920]) {
        project.structure.phraseBoundaries = [{ id: "phrase-cut", source: "manual", tick, confidence: "certain" }];
        expect(middle()?.selected?.semantics?.cadenceRole).not.toBe(role);
      }
      project.structure.phraseBoundaries = [];
      project.keyEvents.push({ ...project.keyEvents[0], id: "new-key-event", tick: 1920 });
      expect(middle()?.selected?.semantics?.cadenceRole).not.toBe(role);
    },
  );
});

describe("依据相邻和弦与实际低音判断四六用途", () => {
  it("弱拍 D–T64–D 按辅助四六写回主功能", () => {
    const middle = chords("D5/4 E5/4 D5/2", "B4/4 C5/4 B4/2", "G3/1", "G2/1")[1];
    expect(middle).toMatchObject({status:"resolved", selected:{functionalBaseId:"T", semantics:{cadenceRole:"pedal64"}}});
  });
  it("连接主和弦原位与第一转位的同向级进识别经过属四六", () => {
    const middle = chords("E5/4 D5/4 C5/2", "C4/4 B3/4 C4/2", "G3/1", "C3/4 D3/4 E3/2")[1];
    expect(middle).toMatchObject({status:"resolved", selected:{functionalBaseId:"D", semantics:{cadenceRole:"passing64"}}});
  });
  it("低音折返不会误标为经过四六", () => {
    const middle = chords("E5/4 D5/4 E5/2", "C4/4 B3/4 C4/2", "G3/1", "C3/4 D3/4 C3/2")[1];
    expect(middle.selected?.semantics?.cadenceRole).toBeUndefined();
  });
  it("同属低音上的强拍四六再奏，后接级进解决时整段带有终止证据", () => {
    const first = chords("E5/8 E5/8 D5/2.", "C4/4 B3/2.", "G3/1", "G2/1")[0];
    expect(first).toMatchObject({status:"resolved", selected:{functionalBaseId:"K46"}});
    expect(first.selected?.evidence).toContainEqual({kind:"sequence-context",code:"cadential64-resolution"});
  });
  it("强拍 K46 经声部换位、低音下跳八度解决到原位 D7，再归主", () => {
    const [first] = chords("E5/2 B4/4 C5/4", "G4/2 F4/4 E4/4", "C4/2 D4/4 G3/4", "G3/2 G2/4 C3/4");
    expect(first).toMatchObject({ status: "resolved", selected: { functionalBaseId: "K46" } });
  });
  it("同属低音上弱拍重新配音省去一音，后接 D–T 仍可确认 K46", () => {
    const [first] = chords("E5/4 G5/4 B4/4 C5/4", "G4/4 E4/4 F4/4 E4/4", "C4/4 E4/4 D4/4 G3/4", "G3/2 G2/4 C3/4");
    expect(first).toMatchObject({ fromTick: 0, toTick: 1920, status: "resolved", selected: { functionalBaseId: "K46" } });
    expect(first.selected?.evidence.map(e => e.code)).toContain("cadential64-revoicing");
  });

  const octaveExchange = `satb 1
key C major
meter 2/4
bars 1..1 {
  S: | E5/4 E5/8 D5/8 |
  A: | G4/4 G4/8 F4/8 |
  T: | C4/4 C4/8 B3/8 |
  B: | G3/4 G2/4 |
}`;

  it("在原声部实写的 4–3、6–5 下行前合并属低音八度换位", () => {
    const { project } = compileScoreText(octaveExchange);
    const first = inferChords(project).regions[0];
    expect(first).toMatchObject({ fromTick: 0, toTick: 1440, status: "resolved",
      selected: { functionalBaseId: "K46" }, alternatives: [] });
  });

  it.each([
    ["后继改变低音与和弦", octaveExchange.replace("D5/8", "C5/8").replace("B3/8", "A3/8")
      .replace("G2/4", "G2/8 F2/8"), undefined],
    ["缺一条下行时不以单纯属接续统一全段", octaveExchange.replace("G4/4 G4/8 F4/8", "G4/4 G4/8 D4/8")
      .replace("D5/8", "G5/8"), undefined],
    ["解决低音跳过两个八度", octaveExchange.replace("G2/4", "G2/8 G0/8"), undefined],
    ["已有句界位于首个持续切片中", octaveExchange, 480],
  ] as const)("不把早先的四六一起确认为 K46（%s）", (_name, score, cut) => {
    const { project } = compileScoreText(score);
    if (cut !== undefined) project.structure.phraseBoundaries = [{
      id: "cut", source: "manual", tick: cut, confidence: "certain",
    }];
    expect(inferChords(project).regions[0].status).toBe("ambiguous");
  });

  const neighbor = `satb 1
key C minor
meter 3/4
bars 1..2 {
  S: | C4/2 B3/4 | C4/2. |
  A: | G3/2 G3/4 | G3/2. |
  T: | Eb3/8 D3/8 Eb3/4 F3/4 | Eb3/2. |
  B: | G2/2 G2/4 | C3/2. |
}`;

  it("已证的内声邻音可留在同一个完整 K46–D7–t 中", () => {
    const { project } = compileScoreText(neighbor);
    const first = inferChords(project).regions[0];
    expect(first).toMatchObject({ toTick: 1920, status: "resolved", selected: { functionalBaseId: "K46" } });
    expect(first.selected?.fit.nonChordToneAssignments).toHaveProperty("note-T-480", "neighbor");
  });

  it("夹层未经邻音机制验证，或属主之间有句界时保留竞争", () => {
    const unproven = compileScoreText(neighbor.replace("G3/2 G3/4", "G3/8 G3/8 G3/4 G3/4")).project;
    expect(inferChords(unproven).regions[0].status).toBe("ambiguous");
    const split = compileScoreText(neighbor).project;
    split.structure.phraseBoundaries = [{ id: "cut", source: "manual", tick: 2880, confidence: "certain" }];
    expect(inferChords(split).regions[0].status).toBe("ambiguous");
  });
});

const descending = `satb 1
key D major
meter 3/4
bars 1..1 {
  S: | A4/4 B4/4 C#5/4 |
  A: | E4/2. |
  T: | A3/4 G#3/4 A3/4 |
  B: | C#3/4 B2/4 A2/4 |
}`;

function analyzeAppliedPassingSixFour(text: string, cut?: number) {
  const project = compileScoreText(text).project;
  if (cut !== undefined) project.structure.phraseBoundaries = [
    { id: "manual-cut", tick: cut, source: "manual", confidence: "certain" },
  ];
  const result = inferChords(project);
  const middle = result.regions.find(region => region.fromTick <= 960 && 960 < region.toTick)?.selected;
  const applied = applyChordInference(project, result, { mode: "fill-gaps" }).project;
  return { middle, diagnostics: checkHarmony(applied).diagnostics.filter(item => item.tick === 960) };
}

describe("临时主和声的两个转位之间的经过属四六", () => {
  const ascending = descending.replace("A4/4 B4/4 C#5/4", "C#5/4 B4/4 A4/4")
    .replace("C#3/4 B2/4 A2/4", "A2/4 B2/4 C#3/4");

  it.each([["下行", descending], ["上行", ascending]])("低音%s且上方实际交换时写入用途", (_, text) => {
    const { middle, diagnostics } = analyzeAppliedPassingSixFour(text);
    expect(middle?.semantics?.cadenceRole).toBe("passing64");
    expect(middle?.semantics?.interpretations[0].appliedTarget).toMatchObject({ degree: 5, primaryFunction: "dominant" });
    expect(diagnostics.map(d => d.ruleId)).not.toContain("chord.second-inversion-voicing");
    expect(diagnostics.map(d => d.ruleId)).not.toContain("connection.second-inversion-context");
  });

  it("六和弦重复五音时内声部可经属三音作三度进行", () => {
    const doubledFifth = ascending.replace("G#3/4 A3/4", "G#3/4 E3/4");
    expect(analyzeAppliedPassingSixFour(doubledFifth).middle?.semantics?.cadenceRole).toBe("passing64");
    const displaced = doubledFifth.replace("G#3/4 E3/4", "G#3/4 E4/4");
    expect(analyzeAppliedPassingSixFour(displaced).middle?.semantics?.cadenceRole).not.toBe("passing64");
  });

  it("弱拍起奏后持续超过一拍不归为经过", () => {
    const prolonged = descending.replace("meter 3/4", "meter 4/4")
      .replace("B4/4", "B4/2").replace("E4/2.", "E4/1")
      .replace("G#3/4", "G#3/2").replace("B2/4", "B2/2");
    expect(analyzeAppliedPassingSixFour(prolonged).middle?.semantics?.cadenceRole).not.toBe("passing64");
  });

  it("句界隔开落点时仍检查未经证实的四六", () => {
    const { middle, diagnostics } = analyzeAppliedPassingSixFour(descending, 1920);
    expect(middle?.semantics?.cadenceRole).toBeUndefined();
    expect(diagnostics.map(d => d.ruleId)).toContain("chord.second-inversion-voicing");
  });

  it("低音折返及上方同音级错八度不能证明经过", () => {
    for (const text of [
      descending.replace("C#3/4 B2/4 A2/4", "C#3/4 B2/4 C#3/4"),
      descending.replace("B4/4", "B5/4"),
      descending.replace("G#3/4", "G#2/4"),
    ]) expect(analyzeAppliedPassingSixFour(text).middle?.semantics?.cadenceRole).not.toBe("passing64");
  });
});

const weakerThenPredominant = `satb 1
key D major
meter 4/4
bars 1..3 {
  S: | G5/2 E5/4 F#5/4 | D5/2 E5/2 | F#5/1 |
  A: | B4/2 C#4/4 D4/4 | B4/2 C#4/2 | D4/1 |
  T: | E4/2 A3/2 | G3/2 A3/2 | A3/1 |
  B: | G2/2 A2/2 | G2/2 A2/2 | D3/1 |
}`;

const genuineCadential = `satb 1
key D major
meter 4/4
bars 1..2 {
  S: | G5/2 F#5/4 E5/4 | D5/1 |
  A: | B4/2 D4/4 C#4/4 | F#4/1 |
  T: | D4/2 A3/4 A3/4 | A3/1 |
  B: | G2/2 A2/4 A1/4 | D2/1 |
}`;

const tick = 3 * PPQ;
const at = (result: ChordInferenceResult, time = tick) =>
  result.regions.find(region => region.fromTick <= time && time < region.toTick);
const hasProof = (result: ChordInferenceResult) => result.regions.some(region =>
  region.selected?.evidence.some(item => item.code === "tonic-six-four-before-stronger-predominant"));
const compile = (text = weakerThenPredominant) => compileScoreText(text).project;

describe("较弱主四六与较强下属到点的局部判别", () => {
  it("用真实低音与完整下属区分同实体备选，保留 K46 和原路径分", () => {
    const project = compile();
    const inference = inferHarmony(project);
    const region = at(inference.chordInference)!;
    expect(region).toMatchObject({
      fromTick: tick, toTick: 4 * PPQ, status: "resolved",
      selected: { functionalBaseId: "T" },
      alternatives: [{ functionalBaseId: "K46" }],
    });
    expect(hasProof(inference.chordInference)).toBe(true);
    expect(region.selected?.identity).toEqual(region.alternatives[0].identity);
    expect(region.selected?.pathScore).toBe(region.alternatives[0].pathScore);
    const applied = applyHarmonyInference(project, inference, { mode: "fill-gaps" }).project;
    const written = applied.chordTrack.regions.find(item => item.startTick === tick);
    expect(written?.identity).toEqual(region.selected?.identity);
    expect(written?.semantics?.cadenceRole).toBeUndefined();
    expect(checkHarmony(applied).diagnostics).toContainEqual(expect.objectContaining({
      tick, ruleId: "chord.second-inversion-voicing", severity: "warning",
    }));
  });

  it("只选中证明区间的一部分时，仍用完整原谱前后文且保留备选", () => {
    const fromTick = tick + PPQ / 4, toTick = tick + PPQ / 2;
    const result = inferChords(compile(), { fromTick, toTick });
    expect(hasProof(result)).toBe(true);
    expect(result.regions).toMatchObject([{
      fromTick, toTick, status: "resolved", selected: { functionalBaseId: "T" },
      alternatives: [{ functionalBaseId: "K46" }],
    }]);
  });

  it("保留实际属根低音八度相接、有更弱属落点的真 K46", () => {
    const result = inferChords(compile(genuineCadential));
    expect(hasProof(result)).toBe(false);
    expect(at(result, 2 * PPQ)).toMatchObject({ status: "resolved", selected: { functionalBaseId: "K46" } });
  });

  it("下属更弱的同类实写转接继续显示双解", () => {
    const score = weakerThenPredominant.replace("E5/4 F#5/4", "E5/4 F#5/8 D5/8")
      .replace("C#4/4 D4/4", "C#4/4 D4/8 B4/8")
      .replace("E4/2 A3/2", "E4/2 A3/4. G3/8")
      .replace("G2/2 A2/2", "G2/2 A2/4. G2/8");
    const result = inferChords(compile(score));
    expect(hasProof(result)).toBe(false);
    expect(at(result)).toMatchObject({ status: "ambiguous", alternatives: [{ functionalBaseId: "K46" }] });
  });

  it.each([
    ["真实句界", "manual", false],
    ["仍匹配当前输入的自动句界", "inferred", false],
    ["标为历史的自动句界", "inferred", true],
  ] as const)("%s 按既有有效边界行为处理", (_label, source, stale) => {
    const project = compile();
    project.structure.phraseBoundaries.push({
      id: "context-boundary", tick: 4 * PPQ, source, stale, confidence: "certain",
      inferenceFingerprint: source === "inferred" ? phraseInferenceFingerprint(project) : undefined,
    });
    const result = inferChords(project);
    expect(hasProof(result)).toBe(stale);
    expect(at(result)?.status).toBe(stale ? "resolved" : "ambiguous");
  });

  it("调事件重置时保留双解，即使两端有效调名相同", () => {
    const project = compile();
    project.keyEvents.push({ ...project.keyEvents[0], tick: 4 * PPQ, id: "same-key-new-event" });
    const result = inferChords(project);
    expect(hasProof(result)).toBe(false);
    expect(at(result)).toMatchObject({ status: "ambiguous", alternatives: [{ functionalBaseId: "K46" }] });
  });

  it("局部低于男低音或目标异名时均不能使用证据", () => {
    const belowBass = weakerThenPredominant.replace("G3/2 A3/2", "G1/2 A3/2");
    const wrongSpelling = weakerThenPredominant.replace("C#4/4 D4/4", "C#4/4 C##4/4");
    for (const score of [belowBass, wrongSpelling]) expect(hasProof(inferChords(compile(score)))).toBe(false);
  });
});

// From Huang, lower volume, exercise 11(1), first statement of the E-major line.
const score = `satb 1
key E major
meter 4/4
bars 1..2 {
  S: | r/2. B4/4~ | B4/4 C#5/4 D#5/4 E5/4 |
  A: | r/2. F#4/4 | E4/2 F#4/4 G#4/4 |
  T: | r/2. D#4/4 | B3/1 |
  B: | r/2. B3/8 A3/8 | G#3/2 F#3/4 E3/4 |
}`;

function analyzeDecoratedPassingSixFour(source = score, cut?: number, allowNonChordToneCandidates?: boolean) {
  const project = compileScoreText(source).project;
  const tick = 6 * project.ppq;
  if (cut !== undefined) project.structure.phraseBoundaries = [
    { id: "cut", source: "manual", tick: cut * project.ppq, confidence: "certain" },
  ];
  const inferred = inferChords(project, { allowNonChordToneCandidates });
  const result = applyChordInference(project, inferred, { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
  const diagnostics = checkHarmony(result).diagnostics;
  return {
    diagnostics,
    middle: inferred.regions.find(r => r.fromTick === tick)?.selected,
    ornament: result.satbTracks[0].notes.find(n => n.startTick === 5 * project.ppq),
    warnings: diagnostics.filter(d => d.tick === tick &&
      d.ruleId === "chord.second-inversion-voicing"),
  };
}

describe("经过属四六前的单一上方经过音", () => {
  it("在写入前一主六和弦及女高音经过证据后标出经过四六", () => {
    const { middle, ornament, warnings, diagnostics } = analyzeDecoratedPassingSixFour();
    expect(middle?.semantics?.cadenceRole).toBe("passing64");
    expect(ornament?.nonChordToneRole).toBe("passing");
    expect(warnings).toHaveLength(0);
    expect(diagnostics.filter(d => ["chord.first-inversion-doubling", "nonchord.passing-tone"].includes(d.ruleId))).toEqual([]);
  });

  it.each([
    ["女高音同音级错八度，失去实际级进", score.replace("C#5/4", "C#6/4"), undefined],
    ["中声部实际重复属和弦根音", score.replace("E4/2 F#4/4", "E4/2 B4/4"), undefined],
    ["句界切断实际解决", score, 7],
  ] as const)("保留未证用途或实际错配的警告（%s）", (_name, source, cut) => {
    const { middle, warnings } = analyzeDecoratedPassingSixFour(source, cut);
    expect(middle?.semantics?.cadenceRole).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("关闭和弦外音推导时不新写声部角色与六四证据", () => {
    const { middle, ornament, warnings } = analyzeDecoratedPassingSixFour(score, undefined, false);
    expect(middle?.semantics?.cadenceRole).toBeUndefined();
    expect(ornament?.nonChordToneRole).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

interface Example {
  soprano?: string;
  alto?: string;
  tenor?: string;
  bass?: string;
  meter?: string;
  key?: string;
}
function example({
  soprano = "C5/4 F4/4", alto = "F4/2", tenor = "A3/2", bass = "F3/2",
  meter = "2/4", key = "C major",
}: Example = {}) {
  return compileScoreText(`satb 1
key ${key}
meter ${meter}
bars 1..1 {
  S: | ${soprano} |
  A: | ${alto} |
  T: | ${tenor} |
  B: | ${bass} |
}`).project;
}
type Project = ReturnType<typeof example>;

function regionAt(project: Project, tick: number, options?: ChordInferenceOptions) {
  return inferHarmony(project, options).chordInference.regions.find(region =>
    region.fromTick <= tick && tick < region.toTick);
}

describe("单上声部和弦内换音短暂省五", () => {
  it("前完整后省五只改变候选拟合，正常写回后仍报告真实缺音", () => {
    const project = example();
    const result = inferHarmony(project);
    expect(regionAt(project, PPQ)).toMatchObject({
      fromTick: 0, toTick: 2 * PPQ, status: "resolved",
      selected: {
        functionalBaseId: "S", confidence: "medium",
        fit: { omittedChordDegrees: [5], nonChordToneNoteIds: [], nonChordToneAssignments: {} },
        evidence: expect.arrayContaining([
          { kind: "sequence-context", code: "single-voice-triad-revoicing",
            noteIds: ["note-S-0", "note-S-960"] },
        ]),
      },
    });
    const applied = applyHarmonyInference(project, result, { mode: "fill-gaps", writeNonChordToneRoles: true });
    expect(applied.writtenNonChordToneRoleCount).toBe(0);
    expect(checkHarmony(applied.project).diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "chord.incomplete-members", severity: "warning", tick: PPQ, params: { missing: "C" },
    }));
  });

  it("后置完整重属向前补齐和弦身份，选区只写回被选区间", () => {
    const project = example({
      key: "C minor", soprano: "D5/2", alto: "F#4/2", tenor: "D4/4 A3/4", bass: "D3/2",
    });
    const options = { fromTick: PPQ / 4, toTick: PPQ };
    const inferred = inferHarmony(project, options);
    expect(inferred.chordInference.regions).toEqual([expect.objectContaining({
      fromTick: PPQ / 4, toTick: PPQ, status: "resolved",
      selected: expect.objectContaining({
        functionalBaseId: "DD", identity: expect.objectContaining({ root: { step: "D", alter: 0 } }),
        fit: expect.objectContaining({ omittedChordDegrees: [5] }),
      }),
    })]);
    const applied = applyHarmonyInference(project, inferred, { mode: "fill-gaps" });
    expect(applied.project.chordTrack.regions).toEqual([expect.objectContaining({
      startTick: PPQ / 4, durationTicks: 3 * PPQ / 4,
    })]);
    expect(regionAt(project, 0, { minConfidence: "high" })?.status).toBe("unclassified");
  });

  it("后置完整小三和弦支持省五，识别不依靠非和弦音选项", () => {
    const project = example({ soprano: "F4/4 A4/4", alto: "D4/2", tenor: "F3/2", bass: "D3/2" });
    expect(regionAt(project, 0, { allowNonChordToneCandidates: false })?.selected).toMatchObject({
      identity: { root: { step: "D" }, structure: { quality: "minor" } },
      fit: { omittedChordDegrees: [5], nonChordToneNoteIds: [] },
    });
  });

  it.each([
    ["同音重奏的低音", { bass: "F3/4 F3/4" }],
    ["换八度的低音", { bass: "F3/4 F2/4" }],
    ["上方声部跨到记名低音以下", { tenor: "A2/2" }],
    ["同音重奏的另一上方声部", { alto: "F4/4 F4/4" }],
    ["另一端五音写作等音异名", { soprano: "B#4/4 F4/4" }],
    ["较长的省五区间", { meter: "3/4", soprano: "C5/4 F4/2",
      alto: "F4/2.", tenor: "A3/2.", bass: "F3/2." }],
  ] satisfies [string, Example][])("%s 保留未分类", (_label, score) => {
    expect(regionAt(example(score), PPQ)?.status).toBe("unclassified");
  });

  it.each([PPQ, 3 * PPQ / 2])("手动句界 %s 阻止借用完整陈述", tick => {
    const project = example();
    project.structure.phraseBoundaries = [{ id: "boundary", tick, source: "manual", confidence: "certain" }];
    expect(regionAt(project, PPQ)?.status).toBe("unclassified");
  });

  it("同一书写调性重新起调号事件也切断依据", () => {
    const project = example();
    project.keyEvents.push({ ...project.keyEvents[0], tick: PPQ, id: "key-2" });
    expect(regionAt(project, PPQ)?.status).toBe("unclassified");
  });

  it("两侧 F 与 Dm/F 竞争时留空，双方均 F 时可连写", () => {
    const common = { meter: "3/4", alto: "F4/2.", tenor: "A3/2.", bass: "F3/2." };
    const different = example({ ...common, soprano: "C5/4 F4/4 D5/4" });
    expect(regionAt(different, 0)?.selected?.identity.root.step).toBe("F");
    expect(regionAt(different, PPQ)?.status).toBe("unclassified");
    expect(regionAt(different, 2 * PPQ)?.selected?.identity.root.step).toBe("D");
    const same = example({ ...common, soprano: "C5/4 F4/4 C5/4" });
    expect(regionAt(same, PPQ)).toMatchObject({ fromTick: 0, toTick: 3 * PPQ, status: "resolved" });
  });
});
