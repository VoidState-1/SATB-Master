import { describe, expect, it } from "vitest";
import { PPQ } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";
import { defaultHarmonyRuleSeverities } from "../catalog";

const ruleId = "resolution.chord-seventh";
const score = `satb 1
key F major
meter 4/4
bars 1..2 {
  S: | D5/4 Ab5/4 A5/4 Bb5/4 | C6/1 |
  A: | F4/2 F4/4 E4/4 | F4/1 |
  T: | Bb3/4 B3/4 C4/2 | A3/1 |
  B: | Bb2/4 D3/4 C3/4 C2/4 | F2/1 |
  H: | IV/4 DDVII65/4 K46/4 V7/4 | I/1 |
}
`;

function seventhDiagnostics(text = score, severities = defaultHarmonyRuleSeverities()) {
  const { project } = compileScoreText(text);
  return checkHarmony(project, severities).diagnostics
    .filter(diagnostic => diagnostic.ruleId === ruleId)
    .map(({ tick, severity, voiceIds, subjects }) => ({
      tick, severity, voiceIds, sourceNoteId: subjects?.origin?.noteIds?.[0],
    }));
}

function unresolvedSeventh(sourceTick: number, tick: number, severity: "warning" | "error" = "warning") {
  return { tick, severity, voiceIds: ["soprano"], sourceNoteId: `note-S-${sourceTick}` };
}

describe("E.2 重属导减七至 K46", () => {
  it.each(["Ab5", "G#5"])("认可 %s 上行到 A5，仍报告后续属七音上行", seventh => {
    expect(seventhDiagnostics(score.replace("Ab5", seventh))).toEqual([unresolvedSeventh(3 * PPQ, 4 * PPQ)]);
  });

  it.each([
    ["原七音上行换八度", score.replace("A5/4", "A6/4")],
    ["其余声部互换 K46 的音", score.replace("F4/2 F4/4", "F4/2 C4/4").replace("B3/4 C4/2", "B3/4 F4/4 C4/4")],
    ["目标标作持续四六", score.replace("K46/4", "r/4").replace("}\n", `}
annotations {
  chord pedal range=[1:3,1:4) symbol=I64 role=pedal64
}\n`)],
  ])("%s 时保留 E.2", (_label, text) => {
    expect(seventhDiagnostics(text)).toContainEqual(unresolvedSeventh(PPQ, 2 * PPQ));
  });

  it("仍检查同声部从前一个和弦延续的独立七音义务", () => {
    const carried = score.replace("IV/4", "r/4").replace("D5/4 Ab5/4", "Ab5/4 Ab5/4")
      .replace("Bb3/4 B3/4", "D4/4 B3/4") + `annotations {
  chord prep range=[1:1,1:2) symbol=V7 localKey="Eb major"
}
`;
    expect(seventhDiagnostics(carried)).toEqual([
      unresolvedSeventh(0, 2 * PPQ),
      unresolvedSeventh(3 * PPQ, 4 * PPQ),
    ]);
  });

  it("重拼判断独立于 B.3 开关，也保留 E.2 的严重度与关闭设置", () => {
    const severities = defaultHarmonyRuleSeverities();
    severities["melody.augmented-interval"] = "off";
    severities[ruleId] = "error";
    expect(seventhDiagnostics(score, severities)).toEqual([unresolvedSeventh(3 * PPQ, 4 * PPQ, "error")]);
    severities[ruleId] = "off";
    expect(seventhDiagnostics(score, severities)).toEqual([]);
  });
});
