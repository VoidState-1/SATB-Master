import { describe, expect, it } from "vitest";
import { resolveChordIdentity } from "./chordModel";
import {
  enharmonicSpellings,
  formatSpelledPitch,
  isDiatonicPitch,
  isWrittenStep,
  keyDiatonicPitchClasses,
  keySignatureFifths,
  keyTonicOptions,
  leadingTonePitchClass,
  normalizePitchClassNumber,
  parsePitchClass,
  parseSpelledPitch,
  pitchClassValue,
  scaleDegreePitchClass,
  serializePitchClass,
  serializeSpelledPitch,
  spellMidi,
  spelledPitchEquals,
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

  it("计算音符的所有有效同音异名候选并保持 MIDI 音高严格一致", () => {
    const eb4 = { step: "E" as const, alter: -1 as const, octave: 4 };
    const spellings = enharmonicSpellings(eb4);
    expect(spellings).toEqual([
      { step: "D", alter: 1, octave: 4 }, // D♯4
      { step: "E", alter: -1, octave: 4 }, // E♭4
      { step: "F", alter: -2, octave: 4 }, // F♭♭4
    ]);
    for (const spelling of spellings) {
      expect(toMidi(spelling)).toBe(63);
    }

    const c4 = { step: "C" as const, alter: 0 as const, octave: 4 };
    const cSpellings = enharmonicSpellings(c4);
    expect(cSpellings).toEqual([
      { step: "C", alter: 0, octave: 4 }, // C4
      { step: "B", alter: 1, octave: 3 }, // B♯3
      { step: "D", alter: -2, octave: 4 }, // D♭♭4
    ]);
    for (const spelling of cSpellings) {
      expect(toMidi(spelling)).toBe(60);
    }

    const gSharp4 = { step: "G" as const, alter: 1 as const, octave: 4 };
    const gSharpSpellings = enharmonicSpellings(gSharp4);
    expect(gSharpSpellings).toEqual([
      { step: "G", alter: 1, octave: 4 }, // G♯4
      { step: "A", alter: -1, octave: 4 }, // A♭4
    ]);
    for (const spelling of gSharpSpellings) {
      expect(toMidi(spelling)).toBe(68);
    }
  });

  it("支持 SpelledPitch 的序列化、反序列化与相等性比较", () => {
    const pitch = { step: "D" as const, alter: 1 as const, octave: 4 };
    const serialized = serializeSpelledPitch(pitch);
    expect(serialized).toBe("D:1:4");
    expect(parseSpelledPitch(serialized)).toEqual(pitch);
    expect(parseSpelledPitch("invalid")).toBeUndefined();
    expect(spelledPitchEquals(pitch, { step: "D", alter: 1, octave: 4 })).toBe(true);
    expect(spelledPitchEquals(pitch, { step: "E", alter: -1, octave: 4 })).toBe(false);
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

  it.each([
    ["F", 1, 65, "E:1:4"],
    ["C", 1, 60, "B:1:3"],
    ["G", 1, 67, "F:2:4"],
    ["D", 1, 62, "C:2:4"],
    ["A", 1, 69, "G:2:4"],
    ["D", 0, 61, "C:1:4"],
    ["G", 0, 66, "F:1:4"],
  ] as const)("小调 %s:%i 的导音保留七级字母与升降号", (step, alter, midi, expected) => {
    const key = { tonic: { step, alter }, mode: "minor" as const };
    const spelling = spellMidi(midi, key);
    expect(serializeSpelledPitch(spelling)).toBe(expected);
    expect(toMidi(spelling)).toBe(midi);
  });

  it("所有受支持小调都能拼写导音，同时保留自然小调七个音级", () => {
    for (const tonic of keyTonicOptions("minor")) {
      const key = { tonic, mode: "minor" as const };
      const leadingTone = leadingTonePitchClass(key);
      for (let midi = 0; midi <= 127; midi += 1) {
        if (midi % 12 !== pitchClassValue(leadingTone)) continue;
        const spelling = spellMidi(midi, key);
        expect(spelling).toMatchObject(leadingTone);
        expect(toMidi(spelling)).toBe(midi);
      }
      for (let degree = 1; degree <= 7; degree += 1) {
        const naturalDegree = scaleDegreePitchClass(key, degree);
        expect(spellMidi(60 + pitchClassValue(naturalDegree), key))
          .toMatchObject(naturalDegree);
      }
    }
  });

  it("F♯ 小调半音移调使用 E♯，原有显式拼写在零移调和八度移调时保留", () => {
    const key = { tonic: { step: "F" as const, alter: 1 as const }, mode: "minor" as const };
    expect(transposeSpelledPitch({ step: "F", alter: 1, octave: 4 }, -1, key))
      .toEqual({ step: "E", alter: 1, octave: 4 });
    const explicitF = { step: "F" as const, alter: 0 as const, octave: 4 };
    expect(transposeSpelledPitch(explicitF, 0, key)).toEqual(explicitF);
    expect(transposeSpelledPitch(explicitF, 12, key))
      .toEqual({ ...explicitF, octave: 5 });
    expect(isDiatonicPitch(65, key)).toBe(false);
    expect(spellMidi(65)).toEqual(explicitF);
    expect(spellMidi(65, { ...key, mode: "major" }))
      .toEqual({ step: "E", alter: 1, octave: 4 });
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

  it("统一计算模 12、书写级进和大小调导音", () => {
    expect(normalizePitchClassNumber(-1)).toBe(11);
    expect(
      isWrittenStep(
        writtenInterval(
          { step: "B", alter: 0, octave: 3 },
          { step: "C", alter: 0, octave: 4 },
        ),
      ),
    ).toBe(true);
    expect(
      isWrittenStep(
        writtenInterval(
          { step: "C", alter: 1, octave: 4 },
          { step: "D", alter: -1, octave: 4 },
        ),
      ),
    ).toBe(false);
    expect(
      leadingTonePitchClass({
        tonic: { step: "C", alter: 0 },
        mode: "major",
      }),
    ).toEqual({ step: "B", alter: 0 });
    expect(
      leadingTonePitchClass({
        tonic: { step: "A", alter: 0 },
        mode: "minor",
      }),
    ).toEqual({ step: "G", alter: 1 });
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

  it("正确根据调号计算调内音并判定音高归属（音阶音符指南）", () => {
    const cMajor = { tonic: { step: "C" as const, alter: 0 as const }, mode: "major" as const };
    const gMajor = { tonic: { step: "G" as const, alter: 0 as const }, mode: "major" as const };
    const fMajor = { tonic: { step: "F" as const, alter: 0 as const }, mode: "major" as const };
    const dMinor = { tonic: { step: "D" as const, alter: 0 as const }, mode: "minor" as const };

    // C Major: C D E F G A B (0, 2, 4, 5, 7, 9, 11)
    expect(keyDiatonicPitchClasses(cMajor)).toEqual(new Set([0, 2, 4, 5, 7, 9, 11]));
    expect(isDiatonicPitch(60, cMajor)).toBe(true); // C4
    expect(isDiatonicPitch(61, cMajor)).toBe(false); // C#4
    expect(isDiatonicPitch(65, cMajor)).toBe(true); // F4
    expect(isDiatonicPitch(66, cMajor)).toBe(false); // F#4

    // G Major: G A B C D E F# (7, 9, 11, 0, 2, 4, 6)
    expect(keyDiatonicPitchClasses(gMajor)).toEqual(new Set([0, 2, 4, 6, 7, 9, 11]));
    expect(isDiatonicPitch(66, gMajor)).toBe(true); // F#4 is diatonic!
    expect(isDiatonicPitch(65, gMajor)).toBe(false); // F4 is chromatic!

    // F Major: F G A Bb C D E (5, 7, 9, 10, 0, 2, 4)
    expect(keyDiatonicPitchClasses(fMajor)).toEqual(new Set([0, 2, 4, 5, 7, 9, 10]));
    expect(isDiatonicPitch(70, fMajor)).toBe(true); // Bb4 is diatonic!
    expect(isDiatonicPitch(71, fMajor)).toBe(false); // B4 is chromatic!

    // D Minor: D E F G A Bb C (2, 4, 5, 7, 9, 10, 0)
    expect(keyDiatonicPitchClasses(dMinor)).toEqual(new Set([0, 2, 4, 5, 7, 9, 10]));
    expect(isDiatonicPitch(62, dMinor)).toBe(true); // D4
    expect(isDiatonicPitch(70, dMinor)).toBe(true); // Bb4
    expect(isDiatonicPitch(71, dMinor)).toBe(false); // B4
  });
});
