import { describe, expect, it } from "vitest";
import { chordIdentityEquals, chordIdentityToneSpellings } from "../../chordModel";
import { formatChordIdentity } from "../../chords";
import { formatPitchClass } from "../../pitch";
import { validateProject } from "../../project";
import { compileScoreText, renderScoreText } from "../../scoreText";
import { checkHarmony, applyHarmonyInference, inferChords } from "../index";

function projectFor({
  key = "C major",
  soprano = "D#5/4 E5/4",
  alto = "F#4/4 G4/4",
  tenor = "C4/4 C4/4",
  bass = "Ab2/4 G2/4",
  harmony = "",
} = {}) {
  return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..1 {
 S: | ${soprano} |
 A: | ${alto} |
 T: | ${tenor} |
 B: | ${bass} |
 ${harmony ? `H: | ${harmony} |` : ""}
}`).project;
}

function opening(project: ReturnType<typeof projectFor>) {
  return inferChords(project).regions.find(region => region.fromTick === 0);
}

function firstRuleIds(project: ReturnType<typeof projectFor>, ruleId: string, tick = 0) {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === ruleId && item.tick === tick);
}

describe("实写升二的重属倍增三四", () => {
  it("以独立身份写回 [降六、主、升二、升四]，显示不同于德增六", () => {
    const project = projectFor();
    const inference = inferChords(project);
    const first = inference.regions[0].selected!;
    expect(first.functionalBaseId).toBe("DD++43");
    expect(first.fit).toMatchObject({ spellingConsistent: true, nonChordToneNoteIds: [] });
    expect(inference.regions[0].alternatives.map(item => item.functionalBaseId)).not.toContain("Ger+6");
    expect(chordIdentityToneSpellings(first.identity).map(formatPitchClass)).toEqual(["A♭", "C", "D♯", "F♯"]);
    expect(formatChordIdentity(first.identity, first.semantics)).toMatchObject({
      roman: "DD++43", absolute: "A♭-C-D♯-F♯",
    });
    const written = applyHarmonyInference(project, { chordInference: inference },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(written.satbTracks).toEqual(project.satbTracks);
    expect(validateProject(JSON.parse(JSON.stringify(written)))).toBe(true);
    expect(renderScoreText(written)).toContain("symbol=DD++43");
    expect(firstRuleIds(written, "chord.augmented-sixth-voicing")).toHaveLength(0);
    expect(firstRuleIds(written, "chord.unclassified-nonchord-tone")).toHaveLength(0);
  });

  it("F♯ 大调保留重升 G，并分别对 D→C♯、B♯→C♯及 G𝄪→A♯取证", () => {
    const project = projectFor({
      key: "F# major", soprano: "F#4/2", alto: "B#3/4 C#4/4", tenor: "G##3/4 A#3/4", bass: "D3/4 C#3/4",
    });
    const chord = opening(project)?.selected;
    expect(chord?.functionalBaseId).toBe("DD++43");
    expect(chordIdentityToneSpellings(chord!.identity).map(formatPitchClass)).toEqual(["D", "F♯", "G𝄪", "B♯"]);
  });

  it("等音 E♭ 仍是标准德增六，显式用错标签时配置检查分别报警", () => {
    const german = projectFor({ soprano: "Eb5/4 E5/4", harmony: "Ger+6/4 K46/4" });
    const doubled = projectFor({ harmony: "DD++43/4 K46/4" });
    expect(chordIdentityEquals(german.chordTrack.regions[0].identity, doubled.chordTrack.regions[0].identity)).toBe(false);
    expect(opening(german)?.selected?.functionalBaseId).toBe("Ger+6");
    expect(firstRuleIds(german, "chord.augmented-sixth-voicing")).toHaveLength(0);
    expect(firstRuleIds(doubled, "chord.augmented-sixth-voicing")).toHaveLength(0);
    expect(firstRuleIds(projectFor({ harmony: "Ger+6/4 K46/4" }), "chord.augmented-sixth-voicing")).toHaveLength(1);
    expect(firstRuleIds(projectFor({ soprano: "Eb5/4 E5/4", harmony: "DD++43/4 K46/4" }),
      "chord.augmented-sixth-voicing")).toHaveLength(1);
  });

  it.each([
    ["升二音错八度", { soprano: "D#5/4 E4/4" }],
    ["升四音未到属音", { alto: "F#4/4 F4/4" }],
    ["降六音未下行半音", { bass: "Ab2/4 G3/4" }],
    ["主音换八度", { tenor: "C4/4 C3/4" }],
    ["名义低音高于实奏其他声部", { bass: "Ab5/4 G5/4" }],
    ["低音先到属音而升二仍保持", {
      soprano: "D#5/4. E5/8", alto: "F#4/4. G4/8", tenor: "C4/2", bass: "Ab2/4 G2/4",
    }],
    ["回原位主三和弦", { bass: "Ab2/4 C3/4" }],
    ["书面是小调", { key: "C minor", soprano: "D#5/4 Eb5/4" }],
  ])("%s 时保留原检查路径", (_description, voicing) => {
    const region = opening(projectFor(voicing));
    expect([region?.selected, ...(region?.alternatives ?? [])].map(item => item?.functionalBaseId)).not.toContain("DD++43");
  });

  it("显式倍增三四不能仅凭增六两端正确解决到普通属和弦", () => {
    const passing = projectFor({ harmony: "DD++43/4 I64/4" });
    const dominant = projectFor({ soprano: "D#5/4 D5/4", tenor: "C4/4 B3/4", harmony: "DD++43/4 D/4" });
    expect(firstRuleIds(passing, "resolution.augmented-sixth", passing.ppq)).toHaveLength(0);
    expect(firstRuleIds(dominant, "resolution.augmented-sixth", dominant.ppq)).toHaveLength(1);
  });
});
