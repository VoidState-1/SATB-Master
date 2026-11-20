import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { checkHarmony } from "../../registry";

type Source = "DD++43" | "Ger+6" | "viio7/V";
function music(source: Source, overrides: Partial<Record<"soprano" | "alto" | "tenor" | "bass" | "target", string>> = {}) {
  const diminished = source === "viio7/V";
  return compileScoreText(`satb 1
key G major
meter 4/4
bars 1..2 {
  S: | E5/2 ${diminished ? "E5" : "C#5"}/2~ | ${overrides.soprano ?? (diminished ? "E5/4 D5/2." : "C#5/4 D5/2.")} |
  A: | G4/1~ | ${overrides.alto ?? "G4/1"} |
  T: | C4/2 A#3/2~ | ${overrides.tenor ?? "A#3/4 B3/2."} |
  B: | C3/2 ${diminished ? "C#3" : "Eb3"}/2 | ${overrides.bass ?? "D3/1"} |
  H: | IV/2 ${source}/2 | ${overrides.target ?? "K46/1"} |
}`).project;
}

const rule = "chord.unclassified-nonchord-tone";
function outside(project: ReturnType<typeof music>) {
  return checkHarmony(project).diagnostics.filter(d => d.ruleId === rule && d.tick === 4 * project.ppq);
}

describe("属低音先到，两个延留声部在 K46 内解决", () => {
  it.each(["DD++43", "Ger+6", "viio7/V"] as const)("根据实音核对 %s 的两个声部", source => {
    const project = music(source);
    const original = structuredClone(project);
    expect(outside(project)).toEqual([]);
    expect(project).toEqual(original);
    if (source === "Ger+6") {
      expect(checkHarmony(project).diagnostics).toContainEqual(expect.objectContaining({
        ruleId: "chord.augmented-sixth-voicing", tick: 2 * project.ppq,
      }));
    }
  });

  it.each(["DD++43", "viio7/V"] as const)("保留 %s 的显式角色及另一声部的独立提示", source => {
    const project = music(source);
    const held = project.satbTracks.find(t => t.voice === "tenor")!.notes[1];
    held.nonChordToneRole = "neighbor";
    expect(outside(project)).toContainEqual(expect.objectContaining({
      severity: "warning", voiceIds: ["soprano"],
    }));
    expect(held.nonChordToneRole).toBe("neighbor");
  });

  it.each(["DD++43", "viio7/V"] as const)("%s 的错音区、重奏、迟解和跨界保留 D.1", source => {
    const badRelease = music(source, { tenor: "A#3/4 B4/2." });
    const changedBass = music(source, { bass: "D3/4 D3/2." });
    const differentLabel = music(source, { target: "I64/1" });
    const newAttack = music(source);
    const track = newAttack.satbTracks.find(t => t.voice === "tenor")!;
    const held = track.notes.find(n => n.startTick === 2 * newAttack.ppq)!;
    held.durationTicks = 2 * newAttack.ppq;
    track.notes.push({ ...held, id: "new-tenor", startTick: 4 * newAttack.ppq, durationTicks: newAttack.ppq });
    track.notes.sort((a, b) => a.startTick - b.startTick);
    const boundary = music(source);
    boundary.structure.phraseBoundaries.push({ id: "cut", tick: 4 * boundary.ppq, source: "manual", confidence: "certain" });
    const late = music(source, { soprano: (source === "DD++43" ? "C#5" : "E5") + "/2 D5/2", tenor: "A#3/2 B3/2" });
    const wrongSpelling = music(source);
    const third = wrongSpelling.satbTracks.find(t => t.voice === "tenor")!.notes[1];
    third.pitch = { step: "B", alter: -1, octave: 3 };
    const repeatedCommon = music(source, { alto: "G4/4 G4/2." });
    for (const project of [badRelease, changedBass, differentLabel, newAttack, boundary, late, wrongSpelling, repeatedCommon]) {
      expect(outside(project)).toContainEqual(expect.objectContaining({
        severity: "warning", voiceIds: ["soprano", "tenor"],
      }));
    }
  });
});
