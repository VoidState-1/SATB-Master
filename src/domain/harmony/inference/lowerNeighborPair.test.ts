import { describe, expect, it } from "vitest";
import { PPQ } from "../../project";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { phraseInferenceFingerprint } from "../phrase/fingerprint";
import { applyHarmonyInference, inferHarmony } from "./harmonyInference";

const enclosure = `satb 1
key A minor
meter 4/4
bars 1..3 {
  S: | E5/2 D5/4 A4/4 | C5/1 | B4/2 A4/2 |
  A: | C5/2 B4/4 D#4/4 | D#4/4 E4/8 C##4/8 D#4/2 | G#4/2 E4/2 |
  T: | A3/2 E3/4 F#3/4 | F#3/4 G3/8 E#3/8 F#3/2 | D4/2 C4/2 |
  B: | A2/2 G2/4 B2/4 | A2/1 | E3/2 A2/2 |
}`;

const upperTick = 5 * PPQ;
const lowerTick = upperTick + PPQ / 2;
const returnTick = 6 * PPQ;


function analyze(text: string, change?: (project: ReturnType<typeof compileScoreText>["project"]) => void) {
  const { project } = compileScoreText(text);
  change?.(project);
  const inference = inferHarmony(project);
  const applied = applyHarmonyInference(project, inference, { mode: "fill-gaps", writeNonChordToneRoles: true });
  const at = (tick: number) => inference.chordInference.regions.find(region => region.fromTick <= tick && tick < region.toTick);
  const warnings = checkHarmony(applied.project).diagnostics;
  return { project, applied, inference, at, warnings };
}

const writtenMinorSeventh = enclosure.replace("C##4/8", "D4/8").replace("E#3/8", "F3/8");
const diminishedWarningsAt = (result: ReturnType<typeof analyze>) =>
  result.warnings.filter(item => item.tick === lowerTick && item.ruleId === "melody.diminished-interval");

