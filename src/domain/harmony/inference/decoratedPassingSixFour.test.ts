import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { checkHarmony } from "../registry";
import { applyChordInference } from "./apply";
import { inferChords } from "./inferChords";

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

function analyze(source = score, cut?: number, allowNonChordToneCandidates?: boolean) {
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
    const { middle, ornament, warnings, diagnostics } = analyze();
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
    const { middle, warnings } = analyze(source, cut);
    expect(middle?.semantics?.cadenceRole).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("关闭和弦外音推导时不新写声部角色与六四证据", () => {
    const { middle, ornament, warnings } = analyze(score, undefined, false);
    expect(middle?.semantics?.cadenceRole).toBeUndefined();
    expect(ornament?.nonChordToneRole).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});
