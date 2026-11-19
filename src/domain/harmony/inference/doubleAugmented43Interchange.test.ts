import { parseMidi } from "midi-file";
import { describe, expect, it } from "vitest";
import { chordDraftFromIdentity, chordIdentityToneSpellings, resolveChordIdentity } from "../../chordModel";
import { applyChordEditorAction, createChordEditorModel } from "../../chordEditorModel";
import { formatChordIdentity } from "../../chords";
import { compatibleFunctionalInterpretations } from "../../functionalHarmonyCatalog";
import { buildMidi } from "../../midi";
import { buildMusicXml, type MusicXmlLayout } from "../../musicxml";
import { formatPitchClass } from "../../pitch";
import { migrateProject, validateProject } from "../../project";
import { compileScoreText, renderScoreText } from "../../scoreText";

const score = `satb 1
key F# major
meter 2/4
bars 1..1 {
 S: | F#4/2 |
 A: | B#3/4 C#4/4 |
 T: | G##3/4 A#3/4 |
 B: | D3/4 C#3/4 |
 H: | DD++43/4 K46/4 |
}`;

describe("倍增三四的实际输入、目录与输出", () => {
  it("SATBT 输入经 JSON 重开仍保留独立身份和实写重升音", () => {
    const { project } = compileScoreText(score);
    const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(reopened).toBeDefined();
    expect(reopened?.chordTrack.regions).toEqual(project.chordTrack.regions);
    expect(reopened?.satbTracks).toEqual(project.satbTracks);
    const chord = reopened!.chordTrack.regions[0];
    expect(chord.identity.structure).toEqual({ kind: "augmented-sixth", variant: "doubleAugmented43" });
    expect(chordIdentityToneSpellings(chord.identity).map(formatPitchClass)).toEqual(["D", "F♯", "G𝄪", "B♯"]);
    expect(renderScoreText(reopened!)).toContain("symbol=DD++43");
    expect(renderScoreText(reopened!)).toContain("G##3/4");
    const draft = chordDraftFromIdentity(chord.identity, chord.semantics!);
    const catalog = createChordEditorModel(draft, project.keyEvents[0]);
    expect(catalog.baseId).toBe("DD++43");
    expect(catalog.maximumInversion).toBe(0);
    expect(resolveChordIdentity(draft, project.keyEvents[0])).toEqual(chord.identity);
  });

  it("小调不列该项或接受名称，标注局部大调仍可录入", () => {
    const minor = score.replace("F# major", "F# minor");
    expect(() => compileScoreText(minor)).toThrow("需要大调语境");
    const localMajor = minor.replace(" H: | DD++43/4 K46/4 |", "") + `
annotations {
 chord c at=1:1 duration=1/4 symbol=DD++43 localKey="F# major"
}
`;
    const { project } = compileScoreText(localMajor);
    const { identity, semantics } = project.chordTrack.regions[0];
    const draft = chordDraftFromIdentity(identity, semantics!);
    expect(compatibleFunctionalInterpretations(identity).map(item => item.localKey.mode)).toEqual(["major"]);
    const degreeInMinor = { ...draft, localKey: undefined, augmentedSixthVariant: undefined };
    expect(createChordEditorModel(degreeInMinor, project.keyEvents[0]).availableDefinitions.map(item => item.id))
      .not.toContain("DD++43");
    expect(applyChordEditorAction(degreeInMinor, project.keyEvents[0],
      { type: "select-functional-definition", id: "DD++43" })).toBe(degreeInMinor);
    expect(createChordEditorModel(draft, project.keyEvents[0]).availableDefinitions.map(item => item.id))
      .toContain("DD++43");
    const malformed = structuredClone(project);
    malformed.chordTrack.regions[0].semantics!.interpretations[0].localKey = { tonic: { step: "F", alter: 1 }, mode: "minor" };
    expect(validateProject(malformed)).toBe(false);
  });

  it("纯实体仍能正确显示，且无语义工程也校验固定低音", () => {
    const { project } = compileScoreText(score);
    const chord = project.chordTrack.regions[0];
    chord.semantics = undefined;
    expect(validateProject(project)).toBe(true);
    expect(formatChordIdentity(chord.identity)).toMatchObject({ functional: "DD++43", roman: "DD++43" });
    expect(renderScoreText(project)).toContain("symbol=DD++43");
    chord.identity.bass = { step: "F", alter: 1 };
    expect(validateProject(project)).toBe(false);
  });

  it.each<MusicXmlLayout>(["single-staff", "grand-staff", "satb-separate"])(
    "MusicXML %s 保留升降号与正确和弦名", layout => {
      const { project } = compileScoreText(score);
      const xml = buildMusicXml(project, { layout });
      expect(xml).toContain("D-F♯-G𝄪-B♯");
      expect(xml).toContain("DD++43</words>");
      expect(xml).toMatch(/<step>G<\/step>\s*<alter>2<\/alter>\s*<octave>3<\/octave>/);
      expect(xml).not.toContain("Ger+6");
    },
  );

  it.each([["It+6", "italian"], ["Fr+6", "french"], ["Ger+6", "german"]])(
    "旧 schema v3 的 %s 原样重开", (symbol, variant) => {
      const { project } = compileScoreText(score.replaceAll("DD++43", symbol));
      const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
      expect(reopened?.chordTrack.regions[0].identity.structure).toEqual({ kind: "augmented-sixth", variant });
      expect(reopened?.chordTrack.regions).toEqual(project.chordTrack.regions);
    },
  );

  it("MIDI 保留实际音高和可读的倍增三四和弦标记", () => {
    const { project } = compileScoreText(score);
    const events = parseMidi(buildMidi(project, true)).tracks.flat();
    expect(events).toContainEqual(expect.objectContaining({ type: "marker", text: "DD++43" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "noteOn", noteNumber: 57 }));
  });
});
