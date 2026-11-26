import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../../scoreText";
import type { ProjectDocument } from "../../../../project";
import { applyHarmonyInference, inferHarmony } from "../../../inference";
import { checkHarmony, createHarmonyRuleScheduler } from "../../../registry";
import { defaultHarmonyRuleSeverities } from "../../catalog";

const seventh = "resolution.chord-seventh";
const altered = "resolution.altered-tone";
const augmented = "resolution.augmented-sixth";
const prepare = "nonchord.suspension-preparation";
const resolve = "nonchord.suspension-resolution";
const options = { mode: "fill-gaps", writeNonChordToneRoles: true } as const;

function score(voices: string[], chords?: string, key = "C major", meter = "2/4") {
  return compileScoreText(["satb 1", "key " + key, "meter " + meter, "bars 1..1 {",
    ...voices.map((line, i) => "SATB"[i] + ": | " + line + " |"),
    ...(chords ? ["H: | " + chords + " |"] : []), "}"].join("\n")).project;
}

function findings(project: ProjectDocument, ruleId: string) {
  const result = checkHarmony(project);
  expect(result.skippedRules.filter(skip => skip.reason === "rule-error")).toEqual([]);
  return result.diagnostics.filter(item => item.ruleId === ruleId);
}

function dominant(top: string, label?: string, key = "C major") {
  return score(["F4/4 " + top + "/4", "D4/4 E4/4", "B3/4 G3/4", "G2/4 C3/4"], label, key);
}

describe("缺标签切片的倾向音证据", () => {
  it.each([["E4", 0], ["C5", 1], ["G4", 1]] as const)("标注属七的七音到 %s", (top, count) => {
    const p = dominant(top, "V7/4 r/4");
    const result = findings(p, seventh);
    expect(result).toHaveLength(count);
    if (count) {
      expect(result[0]).toMatchObject({ tick: p.ppq, severity: "warning", voiceIds: ["soprano"],
        chordIds: [p.chordTrack.regions[0].id], trace: expect.arrayContaining([
          { tick: p.ppq, outcome: "violate", reason: "written-tendency-moved-elsewhere" },
        ]) });
      expect(result[0].params).not.toHaveProperty("targetChord");
    }
  });

  function chromatic(destination: string, tendency: "up" | "down") {
    const p = score([(tendency === "up" ? "D#4" : "Db4") + "/4 " + destination + "/4",
      "B3/4 C4/4", "F3/4 E3/4", "G2/4 C3/4"], "V7/4 r/4");
    const structure = p.chordTrack.regions[0].identity.structure;
    if (structure.kind !== "tertian") throw new Error("expected V7");
    p.chordTrack.regions[0].identity.structure = { ...structure, alterations: [{ degree: 5, alter: tendency === "up" ? 1 : -1, tendency }] };
    return p;
  }
  it.each([["up", "E4", 0], ["up", "B3", 1], ["down", "C4", 0], ["down", "G4", 1]] as const)(
    "显式 %s 变化音到 %s", (direction, destination, count) => {
      const p = chromatic(destination, direction);
      const warnings = findings(p, altered);
      expect(warnings).toHaveLength(count);
      if (count) expect(warnings[0]).toMatchObject({ voiceIds: ["soprano"], chordIds: [p.chordTrack.regions[0].id] });
    });

  it.each([seventh, altered])("%s 持续、休止、换调和曲末", rule => {
    const p = rule === seventh ? dominant("C5", "V7/4 r/4") : chromatic("B3", "up");
    const held = structuredClone(p);
    const line = held.satbTracks[0].notes;
    line[0].durationTicks += line[1].durationTicks;
    line.pop();
    expect(findings(held, rule)).toEqual([]);
    const gap = structuredClone(p);
    gap.satbTracks[0].notes[0].durationTicks /= 2;
    expect(findings(gap, rule)).toEqual([]);
    p.keyEvents.push({ ...p.keyEvents[0], id: "new-tonality", tick: p.ppq, tonic: { step: "D", alter: 0 } });
    expect(findings(p, rule)).toEqual([]);
  });

  it("无标签处同高重奏继续追踪，下一次跳走才报告", () => {
    const p = score(["F4/4 F4/4 C5/4", "D4/2 E4/4", "B3/2 G3/4", "G2/2 C3/4"],
      "V7/4 r/2", "C major", "3/4");
    expect(findings(p, seventh)).toMatchObject([{ tick: 2 * p.ppq, trace: expect.arrayContaining([
      { tick: p.ppq, outcome: "continue", reason: "tendency-held-in-register" },
    ]) }]);
  });

  it.each([seventh, altered])("%s 只承认同音区接手并按原方向解决", rule => {
    const from = rule === seventh ? "F4" : "D#4";
    const p = score([from + "/4 C5/4 C5/4", "B3/4 " + from + "/4 E4/4",
      "D3/4 G3/2", "G2/4 C3/2"], "V7/4 r/2", "C major", "3/4");
    if (rule === altered) {
      const structure = p.chordTrack.regions[0].identity.structure;
      if (structure.kind !== "tertian") throw new Error("expected V7");
      p.chordTrack.regions[0].identity.structure = { ...structure, alterations: [{ degree: 5, alter: 1, tendency: "up" }] };
    }
    expect(findings(p, rule)).toEqual([]);
    p.satbTracks[1].notes[1].pitch.octave++;
    expect(findings(p, rule)).toMatchObject([{ tick: p.ppq, voiceIds: ["soprano"] }]);
  });

  it("仅印刷调号变化仍保留旧导音，实际进入新调则取消", () => {
    const p = score(["B4/4 E5/4", "D4/4 C4/4", "G3/2", "G2/4 C3/4"], "V/4 I/4");
    const key = p.keyEvents[0];
    p.keyEvents.push({ ...key, id: "next", tick: p.ppq, tonic: { step: "G", alter: 0 } });
    const target = p.chordTrack.regions[1].semantics!.interpretations[0];
    target.localKey = { tonic: key.tonic, mode: key.mode };
    expect(findings(p, "resolution.leading-tone")).toMatchObject([{ tick: p.ppq, voiceIds: ["soprano"] }]);
    target.localKey = { tonic: { step: "G", alter: 0 }, mode: "major" };
    expect(findings(p, "resolution.leading-tone")).toEqual([]);
  });
});

