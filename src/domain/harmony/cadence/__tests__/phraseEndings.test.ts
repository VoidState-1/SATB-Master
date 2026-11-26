import { describe, expect, it } from "vitest";
import { addCadenceAnnotation, addPhraseBoundary } from "../../../editing";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { migrateProject, normalizeProject, validateProject, PPQ } from "../../../project";
import { createHarmonyRuleContext } from "../../rules/context/createRuleContext";
import { annotationFromCadenceCandidate } from "../model";
import { phraseInferenceFingerprint } from "../../phrase";
import { applyHarmonyInference, inferChords, inferHarmony } from "../../inference";
import { detectProjectCadences } from "../projectEvidence";

const invertedAuthentic = `satb 1
key G major
meter 3/4
bars 1..4 {
 S: | B4/2. | C5/2 D5/4 | B4/2. | G4/4 B4/4 A4/4 |
 A: | G4/2. | G4/2 A4/4 | G4/2. | E4/4 G4/4 F#4/4 |
 T: | D4/2. | E4/2 D4/4 | D4/2. | C4/4 D4/4 D4/4 |
 B: | G3/2. | C3/2 F#3/4 | G3/2. | C3/4 B2/4 D3/4 |
 H: | I/2. | IV/2 V6/4 | I/2. | IV/4 I6/4 V/4 |
}`;

const deceptive = `satb 1
key C major
meter 3/4
bars 1..4 {
 S: | E5/2. | C5/2 B4/4 | C5/2. | A4/4 E5/4 D5/4 |
 A: | C5/2. | A4/2 F4/4 | E4/2. | F4/4 C5/4 B4/4 |
 T: | G4/2. | F4/2 D4/4 | C4/2. | C4/4 G4/4 G4/4 |
 B: | C3/2. | F3/2 G3/4 | A3/2. | F3/4 C3/4 G3/4 |
 H: | I/2. | IV/2 V7/4 | vi/2. | IV/4 I/4 V/4 |
}`;

const projectOf = (text: string) => compileScoreText(text).project;

describe("属准备与局部转位正格", () => {
  it.each([["F#4", 0], ["D4", 2]])("半终止仅在副属导音 %s 同声部解决时纳入准备", (lead, start) => {
    const project = projectOf(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${lead}/2 G4/2 |
 A: | C4/2 B3/2 |
 T: | A3/2 D3/2 |
 B: | D2/2 G2/2 |
 H: | V7/V/2 V/2 |
}`);
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toMatchObject([
      { kind: "half", fromTick: start * PPQ, landingTick: 2 * PPQ, toTick: 4 * PPQ },
    ]);
  });

  it.each([["G#4/4 A4/2", true], ["G#4/4 E4/2", false]])("局部转位属收束由实写导音解决确认 %s", (alto, resolved) => {
    const project = projectOf(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | B4/4 D5/4 C5/2 |
 A: | G#4/4 ${alto} |
 T: | E4/4 E4/4 E4/2 |
 B: | E3/4 B2/4 A2/2 |
}
annotations {
 chord v at=1:1 duration=1/4 symbol=V localKey="A minor"
 chord inv at=1:2 duration=1/4 symbol=V43 localKey="A minor"
 chord end at=1:3 duration=1/2 symbol=i localKey="A minor"
}`);
    const full = buildHarmonyAnalysis(project).cadenceCandidates.filter(c => c.kind === "full");
    if (resolved) expect(full).toMatchObject([{ completion: "imperfect", landingTick: 2 * PPQ }]);
    else expect(full).toEqual([]);
  });
});

describe("句内强拍上的阻碍收束", () => {
  const applied = `satb 1
key C major
meter 2/2
bars 1..3 {
 S: | C5/2 C5/4. B4/8 | A4/2 G4/2 | C5/1 |
 A: | A4/2 G#4/2 | A4/2 B4/2 | G4/1 |
 T: | E4/2 D4/2 | C4/2 D4/2 | E4/1 |
 B: | A2/2 E2/2 | F2/2 G2/2 | C3/1 |
 H: | vi/2 V7/VI/2 | IV/2 V/2 | I/1 |
}`;
  const inMinor = applied.replace("key C major", "key A minor")
    .replace("vi/2 V7/VI/2", "i/2 V7/2").replace("IV/2 V/2", "VI/2 VII/2").replace("I/1", "III/1");
  it.each([["已建立的副属目标", applied], ["小调", inMinor]])("%s的五升六保留起止与句内归属", (_label, text) => {
    expect(buildHarmonyAnalysis(projectOf(text)).cadenceCandidates).toContainEqual(expect.objectContaining({
      kind: "deceptive", form: "authentic", fromTick: 2 * PPQ, landingTick: 4 * PPQ, toTick: 6 * PPQ,
      evidence: expect.arrayContaining([expect.objectContaining({ code: "written-deceptive-clausula" })]),
    }));
  });
  it.each([
    ["普通等时值进行", inMinor.replace("C5/4. B4/8", "B4/2")],
    ["导音没有同声部解决", inMinor.replace("G#4/2 | A4/2", "G#4/2 | C5/2")],
    ["副属缺少目标调主和弦支撑", applied.replace("vi/2 V7/VI/2", "IV/2 V7/VI/2")],
  ])("%s保留为普通进行", (_label, text) => {
    expect(buildHarmonyAnalysis(projectOf(text)).cadenceCandidates.some(c => c.kind === "deceptive")).toBe(false);
  });
});
const interior = (project: ReturnType<typeof projectOf>) =>
  buildHarmonyAnalysis(project).cadenceCandidates.find(c =>
    c.evidence.some(item => item.code === "articulated-interior-ending"));

