import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { checkHarmony } from "../registry";
import { applyHarmonyInference } from "./harmonyInference";
import { inferChords } from "./inferChords";

const close = `satb 1
key C major
meter 3/4
bars 1..2 {
 S: | G4/4 E5/4 D5/4 | C5/4 A4/4 G4/4 |
 A: | E4/4 G4/4 G4/4 | E4/4 F4/4 E4/4 |
 T: | C4/2 B3/4 | C4/2. |
 B: | G3/2 G2/4 | C3/2. |
}`;

function analyze(text: string, cut?: number) {
  const { project } = compileScoreText(text);
  if (cut !== undefined) project.structure.phraseBoundaries = [
    { id: "split", tick: cut, confidence: "certain", source: "manual" },
  ];
  const inference = inferChords(project);
  const written = applyHarmonyInference(project, { chordInference: inference },
    { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
  return {
    role: written.chordTrack.regions.find(region => region.startTick === 3840)?.semantics?.cadenceRole,
    cadences: buildHarmonyAnalysis(written).cadenceCandidates,
    warnings: checkHarmony(written).diagnostics.filter(d => d.severity === "warning"),
  };
}

describe("从不完全主和弦进入辅助下属四六", () => {
  const missingFifth = { tick: 2880, ruleId: "chord.incomplete-members" };
  const unsupportedSixFour = { tick: 3840, ruleId: "chord.second-inversion-voicing" };

  it("写回弱拍辅助四六，保留正格与补充变格两个终止", () => {
    const { role, cadences, warnings } = analyze(close);
    expect(role).toBe("pedal64");
    expect(cadences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "full", form: "authentic", completion: "perfect", toTick: 3840 }),
      expect.objectContaining({ kind: "supplementary", form: "plagal", fromTick: 3840, toTick: 5760 }),
    ]));
    expect(warnings).not.toContainEqual(expect.objectContaining(missingFifth));
    expect(warnings).not.toContainEqual(expect.objectContaining(unsupportedSixFour));
  });

  it.each([
    ["无声部下三度", close.replace("A4/4 G4/4", "F5/4 G4/4").replace("E4/4 F4/4", "E4/4 A4/4")],
    ["前一主和弦重复三音", close.replace("B3/4 | C4/2.", "B3/4 | E4/4 C4/2")],
    ["四六重复根音", close.replace("B3/4 | C4/2.", "B3/4 | C4/4 F4/4 C4/4")],
    ["低音在四六上重新起奏", close.replace("C3/2.", "C3/4 C3/2")],
  ])("%s时保留四六配置警告", (_label, text) => {
    const { role, warnings } = analyze(text);
    expect(role).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining(unsupportedSixFour));
  });

  it("未形成正格终止时可识别辅助角色，仍提示前一主和弦缺五音", () => {
    const noDominant = close.replace("G4/4 E5/4 D5/4", "A4/2.")
      .replace("E4/4 G4/4 G4/4", "F4/2.").replace("C4/2 B3/4", "C4/2.")
      .replace("G3/2 G2/4", "F3/2.");
    const { role, warnings } = analyze(noDominant);
    expect(role).toBe("pedal64");
    expect(warnings).toContainEqual(expect.objectContaining(missingFifth));
  });

  it.each([3360, 3840, 4800])("人工句界 %i 分开两侧时保留四六配置警告", cut => {
    const { role, warnings } = analyze(close, cut);
    expect(role).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining(unsupportedSixFour));
  });
});
