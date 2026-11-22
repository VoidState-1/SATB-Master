import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { buildHarmonyAnalysis } from "../analysis";
import { checkHarmony } from "../registry";
import { createHarmonyRuleContext } from "../rules/context/createRuleContext";

const score = `satb 1
key F# major
meter 3/4
bars 1..2 {
 S: | C#5/2 D#5/4 | C#5/2. |
 A: | E#4/4 F#4/4 F#4/4 | F#4/2. |
 T: | G#3/4 C#4/4 B#3/4 | C#4/2. |
 B: | C#3/4 A#2/4 G##2/4 | A#2/2. |
}`;
const at = 1920;

describe("实写辅助减七证据", () => {
  it("从裸谱得到实写身份与同一配音回归，成员 API 仍能核读", () => {
    const { project } = compileScoreText(score);
    const analysis = buildHarmonyAnalysis(project);
    const proof = analysis.writtenProlongations.get(at);
    expect(proof).toMatchObject({
      fromTick: at, returnTick: 2880,
      surfaceIdentity: { root: { step: "G", alter: 2 }, bass: { step: "G", alter: 2 } },
      anchorIdentity: { root: { step: "F", alter: 1 }, bass: { step: "A", alter: 1 } },
    });
    const context = createHarmonyRuleContext(analysis);
    const slice = context.sliceAt(at)!;
    expect(slice.chord).toBeUndefined();
    expect(context.harmony.chordMembersAt(slice).filter(item => item.isWrittenChordTone)).toHaveLength(4);
  });

  it("生产 D.3 仍报告明确的错拼转位，并说明实际书写", () => {
    const { project } = compileScoreText(score);
    project.chordTrack.regions = [{
      id: "manual-reading", startTick: at, durationTicks: 960, locked: true,
      identity: {
        root: { step: "B", alter: 1 }, bass: { step: "A", alter: 0 },
        structure: { kind: "tertian", quality: "diminished7", extensions: [], alterations: [] },
      },
    }];
    const issue = checkHarmony(project).diagnostics.find(item => item.ruleId === "chord.inversion-bass");
    expect(issue).toMatchObject({ tick: at, severity: "error",
      evidence: expect.arrayContaining([expect.objectContaining({ label: "实写辅助减七" })]) });
  });

  it.each([
    score.replace("A#2/2.", "F#2/2."),
    score.replace("B#3/4", "C4/4"),
    score.replace("| F#4/2.", "| r/4 F#4/2"),
  ])("缺实写完整性或同配音回归时不给证明", input => {
    const { project } = compileScoreText(input);
    expect(buildHarmonyAnalysis(project).writtenProlongations.has(at)).toBe(false);
  });
});
