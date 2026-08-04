import { describe, expect, it } from "vitest";
import { resolveChordIdentity } from "./chordModel";
import {
  formatSpelledPitch,
  keySignatureFifths,
  parsePitchClass,
  serializePitchClass,
  spellMidi,
  toMidi,
  transposeSpelledPitch,
  writtenInterval,
} from "./pitch";

describe("书写音高", () => {
  it("保留同音异名，同时派生相同 MIDI 音高", () => {
    const cSharp = { step: "C" as const, alter: 1 as const, octave: 4 };
    const dFlat = { step: "D" as const, alter: -1 as const, octave: 4 };

    expect(toMidi(cSharp)).toBe(61);
    expect(toMidi(dFlat)).toBe(61);
    expect(formatSpelledPitch(cSharp)).toBe("C♯4");
    expect(formatSpelledPitch(dFlat)).toBe("D♭4");
  });

  it("根据当前调号推断迁移音符拼写", () => {
    expect(
      spellMidi(66, {
        tonic: { step: "G", alter: 0 },
        mode: "major",
      }),
    ).toEqual({ step: "F", alter: 1, octave: 4 });
    expect(
      spellMidi(66, {
        tonic: { step: "D", alter: -1 },
        mode: "major",
      }),
    ).toEqual({ step: "G", alter: -1, octave: 4 });
  });

  it("正确处理跨八度的降 C、升 B 与整八度移调", () => {
    expect(toMidi({ step: "C", alter: -1, octave: 4 })).toBe(59);
    expect(toMidi({ step: "B", alter: 1, octave: 3 })).toBe(60);
    expect(
      transposeSpelledPitch({ step: "D", alter: -1, octave: 4 }, 12),
    ).toEqual({ step: "D", alter: -1, octave: 5 });
  });

  it("区分增四度与减五度的书写音程", () => {
    expect(
      writtenInterval(
        { step: "F", alter: 0, octave: 4 },
        { step: "B", alter: 0, octave: 4 },
      ),
    ).toEqual({ diatonicSteps: 3, semitones: 6 });
    expect(
      writtenInterval(
        { step: "B", alter: 0, octave: 3 },
        { step: "F", alter: 0, octave: 4 },
      ),
    ).toEqual({ diatonicSteps: 4, semitones: 6 });
  });

  it("调性序列化与 MIDI 调号五度数稳定", () => {
    const tonic = { step: "F" as const, alter: 1 as const };
    expect(parsePitchClass(serializePitchClass(tonic))).toEqual(tonic);
    expect(keySignatureFifths({ tonic, mode: "major" })).toBe(6);
    expect(
      keySignatureFifths({
        tonic: { step: "E", alter: -1 },
        mode: "minor",
      }),
    ).toBe(-6);
    expect(() =>
      keySignatureFifths({
        tonic: { step: "F", alter: -1 },
        mode: "major",
      }),
    ).toThrow("不是受支持的调号");
  });
});

describe("和弦实体拼写", () => {
  it("分别解析副属目标与局部调性中的副属和弦", () => {
    const cMajor = {
      tonic: { step: "C" as const, alter: 0 as const },
      mode: "major" as const,
    };
    const secondaryDominant = resolveChordIdentity(
      {
        degree: 5,
        degreeAlteration: 0,
        quality: "dominant7",
        inversion: 1,
        appliedTarget: 5,
        source: "manual",
      confidence: "certain",
      },
      cMajor,
    );
    expect(secondaryDominant).toMatchObject({
      root: { step: "D", alter: 0 },
      bass: { step: "F", alter: 1 },
    });

    const localSecondary = resolveChordIdentity(
      {
        degree: 5,
        degreeAlteration: 0,
        quality: "major",
        inversion: 0,
        localKey: { tonic: { step: "D", alter: 0 }, mode: "major" },
        appliedTarget: 5,
        source: "confirmed",
        confidence: "certain",
      },
      cMajor,
    );
    expect(localSecondary.root).toEqual({ step: "E", alter: 0 });
  });
});
