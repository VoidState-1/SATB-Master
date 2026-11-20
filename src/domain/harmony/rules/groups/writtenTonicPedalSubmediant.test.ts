import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";

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

function blind(project: ReturnType<typeof example>) {
  return applyHarmonyInference(project, { chordInference: inferChords(project) }, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
}

function warnings(project: ReturnType<typeof example>) {
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === ruleId && d.tick === 2 * project.ppq);
}


function expectNoAltoWarning(project: ReturnType<typeof example>) {
  expect(warnings(project).filter(d => d.voiceIds.includes("alto"))).toEqual([]);
}
describe("第 50 章主音持续低音上的降 VI 连接", () => {
  it.each([
    ["进入，女低变化", "E4/2 Eb4/2", "G3/2 Ab3/2", "I/2 bVI6/2"],
    ["返回，女低变化", "Eb4/2 E4/2", "Ab3/2 G3/2", "bVI6/2 I/2"],
    ["进入，男高变化", "G4/2 Ab4/2", "E4/2 Eb4/2", "I/2 bVI6/2"],
    ["返回，男高变化", "Ab4/2 G4/2", "Eb4/2 E4/2", "bVI6/2 I/2"],
  ])("%s 时在两种入口均无 B.3", (_name, alto, tenor, harmony) => {
    const project = example({ alto, tenor });
    expect(warnings(blind(project))).toEqual([]);
    expect(warnings(example({ alto, tenor, harmony }))).toEqual([]);
  });

  it.each([
    ["进入", "E4/2 Eb4/2", "G3/2 F#3/2", "I/2 bVI6/2"],
    ["返回", "Eb4/2 E4/2", "Ab3/2 F#3/2", "bVI6/2 I/2"],
  ])("%s时把伴随声部的目标改为冲突音，原声部增一度不报警", (_direction, alto, tenor, harmony) => {
    const project = example({ alto, tenor });
    for (const input of [blind(project), example({ alto, tenor, harmony })]) {
      expectNoAltoWarning(input);
    }
  });

  it("持续低音之下还有实音时不因增一度报警", () => {
    const score = { bass: "C4/1" };
    expectNoAltoWarning(blind(example(score)));
    expectNoAltoWarning(example({ ...score, harmony: "I/2 bVI6/2" }));
  });

  it.each([
    ["alto", 1],
    ["tenor", 0],
    ["bass", 0],
  ] as const)("%s 第 %i 个音标为经过音时不因增一度报警", (voice, index) => {
    const marked = (harmony = "") => {
      const project = example({ harmony });
      project.satbTracks.find(track => track.id === voice)!.notes[index].nonChordToneRole = "passing";
      return project;
    };
    expectNoAltoWarning(blind(marked()));
    expectNoAltoWarning(marked("I/2 bVI6/2"));
  });

  it("允许已标为持续音的最低主音作证", () => {
    const project = example({ harmony: "I/2 bVI6/2" });
    project.satbTracks.find(track => track.id === "bass")!.notes[0].nonChordToneRole = "pedal";
    expect(warnings(project)).toEqual([]);
  });

  it.each([1, 2])("显式句界位于 q%i 时不因增一度报警", q => {
    const marked = (harmony = "") => {
      const project = example({ harmony });
      project.structure.phraseBoundaries.push({
        id: "manual", tick: q * project.ppq, confidence: "certain", source: "manual",
      });
      return project;
    };
    expectNoAltoWarning(blind(marked()));
    expectNoAltoWarning(marked("I/2 bVI6/2"));
  });
});