describe("整小节齐收后的句内终止", () => {
  it.each([
    [invertedAuthentic, { kind: "full", form: "authentic", completion: "imperfect" }],
    [deceptive, { kind: "deceptive" }],
  ])("在整小节齐收时复用终止类型并可接受为标注", (text, expected) => {
    const project = projectOf(text);
    const before = structuredClone(project.structure);
    const cadence = interior(project);
    expect(cadence).toMatchObject({
      ...expected, fromTick: 4800, toTick: 8640, confidence: "probable",
      phraseId: "phrase-0-11520",
      evidence: expect.arrayContaining([expect.objectContaining({
        code: "articulated-interior-ending",
        refs: expect.arrayContaining(["note-B-5760", "note-B-8640"]),
      })]),
    });
    expect(project.structure).toEqual(before);
    if (!cadence) throw Error("Missing interior cadence");
    const added = addCadenceAnnotation(project, {
      id: "accepted", phraseId: cadence.phraseId, fromTick: cadence.fromTick, toTick: cadence.toTick,
      kind: cadence.kind, form: cadence.form, completion: cadence.completion,
      locked: false, source: "accepted-candidate", confidence: "probable",
    });
    expect(added.error).toBeUndefined();
    expect(buildHarmonyAnalysis(added.project).cadenceAnnotations).toEqual([
      expect.objectContaining({ id: "accepted", toTick: 8640 }),
    ]);
  });

  it.each([
    ["整小节内有同音重奏", invertedAuthentic.replace("D5/4 | B4/2.", "D5/4 | B4/4 B4/2")],
    ["落点后没有短节奏重启", invertedAuthentic
      .replace("G4/4 B4/4 A4/4", "G4/2.")
      .replace("E4/4 G4/4 F#4/4", "E4/2.")
      .replace("C4/4 D4/4 D4/4", "C4/2.")
      .replace("C3/4 B2/4 D3/4", "C3/2.")
      .replace("IV/4 I6/4 V/4", "IV/2.")],
    ["低音中的导音越八度", invertedAuthentic.replace("F#3/4 | G3", "F#2/4 | G3")],
    ["阻碍落点的导音未升", deceptive.replace("B4/4 | C5/2.", "B4/4 | A4/2.")],
    ["属七音跳向 VI 三音", deceptive.replace("F4/4 | E4/2.", "F5/4 | E4/2.")],
    ["源和弦未确定为属功能", invertedAuthentic.replace("IV/2 V6/4", "IV/2 ii6/4")],
  ])("%s 保留为普通句内进行", (_label, text) => {
    expect(interior(projectOf(text))).toBeUndefined();
  });

  it("人工句界仍由既有终止路径处理", () => {
    const project = projectOf(invertedAuthentic);
    project.structure.phraseBoundaries.push({ id: "manual", tick: 8640, confidence: "certain", source: "manual" });
    const candidates = buildHarmonyAnalysis(project).cadenceCandidates.filter(c => c.toTick === 8640);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "full", fromTick: 2880 });
    expect(candidates[0].evidence.some(item => item.code === "articulated-interior-ending")).toBe(false);
  });
});

const closedReturn = `satb 1
key D major
meter 4/4
bars 1..1 {
  S: | D5/1 |
  A: | F#4/2 G4/4 F#4/4 |
  T: | A3/2 B3/4 A3/4 |
  B: | D3/1 |
  H: | I/2 IV64/4@auxiliary I/4 |
}
annotations {
  chord auxiliary role=pedal64
}`;

function cadences(text: string) {
  return buildHarmonyAnalysis(compileScoreText(text).project).cadenceCandidates;
}

