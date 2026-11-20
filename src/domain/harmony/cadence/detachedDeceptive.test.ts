import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { phraseInferenceFingerprint } from "../phrase";
import { applyHarmonyInference, inferChords } from "../inference";

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
