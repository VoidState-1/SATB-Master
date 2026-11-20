import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, inferChords } from "../../inference";
import { checkHarmony } from "../../registry";

const rule = "melody.augmented-interval";

function score(passing: string, key = "C major") {
  const transposed = key === "D major";
  const parts = transposed
    ? [`D5/2 A4/4. ${passing}/8 | G4/2 F#4/2`, "F#4/1 | E4/2 D4/2", "A3/2 D4/2 | C#4/2 A3/2", "D3/1 | A2/2 D3/2"]
    : [`C5/2 G4/4. ${passing}/8 | F4/2 E4/2`, "E4/1 | D4/2 C4/2", "G3/2 C4/2 | B3/2 G3/2", "C3/1 | G2/2 C3/2"];
  return compileScoreText(`satb 1
key ${key}
meter 4/4
bars 1..2 {
${parts.map((part, index) => ` ${["S", "A", "T", "B"][index]}: | ${part} |`).join("\n")}
}`).project;
}

function infer(project: ReturnType<typeof score>) {
  return applyHarmonyInference(project, { chordInference: inferChords(project) }, {
    mode: "replace-unlocked", writeNonChordToneRoles: true,
  }).project;
}

describe("单声部半音经过与前一拍的和弦分解", () => {
  it.each([
    ["C major", "Gb4", "F#4", "F♯4"],
    ["D major", "Ab4", "G#4", "G♯4"],
  ])("%s 中降五级的经过音提示其等音拼写，升四级正常放行", (key, bad, good, spelling) => {
    for (const [pitch, expected] of [[bad, true], [good, false]] as const) {
      const project = infer(score(pitch, key));
      for (const overrides of [{}, { [rule]: { arpeggiation: "exempt" as const } }]) {
        const warnings = checkHarmony(project, undefined, {}, overrides).diagnostics
          .filter(item => item.ruleId === rule && item.voiceIds.includes("soprano"));
        if (!expected) {
          expect(warnings).toEqual([]);
          continue;
        }
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({
          tick: project.ppq * 3.5, severity: "warning",
          messageKey: `${rule}.passing-spelling`, message: expect.stringContaining(spelling),
          noteIds: ["note-S-1920", "note-S-3360"],
        });
        expect(warnings[0]).not.toHaveProperty("melodyTransitionId");
      }
    }
  });

  it("在显式句界前结束取证", () => {
    const project = infer(score("Gb4"));
    project.structure.phraseBoundaries.push({
      id: "boundary", tick: project.ppq * 4, source: "manual", confidence: "certain",
    });
    expect(checkHarmony(project).diagnostics.some(item => item.messageKey === `${rule}.passing-spelling`)).toBe(false);
  });
});

function withAltoReattack(accompaniment: string) {
  return infer(compileScoreText(`satb 1
key D major
meter 4/4
bars 1..2 {
  S: | D5/2 A4/4. Ab4/8 | G4/2 F#4/2 |
  A: | F#4/t3360 ${accompaniment}/8 | E4/2 D4/2 |
  T: | A3/2 D4/2 | B3/2 A3/2 |
  B: | D3/1 | E3/2 D3/2 |
}`).project);
}

describe("半音经过点的伴随声部重击", () => {
  it.each([
    ["伴随音保持书写音高", "F#4", true],
    ["伴随声部实际平行下行", "F4", false],
  ] as const)("%s 时核对降五级的拼写建议", (_description, accompaniment, expected) => {
    const diagnostics = checkHarmony(withAltoReattack(accompaniment)).diagnostics.filter(item =>
      item.ruleId === rule && item.tick === 3360 && item.voiceIds.includes("soprano"),
    );
    if (!expected) {
      expect(diagnostics).toEqual([]);
      return;
    }
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ messageKey: `${rule}.passing-spelling`, severity: "warning" });
    expect(diagnostics[0].message).toContain("G♯4");
  });
  it("伴随声部重击并标明和弦外音时暂缓拼写建议", () => {
    const project = withAltoReattack("F#4");
    const alto = project.satbTracks.find(track => track.voice === "alto")!;
    alto.notes.find(note => note.startTick === 3360)!.nonChordToneRole = "other";
    expect(checkHarmony(project).diagnostics.some(item => item.tick === 3360 &&
      item.messageKey === `${rule}.passing-spelling`)).toBe(false);
  });
});