describe("弱细分上的书写下辅助配对", () => {
  it("只用回到已证锚点的后一细分，保留较强处的完整小七拼写", () => {
    const result = analyze(enclosure);
    expect(result.at(upperTick)?.toTick).toBe(lowerTick);
    expect(result.at(lowerTick)).toMatchObject({
      fromTick: lowerTick, toTick: returnTick, status: "unclassified", alternatives: [],
    });
    expect(result.at(lowerTick)?.selected).toBeUndefined();
    expect(result.at(returnTick)?.selected).toMatchObject({
      functionalBaseId: "DDVII",
      identity: { root: { step: "D", alter: 1 }, bass: { step: "A", alter: 0 } },
    });
    expect(result.applied.writtenNonChordToneRoleCount).toBe(0);
    expect(diminishedWarningsAt(result)).toEqual([]);
    expect(result.warnings.filter(item => item.tick === lowerTick &&
      ["chord.unclassified-nonchord-tone", "chord.incomplete-members", "nonchord.neighbor-tone"].includes(item.ruleId))).toEqual([]);
    expect(checkHarmony(result.project).diagnostics.filter(item =>
      item.tick === lowerTick && item.ruleId === "melody.diminished-interval")).toHaveLength(2);
  });

  it("同音的实写 Dm7/A 保持自己的身份与转位", () => {
    const result = analyze(writtenMinorSeventh);
    expect(result.at(lowerTick)?.selected).toMatchObject({
      identity: { root: { step: "D", alter: 0 }, bass: { step: "A", alter: 0 },
        structure: { quality: "minor7" } },
      fit: { spellingConsistent: true },
    });
  });

  it.each([
    ["未回到原音", "D#4/2 |", "E4/2 |"],
    ["低音重新起奏", "A2/1 |", "A2/4. A2/8 A2/2 |"],
    ["固定高声部改音", "C5/1 |", "C5/4. E5/8 C5/2 |"],
    ["独立准备缺失", "F#3/4 |", "A3/4 |"],
  ])("%s 时保留对应减三度报告", (_description, before, after) => {
    const result = analyze(enclosure.replace(before, after));
    expect(diminishedWarningsAt(result)).toHaveLength(2);
  });

  it("用户给定的错误 Dm7/A 标注仍接受常规检查", () => {
    const rival = analyze(writtenMinorSeventh).applied.project.chordTrack.regions.find(
      region => region.startTick === lowerTick,
    )!;
    const result = analyze(enclosure, input => input.chordTrack.regions.push(rival));
    expect(diminishedWarningsAt(result)).toHaveLength(2);
    expect(result.warnings.filter(item => item.tick === lowerTick).map(item => item.ruleId))
      .toContain("chord.unclassified-nonchord-tone");
  });

  it("可同时保留用户写入的上一细分完整 Am7", () => {
    const { identity } = analyze(writtenMinorSeventh).at(lowerTick)!.selected!;
    const result = analyze(enclosure, project => project.chordTrack.regions.push({
      id: "written-upper-am7",
      locked: false,
      startTick: upperTick,
      durationTicks: PPQ / 2,
      identity: { ...identity, root: { step: "A", alter: 0 } },
    }));
    expect(result.applied.project.chordTrack.regions.find(region => region.startTick === upperTick)).toMatchObject({
      id: "written-upper-am7",
      durationTicks: PPQ / 2,
      identity: { root: { step: "A", alter: 0 }, bass: { step: "A", alter: 0 }, structure: { quality: "minor7" } },
    });
    expect(diminishedWarningsAt(result)).toEqual([]);
  });

  it("声部实响低于男低音时保留减三度报告", () => {
    const result = analyze(enclosure.replace("A2/1 |", "A3/1 |"));
    expect(diminishedWarningsAt(result)).toHaveLength(2);
  });

  it("按两端标签的显式有效调性检查，同一调号下存在冲突则照报", () => {
    const project = analyze(enclosure).applied.project;
    const at = (tick: number) => project.chordTrack.regions.find(region => region.startTick === tick)!;
    const relabel = (tick: number) => {
      const anchor = at(tick);
      const interpretation = anchor.semantics!.interpretations[0];
      anchor.semantics = {
        ...anchor.semantics!,
        interpretations: [{
          ...interpretation,
          localKey: { tonic: { step: "E", alter: 0 }, mode: "minor" },
          designation: { notationSystem: "spasobin", kind: "primary", primaryFunction: "dominant" },
          appliedTarget: undefined,
          source: "manual",
          confidence: "certain",
        }],
      };
    };
    const atLower = () => checkHarmony(project).diagnostics.filter(item =>
      item.tick === lowerTick && item.ruleId === "melody.diminished-interval");
    relabel(returnTick);
    expect(atLower()).toHaveLength(2);
    relabel(4 * PPQ);
    expect(atLower()).toEqual([]);
  });

  it("和弦推导只使用当前保存的自动句界，陈旧标记或指纹不同均不阻断", () => {
    const boundaryTick = lowerTick + PPQ / 4;
    for (const state of ["current", "stale-flag", "old-fingerprint"] as const) {
      const result = analyze(enclosure, project => project.structure.phraseBoundaries.push({
        id: state, tick: boundaryTick, source: "inferred", confidence: "certain",
        stale: state === "stale-flag",
        inferenceFingerprint: state === "old-fingerprint" ? "old" : phraseInferenceFingerprint(project),
      }));
      if (state === "current") {
        expect(result.at(lowerTick)?.selected?.identity.structure).toMatchObject({ quality: "minor7" });
        expect(diminishedWarningsAt(result)).toHaveLength(2);
      } else {
        expect(result.at(lowerTick)?.selected).toBeUndefined();
        expect(diminishedWarningsAt(result)).toEqual([]);
      }
    }
  });

  it("规则侧使用当前切片中的有效句界，而非历史自动标记", () => {
    for (const stale of [false, true]) {
      const project = analyze(enclosure).applied.project;
      project.structure.phraseBoundaries.push({
        id: "saved-automatic", tick: lowerTick + PPQ / 4, source: "inferred",
        confidence: "certain", inferenceFingerprint: phraseInferenceFingerprint(project), stale,
      });
      expect(checkHarmony(project).diagnostics.filter(item =>
        item.tick === lowerTick && item.ruleId === "melody.diminished-interval")).toHaveLength(stale ? 0 : 2);
    }
  });

  it("在未改名的调号切片及句界处停止延续", () => {
    const keySplit = analyze(enclosure, project => {
      project.keyEvents.push({ ...project.keyEvents[0], id: "during-lower", tick: lowerTick + PPQ / 4 });
    });
    const phraseSplit = analyze(enclosure, project => {
      project.structure.phraseBoundaries.push({ id: "stop", tick: returnTick, source: "manual", confidence: "certain" });
    });
    for (const result of [keySplit, phraseSplit]) {
      expect(diminishedWarningsAt(result)).toHaveLength(2);
    }
  });
});
