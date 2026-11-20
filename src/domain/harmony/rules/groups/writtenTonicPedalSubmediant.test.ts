import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { buildHarmonyAnalysis } from "../../analysis";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";
import { readWrittenTonicPedalSubmediant } from "../../writtenTonicPedalSubmediant";
import { createHarmonyRuleContext } from "../context/createRuleContext";

const ruleId = "melody.augmented-interval";
function example({
  soprano = "C5/1", alto = "E4/2 Eb4/2", tenor = "G3/2 Ab3/2", bass = "C3/1", harmony = "",
} = {}) {
  return compileScoreText(`satb 1
key C major
meter 4/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 ${harmony ? "H: | " + harmony + " |" : ""}
}`).project;
}

function readConnection(project: ReturnType<typeof example>) {
  const context = createHarmonyRuleContext(buildHarmonyAnalysis(project));
  return readWrittenTonicPedalSubmediant(
    context.sliceAt(project.ppq * 2 - 1)!, context.sliceAt(project.ppq * 2)!, project.structure.phraseBoundaries,
  );
}

function blind(project: ReturnType<typeof example>) {
  return applyHarmonyInference(project, { chordInference: inferChords(project) }, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
}

function warnings(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === ruleId && d.tick === 2 * project.ppq);
}


function expectAltoWarning(project: ReturnType<typeof example>) {
  expect(warnings(project)).toContainEqual(expect.objectContaining({
    voiceIds: ["alto"], severity: "warning", params: { intervalNumber: 1, quality: "增", semitones: 1 },
  }));
}
describe("第 50 章主音持续低音上的降 VI 连接", () => {
  it.each([
    ["alto", "to-flat-submediant", "E4/2 Eb4/2", "G3/2 Ab3/2", "I/2 bVI6/2"],
    ["alto", "to-tonic", "Eb4/2 E4/2", "Ab3/2 G3/2", "bVI6/2 I/2"],
    ["tenor", "to-flat-submediant", "G4/2 Ab4/2", "E4/2 Eb4/2", "I/2 bVI6/2"],
    ["tenor", "to-tonic", "Ab4/2 G4/2", "Eb4/2 E4/2", "bVI6/2 I/2"],
  ])("识别 %s 的 %s 并在两种入口静默", (thirdVoice, direction, alto, tenor, harmony) => {
    const project = example({ alto, tenor });
    expect(readConnection(project)).toMatchObject({ thirdVoice, direction });
    expect(warnings(blind(project))).toEqual([]);
    expect(warnings(example({ alto, tenor, harmony }))).toEqual([]);
  });

  it("允许高音在原音高再次奏出", () => {
    expect(readConnection(example({ soprano: "C5/2 C5/2" }))).toMatchObject({ direction: "to-flat-submediant" });
  });

  it.each([
    ["低音重新奏出", { bass: "C3/2 C3/2" }],
    ["高音换八度", { soprano: "C5/2 C6/2" }],
    ["内声伴随音改成升号拼写", { tenor: "G3/2 G#3/2" }],
    ["内声伴随音超出半音", { tenor: "G3/2 Ab4/2" }],
  ])("%s 时没有教材连接证据", (_name, parts) => {
    expect(readConnection(example(parts))).toBeUndefined();
  });

  it.each([
    ["进入", "E4/2 Eb4/2", "G3/2 F#3/2", "I/2 bVI6/2"],
    ["返回", "Eb4/2 E4/2", "Ab3/2 F#3/2", "bVI6/2 I/2"],
  ])("%s时把伴随声部的目标改为冲突音，保留原声部增一度警告", (_direction, alto, tenor, harmony) => {
    const project = example({ alto, tenor });
    expect(readConnection(project)).toBeUndefined();
    for (const input of [blind(project), example({ alto, tenor, harmony })]) {
      expectAltoWarning(input);
    }
  });

  it("持续低音之下还有实音时保留增一度警告", () => {
    const score = { bass: "C4/1" };
    expect(readConnection(example(score))).toBeUndefined();
    expectAltoWarning(blind(example(score)));
    expectAltoWarning(example({ ...score, harmony: "I/2 bVI6/2" }));
  });

  it.each([
    ["alto", 1],
    ["tenor", 0],
    ["bass", 0],
  ] as const)("%s 第 %i 个音标为经过音时保留增一度警告", (voice, index) => {
    const marked = (harmony = "") => {
      const project = example({ harmony });
      project.satbTracks.find(track => track.id === voice)!.notes[index].nonChordToneRole = "passing";
      return project;
    };
    expect(readConnection(marked())).toBeUndefined();
    expectAltoWarning(blind(marked()));
    expectAltoWarning(marked("I/2 bVI6/2"));
  });

  it("允许已标为持续音的最低主音作证", () => {
    const project = example({ harmony: "I/2 bVI6/2" });
    project.satbTracks.find(track => track.id === "bass")!.notes[0].nonChordToneRole = "pedal";
    expect(readConnection(project)).toMatchObject({ direction: "to-flat-submediant" });
    expect(warnings(project)).toEqual([]);
  });

  it.each([1, 2])("显式句界位于 q%i 时保留增一度警告", q => {
    const marked = (harmony = "") => {
      const project = example({ harmony });
      project.structure.phraseBoundaries.push({
        id: "manual", tick: q * project.ppq, confidence: "certain", source: "manual",
      });
      return project;
    };
    expect(readConnection(marked())).toBeUndefined();
    expectAltoWarning(blind(marked()));
    expectAltoWarning(marked("I/2 bVI6/2"));
  });
});
