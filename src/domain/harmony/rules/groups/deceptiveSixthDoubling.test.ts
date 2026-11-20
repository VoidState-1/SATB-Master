import { describe, expect, it } from "vitest";
import { PPQ } from "../../../project";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferHarmony } from "../../inference";
import { checkHarmony } from "../../registry";

type Parts = readonly [string, string, string, string];
const toVi: Parts = ["B4/2 | C5/2", "F4/2 | E4/2", "D4/2 | C4/2", "G2/2 | A2/2"];
const toMinorVI: Parts = ["B4/2 | C5/2", "F4/2 | Eb4/2", "D4/2 | C4/2", "G2/2 | Ab2/2"];
const suggestion = "chord.triad-root-position-doubling";
const leading = "resolution.leading-tone";
const seventh = "resolution.chord-seventh";
const arrival = 2 * PPQ;

function run(
  parts = toVi, key = "C major", harmony: string | undefined = "V7/2 | vi/2",
  boundary = false,
) {
  const source = `satb 1
key ${key}
meter 2/4
bars 1..2 {
 S: | ${parts[0]} |
 A: | ${parts[1]} |
 T: | ${parts[2]} |
 B: | ${parts[3]} |
 H: | ${harmony} |
}`;
  const { project } = compileScoreText(source);
  if (boundary) project.structure.phraseBoundaries.push({
    id: "manual", tick: arrival, confidence: "certain", source: "manual",
  });
  return checkHarmony(project).diagnostics;
}

function d5At(tick = arrival, endTick = 4 * PPQ) {
  return expect.objectContaining({ ruleId: suggestion, severity: "suggestion", tick, endTick,
    params: { counts: "1/2/1", inversion: 0 } });
}

describe("原位属七实际解决到六级时的三音重复", () => {
  it.each([
    ["大调完整属七", toVi, "C major", "V7/2 | vi/2"],
    ["小调完整属七", toMinorVI, "C minor", "V7/2 | VI/2"],
    ["上声部属根上四度补主音", [toVi[0], toVi[1], "G3/2 | C4/2", toVi[3]], "C major", "V7/2 | vi/2"],
    ["上声部属根下五度补主音", [toMinorVI[0], "G4/2 | C4/2", "F3/2 | Eb3/2", toMinorVI[3]], "C minor", "V7/2 | VI/2"],
  ] satisfies Array<[string, Parts, string, string]>)("%s 的实写重复不建议改成重根", (_label, parts, key, chords) => {
    expect(run(parts, key, chords)).not.toContainEqual(d5At());
  });

  it("无预给标签时也由正常推导和规则入口取得同一结果", () => {
    const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..3 {
 S: | G5/2 | B4/2 | C5/2 |
 A: | G4/2 | F4/2 | E4/2 |
 T: | E4/2 | D4/2 | C4/2 |
 B: | C3/2 | G2/2 | A2/2 |
}`);
    const analyzed = applyHarmonyInference(project, inferHarmony(project), { mode: "replace-unlocked" }).project;
    expect(analyzed.chordTrack.regions.at(-1)?.semantics?.interpretations[0]).toMatchObject({ degree: 6 });
    expect(checkHarmony(analyzed).diagnostics).not.toContainEqual(d5At(4 * PPQ, 6 * PPQ));
  });

  it.each([
    ["主到六级", ["C5/2 | C5/2", "G4/2 | E4/2", "E4/2 | C4/2", "C3/2 | A2/2"], "I/2 | vi/2"],
    ["给错属七标签，实奏为另一和弦", ["C5/2 | C5/2", "G4/2 | E4/2", "E4/2 | C4/2", "C3/2 | A2/2"], "V7/2 | vi/2"],
    ["同级但低音换音区", [toVi[0], toVi[1], toVi[2], "G2/2 | A3/2"], "V7/2 | vi/2"],
    ["导音换八度", ["B4/2 | C6/2", toVi[1], toVi[2], toVi[3]], "V7/2 | vi/2"],
    ["属七五音异名", [toVi[0], toVi[1], "C##4/2 | C4/2", toVi[3]], "V7/2 | vi/2"],
    ["和弦配置虽相同，VI 第二拍另外重奏", ["B4/2 | C5/4 C5/4", "F4/2 | E4/4 E4/4", "D4/2 | C4/4 C4/4", "G2/2 | A2/4 A2/4"], "V7/2 | vi/2"],
  ] satisfies Array<[string, Parts, string]>)("%s 不获得例外", (_label, parts, chords) => {
    expect(run(parts, "C major", chords)).toContainEqual(d5At(parts[0].includes("C5/4 C5/4") ? 3 * PPQ : arrival));
  });

  it("明确句界后保留配置建议", () => {
    expect(run(toVi, "C major", "V7/2 | vi/2", true)).toContainEqual(d5At());
  });

  it("六级有重三但原声部七音未下行，配置建议与七音 warning 都存在", () => {
    const bad: Parts = ["B4/2 | C5/2", "D4/2 | E4/2", "F3/2 | C4/2", "G2/2 | A2/2"];
    const findings = run(bad);
    expect(findings).toContainEqual(d5At());
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: seventh, severity: "warning", tick: arrival,
      voiceIds: ["tenor"] }));
  });

  it("小调坏例的导音下行增二度仍报旋律和解决警告", () => {
    const wrong: Parts = ["D5/2 | C5/2", "B3/2 | Ab3/2", "F3/2 | Eb3/2", "G2/2 | Ab2/2"];
    const findings = run(wrong, "C minor", "V7/2 | VI/2");
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: leading, severity: "warning", tick: arrival,
      voiceIds: ["alto"] }));
    expect(findings).toContainEqual(expect.objectContaining({
      ruleId: "melody.augmented-interval", severity: "warning", tick: arrival, voiceIds: ["alto"],
    }));
  });
});
