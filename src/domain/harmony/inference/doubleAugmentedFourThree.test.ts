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
    ["升二音错八度", { soprano: "D#5/4 E6/4" }],
    ["降六音未下行半音", { bass: "Ab2/4 G3/4" }],
    ["共同主音换八度", { tenor: "C4/4 C3/4", bass: "Ab2/4 G2/4" }],
    ["改到原位属七而非主四六", { soprano: "D#5/4 F5/4", tenor: "C4/4 B3/4" }],
    ["低音先到属音，两上声部后到同一主四六", {
      soprano: "D#5/4. E5/8", alto: "F#4/4. G4/8", tenor: "C4/2", bass: "Ab2/4 G2/4",
    }],
  ])("%s 时和声实音仍能确定书写身份", (_description, voicing) => {
    expect(opening(projectFor(voicing))?.selected?.functionalBaseId).toBe("DD++43");
  });

  it("明确的原位属七后继仍触发真正的解决错误", () => {
    const project = projectFor({ soprano: "D#5/4 F5/4", tenor: "C4/4 B3/4" });
    const result = applyHarmonyInference(project, {chordInference: inferChords(project)},
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(firstRuleIds(result, "resolution.augmented-sixth", project.ppq)).toHaveLength(1);
  });

  it("主音连持、相邻两个实写原位主和弦时，辅助回主仍用独立书写身份", () => {
    const project = compileScoreText(`satb 1
key D major
meter 3/4
bars 1..1 {
 S: | D5/2. |
 A: | F#4/4 E#4/4 F#4/4 |
 T: | A3/4 G#3/4 A3/4 |
 B: | D3/4 Bb2/4 D3/4 |
}`).project;
    const inference = inferChords(project);
    expect(inference.regions.find(region => region.fromTick === project.ppq)?.selected?.functionalBaseId)
      .toBe("DD++43");
    const result = applyHarmonyInference(project, { chordInference: inference },
      { mode: "replace-unlocked", writeNonChordToneRoles: true }).project;
    expect(firstRuleIds(result, "resolution.augmented-sixth", 2 * project.ppq)).toHaveLength(1);
  });

  it.each([
    ["没有可证的后继功能", { alto: "F#4/4 F4/4" }],
    ["没有可证的前置原位主功能", { bass: "Ab2/4 C3/4" }],
    ["名义低音高于实奏其他声部", { bass: "Ab5/4 G5/4" }],
    ["书面是小调且无独立大调证据", { key: "C minor", soprano: "D#5/4 Eb5/4" }],
    ["升二级误写作降三级", { soprano: "Eb5/4 E5/4" }],
    ["升四级改成等音降五级", { alto: "Gb4/4 G4/4" }],
  ])("%s 时不认作倍增三四", (_description, voicing) => {
    const region = opening(projectFor(voicing));
    expect([region?.selected, ...(region?.alternatives ?? [])].map(item => item?.functionalBaseId))
      .not.toContain("DD++43");
  });

  it.each(["key", "phrase"])("功能落点不能跨手动 %s 边界", (boundary) => {
    const project = projectFor();
    if (boundary === "key") {
      project.keyEvents.push({ id: "other", tick: project.ppq,
        tonic: { step: "G", alter: 0 }, mode: "major" });
    } else {
      project.structure.phraseBoundaries.push({
        id: "phrase", tick: project.ppq, source: "manual", confidence: "certain",
      });
    }
    expect(opening(project)?.selected?.functionalBaseId).not.toBe("DD++43");
  });

  it("同一调号内有独立新调准备时，不借新调主和弦证明旧调重属", () => {
    const project = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..4 {
 S: | E5/4 D5/4 | D#5/4 D5/4 | D5/4 C5/4 | B4/2 |
 A: | C5/4 A4/4 | F#4/4 G4/4 | G4/4 F#4/4 | G4/2 |
 T: | G3/4 D4/4 | C4/4 B3/4 | B3/4 A3/4 | D4/2 |
 B: | C3/4 F#2/4 | Ab2/4 G2/4 | D3/4 D3/4 | G2/2 |
}`).project;
    const regionAt = (beat: number) => inferChords(project).regions.find(
      region => region.fromTick <= beat * project.ppq && beat * project.ppq < region.toTick,
    );
    expect(regionAt(3)?.selected?.semantics?.interpretations[0].localKey?.tonic.step).toBe("G");
    expect(regionAt(2)?.selected?.functionalBaseId).not.toBe("DD++43");
  });

  it("推导与填空应用保留手工给定和弦", () => {
    const project = projectFor({ harmony: "Ger+6/4 K46/4" });
    const given = structuredClone(project.chordTrack.regions);
    const inference = inferChords(project);
    expect(inference.regions[0].selected?.functionalBaseId).toBe("DD++43");
    expect(project.chordTrack.regions).toEqual(given);
    expect(applyHarmonyInference(project, { chordInference: inference }, {
      mode: "fill-gaps",
    }).project.chordTrack.regions).toEqual(given);
    expect(firstRuleIds(project, "chord.augmented-sixth-voicing")).toHaveLength(1);
  });

  it("显式倍增三四不能仅凭增六两端正确解决到普通属和弦", () => {
    const passing = projectFor({ harmony: "DD++43/4 I64/4" });
    const dominant = projectFor({ soprano: "D#5/4 D5/4", tenor: "C4/4 B3/4", harmony: "DD++43/4 D/4" });
    expect(firstRuleIds(passing, "resolution.augmented-sixth", passing.ppq)).toHaveLength(0);
    expect(firstRuleIds(dominant, "resolution.augmented-sixth", dominant.ppq)).toHaveLength(1);
  });
});