describe("无标签的增六落点", () => {
  function sixth(high: string, low: string, middle = "C4") {
    return score(["F#4/4 " + high + "/4", middle + "/4 B3/4", "C3/4 D3/4", "Ab2/4 " + low + "/4"], "It+6/4 r/4");
  }
  it.each([["G4", "G2", []], ["C5", "G2", ["soprano"]], ["G4", "B2", ["bass"]]] as const)(
    "两端到 %s 和 %s", (high, low, failed) => {
      const p = sixth(high, low);
      const warnings = findings(p, augmented);
      if (failed.length) expect(warnings).toMatchObject([{ voiceIds: failed, severity: "error", tick: p.ppq,
        chordIds: [p.chordTrack.regions[0].id] }]);
      else expect(warnings).toEqual([]);
    });
  it("内声休止时只依据两个仍在的实写端点", () => {
    const p = sixth("C5", "G2");
    p.satbTracks[1].notes = [];
    expect(findings(p, augmented)).toMatchObject([{ voiceIds: ["soprano"] }]);
    p.satbTracks[3].notes = [];
    expect(findings(p, augmented)).toEqual([]);
  });
  it("缺少或重复端点时由静态配置规则报告", () => {
    const p = sixth("C5", "B2", "F#4");
    expect(findings(p, augmented)).toEqual([]);
    expect(findings(p, "chord.augmented-sixth-voicing")).toHaveLength(1);
  });
  it("高端下行半音可成为实写属七的七音", () => {
    const p = sixth("F4", "G2");
    expect(findings(p, augmented)).toEqual([]);
    p.satbTracks[2].notes[1].pitch = { step: "G", alter: 0, octave: 3 };
    expect(findings(p, augmented)).toEqual([]);
  });
});

