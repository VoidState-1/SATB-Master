import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../scoreText";
import { inferChords } from "./index";

function score(chords: string[][]) {
  const lines = ["S", "A", "T", "B"].map((voice, i) =>
    "  " + voice + ": | " + chords.map(notes => notes[i] + "/4").join(" ") + " |");
  return compileScoreText(["satb 1", "key C major", "meter " + chords.length + "/4",
    "bars 1..1 {", ...lines, "}"].join("\n")).project;
}

const G7 = ["F5", "B4", "D4", "G2"];
const C7 = ["E5", "Bb4", "C4", "C3"];
const F7 = ["Eb5", "A4", "C4", "F2"];
const Bb7 = ["D5", "Ab4", "Bb3", "Bb2"];
const Eb7 = ["Db5", "G4", "Bb3", "Eb3"];
const C = ["G5", "E4", "C4", "C3"];
const K64 = ["G5", "E4", "C4", "G2"];

describe("实写属七的四度连锁", () => {
  it("连续两次根音四度可辨识省五音的 V7/IV，再次起音仍沿用相同功能", () => {
    const project = score([G7, C7, C7, F7, Bb7, Eb7]);
    const { regions } = inferChords(project, { fromTick: project.ppq, toTick: 3 * project.ppq });
    expect(regions).toHaveLength(1);
    const selected = regions[0].selected!;
    expect(selected.identity).toMatchObject({ root: { step: "C" }, structure: { quality: "dominant7" } });
    expect(selected.semantics?.interpretations[0]).toMatchObject({ degree: 5, appliedTarget: { degree: 4 } });
    expect(selected.semantics?.interpretations[0].localKey).toBeUndefined();
    expect(selected.fit.chordToneNoteIds).toHaveLength(8);
    expect(selected.fit.nonChordToneNoteIds).toEqual([]);
  });

  it("变音目标保存和弦身份与书写方向，保留工程调号", () => {
    const project = score([G7, C7, F7, Bb7, Eb7]);
    const { regions } = inferChords(project, { fromTick: 2 * project.ppq, toTick: 3 * project.ppq });
    expect(regions[0].selected?.identity).toMatchObject({ root: { step: "F" }, structure: { quality: "dominant7" } });
    expect(regions[0].selected?.semantics).toBeUndefined();
    expect(regions[0].selected?.evidence).toContainEqual({
      kind: "sequence-context", code: "dominant-seventh-chain", details: { targetStep: "B", targetAlter: -1 },
    });
    expect(project.keyEvents).toHaveLength(1);
  });

  it("单次四度连接与被其他和弦截断的进行不建立属七模进", () => {
    const { regions } = inferChords(score([G7, C7, C, Bb7]));
    expect(regions.every(r => !r.selected?.evidence.some(e => e.code === "dominant-seventh-chain"))).toBe(true);
  });
});

describe("和声大调的二级下属", () => {
  it.each([
    { tones: ["F5", "Ab4", "C4", "D3"], quality: "halfDiminished7", bass: "D" },
    { tones: ["D5", "Ab4", "F4", "F3"], quality: "diminished", bass: "F" },
  ])("依据完整的书写和属准备辨识 $quality", ({ tones, quality, bass }) => {
    const { regions } = inferChords(score([tones, K64, G7, C]));
    expect(regions[0].selected).toMatchObject({ functionalBaseId: "SII", identity: {
      root: { step: "D" }, bass: { step: bass }, structure: { quality },
    } });
    expect(regions[0].selected?.evidence.some(e => e.code === "harmonic-major-supertonic")).toBe(true);
  });

  it.each([
    ["D5", "Ab4", "F4", "D3"],
    ["D5", "G#4", "F4", "F3"],
  ])("减三原位与同音异名不单凭音高套用下属六和弦", (s, a, t, b) => {
    const { regions } = inferChords(score([[s, a, t, b], K64, G7, C]));
    expect(regions[0].selected?.evidence.some(e => e.code === "harmonic-major-supertonic")).not.toBe(true);
  });
});
