import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";

const melody = "melody.augmented-interval";
const missing = "chord.incomplete-members";
const progression = `satb 1
key F major
meter 4/4
bars 1..1 {
  S: | G4/4 G#4/4 A4/2 |
  A: | E4/2 F4/2 |
  T: | Bb3/2 A3/2 |
  B: | C3/2 F3/2 |
}
annotations {
  chord target range=[1:3,2:1) symbol=I
}`;

function diagnoses(score: string, breakAtLanding = false) {
  const { project } = compileScoreText(score);
  if (breakAtLanding) project.structure.phraseBoundaries = [{
    id: "break", tick: 2 * project.ppq, source: "manual", confidence: "certain",
  }];
  const { diagnostics } = checkHarmony(project, undefined, {}, {
    [melody]: { "same-harmony": "strict", arpeggiation: "strict" },
  });
  return {
    spelling: diagnostics.some(d => d.ruleId === melody && d.voiceIds.includes("soprano") && d.tick === project.ppq),
    fifth: diagnostics.some(d => d.ruleId === missing && d.tick === 2 * project.ppq),
  };
}

describe("升五属七解决时主和弦重复三音（第46章第4节）", () => {
  it.each([
    ["F大调，低音上行四度", progression],
    ["F大调，低音下行五度", progression.replace("C3/2 F3/2", "C3/2 F2/2")],
    ["移调至C大调", progression.replace("F major", "C major")
      .replace("G4/4 G#4/4 A4", "D5/4 D#5/4 E5").replace("E4/2 F4", "B3/2 C4")
      .replace("Bb3/2 A3", "F3/2 E3").replace("C3/2 F3", "G2/2 C3")],
  ])("%s 时升五音和七音各自由原声部解决到三音", (_name, score) => {
    expect(diagnoses(score)).toEqual({ spelling: false, fifth: false });
  });

  it.each([
    ["七音越过八度", progression.replace("Bb3/2 A3", "Bb3/2 A4")],
    ["导音越过八度", progression.replace("E4/2 F4", "E4/2 F5")],
    ["升五音越过八度", progression.replace("G#4/4 A4", "G#4/4 A5")],
    ["低音解决前有休止", progression.replace("C3/2 F3/2", "C3/4. r/8 F3/2")],
    ["低音越过八度", progression.replace("C3/2 F3/2", "C3/2 F1/2")],
  ])("%s 时仍指出缺五音而无入音 B.3", (_name, score) => {
    expect(diagnoses(score)).toEqual({ spelling: false, fifth: true });
  });

  it("显式标注普通属七时也不从半音入音推断错拼", () => {
    const score = progression.replace("  chord target", "  chord source range=[1:2,1:3) symbol=V7\n  chord target");
    expect(diagnoses(score).spelling).toBe(false);
  });

  it("盲推后由 E.6 区分升五音的两种解决走向", () => {
    const unmarked = `satb 1
key F major
meter 4/4
bars 1..2 {
  S: | F4/4 G4/t2400 G#4/8 | A4/1 |
  A: | C4/4 E4/2. | F4/1 |
  T: | A3/4 Bb3/2. | A3/1 |
  B: | F3/4 C3/2. | F3/1 |
}`;
    for (const [text, violatesResolution] of [[unmarked, false], [unmarked.replace("A4/1", "C5/1"), true]] as const) {
      const input = compileScoreText(text).project;
      const { project } = applyHarmonyInference(input, { chordInference: inferChords(input) }, {
        mode: "replace-unlocked", writeNonChordToneRoles: true,
      });
      const { diagnostics } = checkHarmony(project);
      expect(diagnostics.some(d => d.ruleId === melody && d.tick === 3.5 * input.ppq &&
        d.voiceIds.includes("soprano"))).toBe(false);
      expect(diagnostics.some(d => d.ruleId === "resolution.altered-dominant-fifth" && d.tick === 4 * input.ppq &&
        d.voiceIds.includes("soprano"))).toBe(violatesResolution);
    }
  });

  it("解决不能跨显式句界", () => {
    expect(diagnoses(progression, true)).toEqual({ spelling: false, fifth: true });
  });
});