describe("盲推留下的标签空档", () => {
  it.each([["C5", 1], ["E4", 0]] as const)("实写 V7 的七音到 %s，项目保持无源标签", async (landing, count) => {
    const raw = dominant(landing, undefined, "Bb major");
    const inferred = inferHarmony(raw);
    expect(inferred.chordInference.regions[0].status).not.toBe("resolved");
    const { project } = applyHarmonyInference(raw, inferred, options);
    expect(project.chordTrack.regions.some(chord => chord.startTick === 0)).toBe(false);
    for (const p of [project, raw]) {
      const sync = findings(p, seventh);
      expect(sync).toHaveLength(count);
      if (count) expect(sync[0].evidence.filter(item => item.label === "实写属七音组")).toHaveLength(4);
      const scheduled = await createHarmonyRuleScheduler().run({ project: p, revision: 0, severities: defaultHarmonyRuleSeverities() });
      expect(scheduled.diagnostics.filter(item => item.ruleId === seventh)).toEqual(sync);
    }
  });

  it("功能有两个解释而源属七实体一致，须有实写三音才开放义务", () => {
    const p = dominant("C5", "V7/4 I/4");
    const semantics = p.chordTrack.regions[0].semantics!;
    semantics.alternatives = [{ ...semantics.interpretations[0], id: "alternative-function", degree: 4 }];
    expect(findings(p, seventh)).toHaveLength(1);
    p.satbTracks[2].notes[0].pitch = { step: "G", alter: 0, octave: 3 };
    expect(findings(p, seventh)).toEqual([]);
  });
  it("歧义候选一律保留空白，完整实写仍能证明七音；撤去三音就不能证明", () => {
    const raw = dominant("C5");
    const inferred = inferHarmony(raw);
    const regions = inferred.chordInference.regions.map(r => r.fromTick === 0 ? { ...r, status: "ambiguous" as const } : r);
    const { project } = applyHarmonyInference(raw, { chordInference: { ...inferred.chordInference, regions } }, options);
    expect(project.chordTrack.regions.map(c => c.startTick)).toEqual([project.ppq]);
    expect(findings(project, seventh)).toHaveLength(1);
    project.satbTracks[2].notes[0].pitch = { step: "G", alter: 0, octave: 3 };
    expect(findings(project, seventh)).toEqual([]);
  });

  it("空五度不猜三音，也不从未知标签报错转位", () => {
    const raw = score(["G4/4 C5/4", "D4/4 E4/4", "G3/4 G3/4", "D3/4 C3/4"]);
    const { project } = applyHarmonyInference(raw, inferHarmony(raw), options);
    expect(project.chordTrack.regions.filter(c => c.startTick === 0)).toEqual([]);
    expect(findings(project, seventh)).toEqual([]);
    expect(findings(project, "chord.inversion-bass")).toEqual([]);
  });

  it.each(["prepared", "ambiguous", "leap", "rest"] as const)("写回重新核对延留准备与解决 (%s)", variant => {
    const p = score(["D5/2 D5/4 C5/4", "B4/2 G4/2", "G3/2 E4/2", "G2/2 E3/2"],
      undefined, "C major", "4/4");
    const result = inferHarmony(p);
    const regions = result.chordInference.regions.map(r => r.fromTick === 0 && variant === "ambiguous" ?
      { ...r, status: "ambiguous" as const } : r);
    const line = p.satbTracks[0].notes;
    if (variant === "leap") line[2].pitch.octave--;
    if (variant === "rest") line[0].durationTicks -= p.ppq / 2;
    const { project } = applyHarmonyInference(p, { chordInference: { ...result.chordInference, regions } }, options);
    const suspended = project.satbTracks[0].notes[1];
    expect(suspended.nonChordToneRole).toBe(variant === "prepared" ? "suspension" : undefined);
    expect(findings(project, prepare)).toEqual([]);
    expect(findings(project, resolve)).toEqual([]);
    if (variant !== "prepared") {
      suspended.nonChordToneRole = "suspension";
      expect(findings(project, resolve)).toHaveLength(1);
      expect(findings(project, prepare)).toHaveLength(variant === "leap" ? 0 : 1);
    }
  });
});