describe("句末下属四六辅助回返", () => {
  it.each([
    ["女高持续", closedReturn],
    ["女低持续", closedReturn.replace("S: | D5/1", "S: | F#5/2 G5/4 F#5/4")
      .replace("A: | F#4/2 G4/4 F#4/4", "A: | D4/1")],
    ["和弦标注没有预填辅助用途", closedReturn.replace("@auxiliary", "")
      .replace(/\nannotations \{[\s\S]+$/, "")],
  ])("%s，实写短辅助闭环无需另发终止", (_label, text) => {
    expect(cadences(text)).toEqual([]);
  });

  it.each([
    ["同音低音重奏", closedReturn.replace("B: | D3/1", "B: | D3/2. D3/4")],
    ["低音回主时换八度", closedReturn.replace("B: | D3/1", "B: | D3/2. D2/4")],
    ["实音缺失", closedReturn.replace("B: | D3/1", "B: | D3/2 r/4 D3/4")],
    ["上声部回主时另起", closedReturn.replace("S: | D5/1", "S: | D5/2. D5/4")],
    ["回主后低音另作节奏收束", closedReturn.replace("B: | D3/1", "B: | D3/2.. D3/8")],
    ["内声跨八度回到相同音级", closedReturn.replace("G4/4 F#4/4", "G4/4 F#5/4")],
    ["辅助标签不符实际声部", closedReturn.replace("A3/2 B3/4", "A3/2 C4/4")],
    ["中间四六较强", closedReturn
      .replace("D5/1", "r/4 D5/2.").replace("D3/1", "r/4 D3/2.")
      .replace("F#4/2 G4/4 F#4/4", "r/4 F#4/4 G4/4 F#4/4")
      .replace("A3/2 B3/4 A3/4", "r/4 A3/4 B3/4 A3/4")
      .replace("I/2 IV64/4@auxiliary I/4", "r/4 I/4 IV64/4@auxiliary I/4")],
  ])("%s，不能用辅助闭环排除候选", (_label, text) => {
    expect(cadences(text)).toMatchObject([{ kind: "supplementary", form: "plagal" }]);
  });

  it("实写根位下属与低音归主保留独立变格", () => {
    const text = closedReturn.replace("S: | D5/1", "S: | D5/2. A4/4")
      .replace("B: | D3/1", "B: | D3/2 G2/4 D3/4").replace("IV64", "IV");
    expect(cadences(text)).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect" }]);
  });

  it("保留真正正格落主和随后持音补充变格", () => {
    const text = closedReturn.replace("1..1", "1..2")
      .replace("S: | D5", "S: | E5/1 | D5")
      .replace("A: | F#4", "A: | C#5/1 | F#4")
      .replace("T: | A3", "T: | A3/1 | A3")
      .replace("B: | D3", "B: | A2/1 | D3")
      .replace("H: | I", "H: | V/1 | I");
    expect(cadences(text)).toMatchObject([
      { kind: "full", form: "authentic", completion: "perfect", fromTick: 0, toTick: 5760 },
      { kind: "supplementary", form: "plagal", fromTick: 5760, toTick: 7680 },
    ]);
  });

  it("正格后实际休止和明确句界仍保留补充", () => {
    const text = closedReturn.replace("1..1", "1..2")
      .replace("S: | D5", "S: | E5/2 D5/4 r/4 | D5")
      .replace("A: | F#4", "A: | C#5/2 F#4/4 r/4 | F#4")
      .replace("T: | A3", "T: | A3/2 A3/4 r/4 | A3")
      .replace("B: | D3", "B: | A2/2 D3/4 r/4 | D3")
      .replace("H: | I", "H: | V/2 I/4 r/4 | I")
      .replace("chord auxiliary", "phrase first range=[1:1,1:4)\n  chord auxiliary");
    expect(cadences(text)).toMatchObject([
      { kind: "full", form: "authentic", completion: "perfect", fromTick: 0, toTick: 2880 },
      { kind: "supplementary", form: "plagal", fromTick: 5760, toTick: 7680 },
    ]);
  });
});

// One three-beat opening, notated eighth rests between the cadential attacks,
// and a single-line pickup after vi. The second statement reaches I.
const parts = {
  S: ["A4/4 G4/4 F4/4", "D5/4 r/8 G4/4 r/8", "A4/4 E4/8 F4/8 G4/4",
      "A4/4 G4/4 F4/4", "D5/4 r/8 G4/4 r/8", "F4/2."],
  A: ["F4/4 E4/4 C4/4", "Bb4/4 r/8 E4/4 r/8", "F4/4 r/2",
      "F4/4 E4/4 C4/4", "Bb4/4 r/8 E4/4 r/8", "C4/2."],
  T: ["C4/4 Bb3/4 A3/4", "G3/4 r/8 C4/4 r/8", "D4/4 r/2",
      "C4/4 Bb3/4 A3/4", "G3/4 r/8 Bb3/4 r/8", "A3/2."],
  B: ["F2/4 C3/4 F2/4", "Bb2/4 r/8 C3/4 r/8", "D3/4 r/2",
      "F2/4 C3/4 F2/4", "Bb2/4 r/8 C3/4 r/8", "F2/2."],
  H: ["I/4 V7/4 I/4", "ii6/4 r/8 V/4 r/8", "vi/4 r/2",
      "I/4 V7/4 I/4", "ii6/4 r/8 V7/4 r/8", "I/2."],
};

function score(edit?: (copy: typeof parts) => void) {
  const copy = structuredClone(parts);
  edit?.(copy);
  return compileScoreText(["satb 1", "key F major", "meter 3/4", "bars 1..6 {",
    ...Object.entries(copy).map(([v, bars]) => v + ": | " + bars.join(" | ") + " |"), "}"].join("\n")).project;
}

type Doc = ReturnType<typeof score>;
function first(p: Doc) {
  return buildHarmonyAnalysis(p).cadenceCandidates.filter(c => c.kind === "deceptive");
}

describe("在相同材料的两次顿奏收束中识别第一次属到六级", () => {
  it("原音跨齐休到 VI，重奏落主，两个终止分别附着于实际发声区间", () => {
    const p = score(), snapshot = structuredClone(p);
    const z = buildHarmonyAnalysis(p);
    expect(z.cadenceCandidates.map(c => [c.kind, c.fromTick, c.toTick]))
      .toEqual([["deceptive", 4320, 6720], ["full", 12960, 17280]]);
    expect(first(p)[0]).toMatchObject({ confidence: "probable",
      evidence: expect.arrayContaining([expect.objectContaining({code:"detached-deceptive-reprise"})]) });
    expect(z.phraseSegments).toHaveLength(1);
    expect(p).toEqual(snapshot);
  });

  it("三声齐备的 VI 允许有声部休止", () => {
    expect(first(score(q => { q.T[2] = "r/2."; }))).toHaveLength(1);
  });

  it.each<[string, (q: typeof parts) => void]>([
    ["同属调邻接，但没有全休", q => { q.T[1] = "G3/4 r/8 C4/4."; }],
    ["全休中另有标注", q => { q.H[1] = "ii6/4 r/8 V/4 I/8"; }],
    ["新起动机相同节奏、音高不同", q => { q.S[3] = "F4/4 G4/4 A4/4"; }],
    ["旋律相同但低音改变", q => { q.B[3] = "F2/4 E2/4 F2/4"; }],
    ["两个终止之间已有新和声段落", q => { q.A[2] = "F4/4 C4/2"; }],
    ["提前奏 D，第二次有不同的准备节奏", q => {
      for (const v of Object.keys(q) as (keyof typeof q)[]) {
        const [pre, , dom] = q[v][1].split(" ");
        q[v][1] = [pre.replace("/4", "/8"), "r/8", dom, "r/4"].join(" ");
      }
    }],
    ["vi 的根或三音没有实际奏出", q => { q.A[2] = "A4/4 r/2"; }],
    ["原声部的导音跳错八度", q => { q.A[2] = "F3/4 r/2"; }],
    ["真正的 V/vi 到 vi", q => { q.H[1] = "ii6/4 r/8 V7/VI/4 r/8"; q.B[1] = "Bb2/4 r/8 A2/4 r/8";
      q.A[1] = "Bb4/4 r/8 C#4/4 r/8"; q.T[1] = "G3/4 r/8 E3/4 r/8"; }],
    ["短 VI 后直接进入下属，句内的阻碍进行继续", q => {
      q.S[1] = "G4/4 A4/8 Bb4/4 r/8"; q.A[1] = "E4/4 F4/8 F4/4 r/8";
      q.T[1] = "C4/4 D4/8 D4/4 r/8"; q.B[1] = "C3/4 D3/8 Bb2/4 r/8";
      q.H[1] = "V/4 vi/8 IV/4 r/8";
    }],
    ["末次没有可信的本调主和弦", q => { q.H[5] = "r/2."; }],
    ["末次根音未实际发声", q => { q.B[5] = "A2/2."; }],
  ])("%s 不增发阻碍终止", (_name, edit) => {
    expect(first(score(edit))).toEqual([]);
  });

  it("齐休处的手工句界、换调事件和明确的局部解释各自阻断配对", () => {
    const p = score();
    p.structure.phraseBoundaries.push({id:"cut",tick:5280,source:"manual",confidence:"certain"});
    expect(first(p)).toEqual([]);
    const keyed = score();
    keyed.keyEvents.push({...keyed.keyEvents[0],id:"again",tick:5280});
    expect(first(keyed)).toEqual([]);
    const local = score();
    const source = local.chordTrack.regions.find(c => c.startTick === 4320)!;
    source.semantics!.interpretations[0].localKey = {tonic:{step:"D",alter:0}, mode:"minor"};
    expect(first(local)).toEqual([]);
  });
});

describe("阻碍重奏与无和弦标注的稀疏末主", () => {
  it.each([true, false])("同一份三声末主，给定 I = %s", labeled => {
    const project = score(q => {
      q.A[5] = "r/2.";
      if (!labeled) q.H[5] = "r/2.";
    });
    const snapshot = structuredClone(project);
    const analysis = buildHarmonyAnalysis(project);
    const endTick = 14400;
    const ending = analysis.slices.find(s => s.tick === endTick)!;
    expect(analysis.phraseSegments).toHaveLength(1);
    expect(Object.keys(ending.notes).sort()).toEqual(["bass", "soprano", "tenor"]);
    expect(Boolean(ending.chord)).toBe(labeled);

    const candidates = analysis.cadenceCandidates;
    expect(candidates.map(c => [c.kind, c.fromTick, c.toTick])).toEqual([
      ["deceptive", 4320, 6720], ["full", 12960, 17280],
    ]);
    const authentic = candidates.at(-1)!;
    expect(authentic).toMatchObject({form: "authentic", completion: "perfect", confidence: "probable"});
    expect(authentic.unharmonizedLandingTick).toBe(labeled ? undefined : endTick);
    const starts = labeled ? [12960, endTick] : [12960];
    expect(authentic.chordIds).toEqual(project.chordTrack.regions
      .filter(c => starts.includes(c.startTick)).map(c => c.id));
    expect(authentic.spanIds).toEqual(analysis.harmonySpans.filter(h => starts.includes(h.fromTick)).map(h => h.id));
    expect(authentic.evidence.map(e => e.code)).toContain(labeled ? "detached-dominant-to-tonic" : "detached-sparse-tonic");
    const earlier = candidates[0];
    expect(earlier.unharmonizedLandingTick).toBeUndefined();
    expect(earlier.chordIds).toEqual(project.chordTrack.regions
      .filter(c => [4320, 5760].includes(c.startTick)).map(c => c.id));
    expect(earlier.evidence[0].refs?.slice(3)).toEqual(authentic.evidence.find(e =>
      e.code === (labeled ? "detached-dominant-to-tonic" : "detached-sparse-tonic"))!.refs);
    expect(project).toEqual(snapshot);
  });

  it.each([true, false])("末主的给定 I = %s，前段休止被占用仍保留末次正格", labeled => {
    const project = score(q => {
      q.A[5] = "r/2.";
      if (!labeled) q.H[5] = "r/2.";
      q.T[1] = "G3/4 r/8 C4/4.";
    });
    const cs = buildHarmonyAnalysis(project).cadenceCandidates;
    expect(cs.map(c => [c.kind, c.fromTick, c.unharmonizedLandingTick, c.toTick]))
      .toEqual([["full", 12960, labeled ? undefined : 14400, 17280]]);
  });

  it("无标注末主缺实写三音时，两种新证据都不成立", () => {
    const project = score(q => { q.A[5] = "r/2."; q.T[5] = "C4/2."; q.H[5] = "r/2."; });
    const analysis = buildHarmonyAnalysis(project);
    expect(analysis.cadenceCandidates.filter(c =>
      c.kind === "deceptive" || c.kind === "full" || c.unharmonizedLandingTick !== undefined)).toEqual([]);
    expect(analysis.slices.find(s => s.tick === 14400)?.chord).toBeUndefined();
  });
});

// A different meter, key and duration from the printed example. Two eighth
// rests in the repeated opening can carry inferred boundaries independently.
function sparsePair(edit?: (q: typeof parts) => void) {
  return score(q => {
    for (const v of Object.keys(q) as (keyof typeof parts)[]) {
      for (const bar of [0, 3]) q[v][bar] = q[v][bar].replace("/4 ", "/8 r/8 ");
    }
    q.A[5] = "r/2.";
    q.H[5] = "r/2.";
    edit?.(q);
  });
}

describe("无标签末主只佐证同一组实写重奏中的原位 VI", () => {
  function cut(p: Doc, tick: number, source: "inferred" | "manual") {
    p.structure.phraseBoundaries.push({id: "cut-" + tick, tick, source, confidence: "probable",
      ...(source === "inferred" ? {inferenceFingerprint: phraseInferenceFingerprint(p)} : {})});
  }

  it("模板在准备释放和重奏内齐休处分句，两个候选各归实际属、落点所在句", () => {
    const p = sparsePair();
    cut(p, 3840, "inferred");
    cut(p, 9120, "inferred");
    const z = buildHarmonyAnalysis(p);
    expect(z.phraseSegments.map(s => s.fromTick)).toEqual([0, 3840, 9120]);
    expect(z.cadenceCandidates.map(c => [c.kind, c.phraseId, c.fromTick, c.toTick])).toEqual([
      ["deceptive", z.phraseSegments[1].id, 4320, 6720], ["full", z.phraseSegments[2].id, 12960, 17280],
    ]);
    expect(z.cadenceCandidates[0].spanIds).toEqual(z.harmonySpans
      .filter(s => [4320, 5760].includes(s.fromTick)).map(s => s.id));
    expect(z.cadenceCandidates[0].evidence[0].refs).toEqual(expect.arrayContaining(
      Object.values(z.slices.find(s => s.tick === 14400)!.notes).map(note => note.id)));
  });

  it.each<[number, "manual" | "inferred"]>([
    [3840, "manual"], [9120, "manual"], [8640, "inferred"],
    [9600, "inferred"], [5280, "inferred"], [5760, "inferred"],
  ])("句界 %i (%s) 不可跨越，保留末端稀疏正格", (tick, source) => {
    const p = sparsePair();
    cut(p, tick, source);
    const z = buildHarmonyAnalysis(p);
    expect(z.phraseSegments.some(s => s.fromTick === tick)).toBe(true);
    expect(z.cadenceCandidates.some(c => c.evidence.some(e => e.code === "detached-deceptive-reprise"))).toBe(false);
    expect(z.cadenceCandidates.some(c => c.unharmonizedLandingTick === 14400)).toBe(true);
  });

  it.each<[string, (q: typeof parts) => void]>([
    ["首段 VI 无和弦", q => { q.H[2] = "r/2."; }],
    ["首段标为 VI6", q => { q.H[2] = "vi6/4 r/2"; }],
    ["重奏内声部改音", q => { q.T[3] = q.T[3].replace("Bb3", "C4"); }],
    ["两个终止间重新构成和弦", q => { q.A[2] = "F4/4 C4/2"; }],
    ["句中短 V→vi→IV", q => {
      q.S[1] = "G4/4 A4/8 Bb4/4 r/8"; q.A[1] = "E4/4 F4/8 F4/4 r/8";
      q.T[1] = "C4/4 D4/8 D4/4 r/8"; q.B[1] = "C3/4 D3/8 Bb2/4 r/8";
      q.H[1] = "V/4 vi/8 IV/4 r/8";
    }],
  ])("%s，末次正格不能反推前次阻碍", (_name, edit) => {
    const z = buildHarmonyAnalysis(sparsePair(edit));
    expect(z.cadenceCandidates.filter(c => c.kind === "deceptive")).toEqual([]);
    expect(z.cadenceCandidates.some(c => c.unharmonizedLandingTick === 14400)).toBe(true);
  });

  it("从四条裸音轨正常推导与写回后，两种终止落在各自的区间", () => {
    const bare = sparsePair();
    bare.chordTrack.regions.length = 0;
    const inference = inferChords(bare);
    const p = applyHarmonyInference(bare, { chordInference: inference }, {
      mode: "replace-unlocked", writeNonChordToneRoles: true,
    }).project;
    const z = buildHarmonyAnalysis(p);
    expect(z.cadenceCandidates.map(c => [c.kind, c.fromTick, c.toTick])).toEqual([
      ["deceptive", 4320, 6720], ["full", 12960, 17280],
    ]);
    expect(z.cadenceCandidates[1].unharmonizedLandingTick).toBe(14400);
  });
});

it.each([true, false])("给定和盲推共用阻碍确认，给定尾部 I = %s", given => {
  const raw = sparsePair(q => { if (given) q.H[5] = "I/2."; });
  const bare = { ...raw, chordTrack: { ...raw.chordTrack, regions: [] } };
  const input = given ? raw : applyHarmonyInference(bare, { chordInference: inferChords(bare) },
    { mode: "replace-unlocked", writeNonChordToneRoles: true },
  ).project;
  const analysis = buildHarmonyAnalysis(input);
  const candidate = analysis.cadenceCandidates.find(c => c.kind === "deceptive")!;
  const unconfirmed = createHarmonyRuleContext(analysis).cadenceAt(5760);
  expect(unconfirmed?.landingSpan?.firstSlice.tick).toBe(5760);
  expect(unconfirmed?.precedingSpan?.firstSlice.tick).toBe(4320);
  const accepted = addCadenceAnnotation(input, annotationFromCadenceCandidate(candidate, "deception"));
  expect(accepted.error).toBeUndefined();
  const serialized = JSON.parse(JSON.stringify(normalizeProject(accepted.project)));
  expect(validateProject(serialized)).toBe(true);
  const reopened = migrateProject(serialized)!;
  expect(reopened.chordTrack.cadenceAnnotations[0]).toMatchObject({
    kind: "deceptive", observedLandingTick: 5760, stale: false,
  });
  const query = (project: Doc) =>
    createHarmonyRuleContext(buildHarmonyAnalysis(project)).cadences({ id: "deception" }).first();
  expect(query(reopened)?.landingSpan?.firstSlice.tick).toBe(5760);
  expect(query(reopened)?.precedingSpan?.firstSlice.tick).toBe(4320);
  const edited = addPhraseBoundary(reopened, 5280).project;
  expect(query(edited)?.annotation?.stale).toBe(true);
  expect(query(edited)?.landingSpan).toBeUndefined();
  expect(query(edited)?.precedingSpan).toBeUndefined();
});

const dorianScore = `satb 1
key Bb major
meter 3/2
bars 1..2 {
  S: | F5/1 C5/4 Bb4/4 | C5/1. |
  A: | F4/1 F4/4 G4/4 | G4/2 A4/2 G4/2 |
  T: | D4/1 C4/4 D4/4 | Eb4/2 F4/2 Eb4/2 |
  B: | Bb2/1 A2/4 G2/4 | C3/2 F2/2 C3/2 |
}`;

function blind(text: string) {
  const { project } = compileScoreText(text);
  return applyHarmonyInference(project, inferHarmony(project), { mode: "replace-unlocked" }).project;
}

function modalEndings(project: ReturnType<typeof blind>) {
  return detectProjectCadences(project).filter(candidate =>
    candidate.evidence.some(item => item.code === "dorian-plagal-ending"));
}

describe("多利亚大下属的句末变格", () => {
  it("盲推从自然小属、下拍小主和末端 IV–i 识别独立不完满变格", () => {
    const project = blind(dorianScore);
    const result = modalEndings(project);
    expect(result).toMatchObject([{
      kind: "full", form: "plagal", completion: "imperfect",
      fromTick: 8 * project.ppq, toTick: 12 * project.ppq,
    }]);
    expect(buildHarmonyAnalysis(project).cadenceCandidates).toContainEqual(result[0]);
    expect(project.structure.phraseBoundaries).toEqual([]);
  });

  it("允许共同音重奏及内声使用同一和弦的其他合法配音", () => {
    const revoiced = dorianScore.replace("C5/1. |", "C5/2 C5/2 C5/2 |")
      .replace("Eb4/2 F4/2 Eb4/2", "Eb4/2 C4/2 Eb4/2");
    expect(modalEndings(blind(revoiced))).toMatchObject([{ completion: "imperfect" }]);
  });

  it("可在中间和弦之前找到独立确立的小调中心", () => {
    const intervening = dorianScore.replace("C5/1. |", "C5/2 Bb4/4 C5/4 C5/2 |")
      .replace("G4/2 A4/2 G4/2", "G4/2 Eb4/4 A4/4 G4/2")
      .replace("Eb4/2 F4/2 Eb4/2", "Eb4/2 Bb3/4 F4/4 Eb4/2")
      .replace("C3/2 F2/2 C3/2", "C3/2 G2/4 F2/4 C3/2");
    const project = blind(intervening);
    expect(modalEndings(project)).toMatchObject([{ fromTick: 9 * project.ppq, completion: "imperfect" }]);
  });

  it("移调到 D 多利亚，低音与共同音判据按书写相对音级工作", () => {
    const transposed = `satb 1
key C major
meter 3/2
bars 1..2 {
  S: | G5/1 D5/4 C5/4 | D5/1. |
  A: | G4/1 G4/4 A4/4 | A4/2 B4/2 A4/2 |
  T: | E4/1 D4/4 E4/4 | F4/2 G4/2 F4/2 |
  B: | C3/1 B2/4 A2/4 | D3/2 G2/2 D3/2 |
}`;
    expect(modalEndings(blind(transposed))).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect" }]);
  });

  const supplied = `satb 1
key Bb major
meter 3/2
bars 1..2 {
  S: | C5/1. | F5/1. |
  A: | A4/2 G4/1 | D5/1. |
  T: | F4/2 Eb4/1 | Bb3/1. |
  B: | F2/2 C3/1 | Bb2/1. |
  H: | r/1. | T/1. |
}
annotations {
  chord source range=[1:1,1:2) symbol=S localKey="C minor"
  chord landing range=[1:2,2:1) symbol=t localKey="C minor"
  phrase first range=[1:1,2:1)
  phrase second range=[2:1,3:1)
}`;

  it("已有一致局部调时，前句 IV–i 可独立收束，无须额外小属", () => {
    const { project } = compileScoreText(supplied);
    const result = modalEndings(project);
    expect(result).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect", toTick: 6 * project.ppq }]);
    expect(buildHarmonyAnalysis(project).phraseSegments.map(({ toTick }) => toTick))
      .toEqual([6 * project.ppq, 12 * project.ppq]);
  });

  it("明确借同主音大调的 IV 与小 i 共享同一收束中心", () => {
    const { project } = compileScoreText(supplied.replace('symbol=S localKey="C minor"', 'symbol=S localKey="C major"'));
    expect(modalEndings(project)).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect" }]);
  });

  it("共同主音可在内声保持，女高落五音时即使强次拍也不完满", () => {
    const { project } = compileScoreText(supplied.replace("C5/1. | F5/1.", "A4/2 G4/1 | F5/1.")
      .replace("A4/2 G4/1 | D5/1.", "C4/1. | D5/1.")
      .replace("F4/2 Eb4/1 | Bb3/1.", "F3/2 Eb3/1 | Bb3/1."));
    project.meterEvents[0].beatGrouping = [1, 2];
    expect(modalEndings(project)).toMatchObject([{ kind: "full", form: "plagal", completion: "imperfect" }]);
  });

  it("同一实奏在母调只标 V–ii 且无独立证据时拒绝重释", () => {
    const { project } = compileScoreText(supplied.replace('symbol=S localKey="C minor"', "symbol=V")
      .replace('symbol=t localKey="C minor"', "symbol=ii"));
    expect(modalEndings(project)).toEqual([]);
  });

  it.each([false, true])("已完成正格后的 IV–i 保持补充性质（借大调 %s）", borrowed => {
    const { project } = compileScoreText(`satb 1
key C minor
meter 3/2
bars 1..3 {
  S: | D5/1. | C5/1. | C5/1. |
  A: | B4/1. | G4/1. | A4/2 G4/1 |
  T: | G4/1. | Eb4/1. | F4/2 Eb4/1 |
  B: | G2/1. | C3/1. | F2/2 C3/1 |
  H: | D/1. | t/1. | ${borrowed ? "r/2" : "S/2"} t/1 |
}
annotations {
  ${borrowed ? 'chord borrowedIV range=[3:1,3:2) symbol=S localKey="C major"' : ""}
  phrase whole range=[1:1,4:1)
}`);
    expect(detectProjectCadences(project)).toMatchObject([
      { kind: "full", form: "authentic", toTick: 12 * project.ppq },
      { kind: "supplementary", form: "plagal", toTick: 18 * project.ppq },
    ]);
  });

  it("自然小属可确立中心，已有大 IV 收束照常走独立变格", () => {
    const { project } = compileScoreText(`satb 1
key C minor
meter 3/2
bars 1..3 {
  S: | Bb4/1. | C5/1. | C5/1. |
  A: | G4/1. | G4/1. | A4/2 G4/1 |
  T: | D4/1. | Eb4/1. | F4/2 Eb4/1 |
  B: | G2/1. | C3/1. | F2/2 C3/1 |
  H: | d/1. | t/1. | S/2 t/1 |
}
annotations {
  phrase whole range=[1:1,4:1)
}`);
    expect(detectProjectCadences(project)).toMatchObject([
      { kind: "full", form: "plagal", completion: "imperfect", toTick: 18 * project.ppq },
    ]);
  });

  it("中途重新确立母调主和弦后，先前的小调收束不能借给新的 V–ii", () => {
    const { project } = compileScoreText(`satb 1
key Bb major
meter 3/2
bars 1..3 {
  S: | F5/1 C5/4 Bb4/4 | C5/1. | F5/2 C5/2 C5/2 |
  A: | F4/1 F4/4 G4/4 | G4/1. | D5/2 A4/2 G4/2 |
  T: | D4/1 C4/4 D4/4 | Eb4/1. | Bb3/2 F4/2 Eb4/2 |
  B: | Bb2/1 A2/4 G2/4 | C3/1. | Bb2/2 F2/2 C3/2 |
  H: | T/1 V6/4 vi/4 | ii/1. | T/2 V/2 ii/2 |
}
annotations {
  phrase whole range=[1:1,4:1)
}`);
    expect(modalEndings(project)).toEqual([]);
  });

  it("强次拍的同一原位落主可以是完满变格", () => {
    const project = blind(dorianScore);
    project.meterEvents[0].beatGrouping = [2, 1];
    expect(modalEndings(project)).toMatchObject([{ kind: "full", form: "plagal", completion: "perfect" }]);
  });

  it.each([
    ["大属", dorianScore.replace("Bb4/4", "B4/4")],
    ["自然七级未在原声部上行到主音", dorianScore.replace("Bb4/4", "G5/4").replace("G4/4 | G4", "Bb4/4 | G4")],
    ["末尾低音越过八度", dorianScore.replace("F2/2 C3/2", "F2/2 C4/2")],
    ["主音持续低音的下属四六", dorianScore.replace("C3/2 F2/2 C3/2", "C3/1.")],
  ])("%s 保留普通终止搜索", (_name, text) => {
    expect(modalEndings(blind(text))).toEqual([]);
  });

  it.each(["key", "phrase"] as const)("不能借 %s 边界另一侧的实奏判定", boundary => {
    const project = blind(dorianScore);
    if (boundary === "key") {
      project.keyEvents.push({
        tick: 10 * project.ppq, id: "arrival-key",
        tonic: { step: "C", alter: 0 }, mode: "minor",
      });
    } else {
      project.structure.phraseBoundaries.push({
        tick: 8 * project.ppq, id: "manual-cut", source: "manual", confidence: "certain",
      });
    }
    expect(modalEndings(project)).toEqual([]);
  });
});

const majorToMinor = `satb 1
key D major
meter 2/4
bars 1..4 {
  S: | F#5/2 | C#5/4 C#5/4 | D5/4 C5/4 | Bb4/2 |
  A: | A4/2 | A4/2~ | A4/4 Eb4/4 | D4/2 |
  T: | D4/2 | E4/4 E4/4 | A3/4 A3/4 | F3/2 |
  B: | D3/2 | A2/4 G2/4 | F2/4 F2/4 | Bb2/2 |
}
annotations {
  chord tonic at=1:1 duration=1/2 symbol=T
  chord dominant at=2:1 duration=1/4 symbol=D
  chord last at=2:2 duration=1/4 symbol=D2
  chord pivot at=3:1 duration=1/4 symbol=t6 localKey="D minor"
  chord next at=3:2 duration=1/4 symbol=D7 localKey="Bb major"
  chord end at=4:1 duration=1/2 symbol=T localKey="Bb major"
}`;

const minorToMajor = `satb 1
key G minor
meter 2/4
bars 1..4 {
  S: | Bb4/2 | F#4/4 F#4/4 | G4/4 F#4/4 | E4/2 |
  A: | G4/2 | D4/2~ | D4/4 D#4/4 | B3/2 |
  T: | D4/2 | A3/4 A3/4 | D3/4 A3/4 | G3/2 |
  B: | G2/2 | D3/4 C3/4 | B2/4 B2/4 | E3/2 |
}
annotations {
  chord tonic at=1:1 duration=1/2 symbol=t
  chord dominant at=2:1 duration=1/4 symbol=D
  chord last at=2:2 duration=1/4 symbol=D2
  chord pivot at=3:1 duration=1/4 symbol=T6 localKey="G major"
  chord next at=3:2 duration=1/4 symbol=D7 localKey="E minor"
  chord end at=4:1 duration=1/2 symbol=t localKey="E minor"
}`;

const cut = 4 * PPQ;
const halfEnding = expect.objectContaining({ kind: "half", form: "authentic", toTick: cut });
const finalEnding = expect.objectContaining({
  fromTick: 5 * PPQ, toTick: 8 * PPQ, kind: "full", form: "authentic", completion: "perfect",
});

function withBreak(score: string, source: "manual" | "inferred" = "inferred", nextManual?: number) {
  const { project } = compileScoreText(score);
  project.structure.phraseBoundaries.push({
    id: "midpoint", tick: cut, source, confidence: "certain",
    ...(source === "inferred" ? { inferenceFingerprint: phraseInferenceFingerprint(project) } : {}),
  });
  if (nextManual !== undefined) project.structure.phraseBoundaries.push({
    id: "next-explicit", tick: nextManual, source: "manual", confidence: "certain",
  });
  return buildHarmonyAnalysis(project);
}

describe("同主音主六接续转调处的自动半终止", () => {
  it.each([["大转小", majorToMinor], ["小转大", minorToMajor]])("%s 时排除延续中的半终止并保留尾部正格", (_title, score) => {
    const analysis = withBreak(score);
    expect(analysis.phraseSegments.some(phrase => phrase.toTick === cut)).toBe(true);
    expect(analysis.cadenceCandidates).toEqual([finalEnding]);
  });

  it("人工划在同一处的半终止仍可保留", () => {
    expect(withBreak(majorToMinor, "manual").cadenceCandidates).toEqual([halfEnding, finalEnding]);
  });

  it("不越过主六之后标注的人工句界借用新调属和弦", () => {
    expect(withBreak(majorToMinor, "inferred", 5 * PPQ).cadenceCandidates).toContainEqual(halfEnding);
  });

  it.each([
    ["共同音在跨界处同音重奏", majorToMinor.replace("A4/2~ | A4/4", "A4/2 | A4/4")],
    ["共同音跨八度", majorToMinor.replace("A4/2~ | A4/4", "A4/2 | A5/4")],
    ["共同音只在属二才开始", majorToMinor.replace("A4/2~ | A4/4", "A4/4 A4/4~ | A4/4")],
    ["导音跳八度进入主音", majorToMinor.replace("D5/4 C5/4", "D6/4 C5/4")],
    ["低音七音跳八度解决", majorToMinor.replace("F2/4 F2/4", "F3/4 F2/4")],
    ["落点缺乏连贯实奏", majorToMinor.replace("A3/4 A3/4", "r/8 A3/8 A3/4")],
    ["没有大小调转换", majorToMinor.replace('symbol=t6 localKey="D minor"', 'symbol=T6 localKey="D major"')
      .replace("F2/4 F2/4", "F#2/4 F2/4")],
    ["没有实际的新调属七", majorToMinor.replace("D5/4 C5/4", "D5/4 B4/4")],
    ["主六保持超过一拍", majorToMinor.replace("duration=1/4 symbol=t6", "duration=1/2 symbol=t6")
      .replace('  chord next at=3:2 duration=1/4 symbol=D7 localKey="Bb major"', "")],
  ])("%s 时保留原半终止判断", (_title, score) => {
    expect(withBreak(score).cadenceCandidates).toContainEqual(halfEnding);
  });
});
