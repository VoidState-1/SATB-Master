import { describe, expect, it } from "vitest";
import { addNote } from "../editing";
import { createEmptyProject } from "../project";
import { buildScorePreviewModel, SCORE_VOICE_LAYOUT } from "./buildScorePreviewModel";
import { decomposeDuration } from "./rhythm";

describe("score preview notation model", () => {
  it("keeps the fixed SATB staff mapping regardless of pitch", () => {
    expect(SCORE_VOICE_LAYOUT).toEqual({
      soprano: { voiceId: "soprano", staff: "treble", stemDirection: "up" },
      alto: { voiceId: "alto", staff: "treble", stemDirection: "down" },
      tenor: { voiceId: "tenor", staff: "bass", stemDirection: "up" },
      bass: { voiceId: "bass", staff: "bass", stemDirection: "down" },
    });
  });

  it("fills rests and preserves written pitch and source ids", () => {
    const project = createEmptyProject();
    const note = {
      id: "s-1",
      startTick: 960,
      durationTicks: 960,
      pitch: { step: "D" as const, alter: 1 as const, octave: 6 },
      velocity: 90,
      locked: false,
      spellingSource: "manual" as const,
    };
    const result = addNote(project, "soprano", note);
    expect(result.error).toBeUndefined();
    const model = buildScorePreviewModel(result.project, { revision: 7 });
    const voice = model.measures[0].voices.soprano;
    expect(model.revision).toBe(7);
    expect(voice.events[0].kind).toBe("rest");
    const renderedNote = voice.events.find((event) => event.kind === "note");
    expect(renderedNote).toMatchObject({
      sourceNoteId: "s-1",
      pitch: { step: "D", alter: 1, octave: 6 },
      fromTick: 960,
      toTick: 1920,
    });
    expect(voice.totalTicks).toBe(model.measures[0].toTick - model.measures[0].fromTick);
  });

  it("splits a note at measure boundaries and marks ties", () => {
    const project = createEmptyProject();
    const note = {
      id: "a-long",
      startTick: 0,
      durationTicks: 5 * 4 * 960,
      pitch: { step: "C" as const, alter: 0 as const, octave: 4 },
      velocity: 90,
      locked: false,
      spellingSource: "manual" as const,
    };
    const result = addNote(project, "alto", note);
    expect(result.error).toBeUndefined();
    const model = buildScorePreviewModel(result.project);
    const pieces = model.measures.flatMap((measure) =>
      measure.voices.alto.events.filter((event) => event.kind === "note"),
    );
    expect(pieces).toHaveLength(5);
    expect(pieces[0]).toMatchObject({ tieFromPrevious: false, tieToNext: true });
    expect(pieces[1]).toMatchObject({ tieFromPrevious: true, tieToNext: true });
    expect(pieces.at(-1)).toMatchObject({ tieFromPrevious: true, tieToNext: false });
    expect(new Set(pieces.map((piece) => piece.sourceNoteId))).toEqual(new Set(["a-long"]));
  });

  it("reports non-grid rhythm without rounding it", () => {
    const project = createEmptyProject();
    const note = {
      id: "odd",
      startTick: 0,
      durationTicks: 61,
      pitch: { step: "C" as const, alter: 0 as const, octave: 4 },
      velocity: 90,
      locked: false,
      spellingSource: "manual" as const,
    };
    const result = addNote(project, "bass", note);
    expect(result.error).toBeUndefined();
    const model = buildScorePreviewModel(result.project);
    expect(model.warnings.some((item) => item.code === "unsupported-rhythm")).toBe(true);
    expect(model.measures[0].voices.bass.events.some((event) => event.kind === "unsupported")).toBe(true);
    expect(decomposeDuration(project.ppq, 61)).toBeUndefined();
  });

  it("reports auxiliary tracks instead of mixing them into SATB", () => {
    const project = createEmptyProject();
    project.auxiliaryTracks.push({
      id: "aux-1",
      kind: "auxiliary",
      role: "reference",
      name: "参考",
      shortName: "Ref",
      notes: [],
      participatesInHarmony: false,
      monophonic: false,
      visible: true,
      muted: false,
      solo: false,
      locked: false,
      volume: 1,
      pan: 0,
      program: 0,
    });
    const model = buildScorePreviewModel(project);
    expect(model.omittedAuxiliaryTrackCount).toBe(1);
    expect(model.warnings.at(-1)?.code).toBe("omitted-auxiliary");
  });

  it("generates valid VexFlow key signature specs for major and minor keys", () => {
    const project = createEmptyProject();
    project.keyEvents = [
      { id: "key-f-minor", tick: 0, tonic: { step: "F", alter: 0 }, mode: "minor" },
    ];
    const fMinorModel = buildScorePreviewModel(project);
    expect(fMinorModel.measures[0].keySignature).toBe("Fm");

    project.keyEvents = [
      { id: "key-c-sharp-minor", tick: 0, tonic: { step: "C", alter: 1 }, mode: "minor" },
    ];
    const cSharpMinorModel = buildScorePreviewModel(project);
    expect(cSharpMinorModel.measures[0].keySignature).toBe("C#m");

    project.keyEvents = [
      { id: "key-e-flat-major", tick: 0, tonic: { step: "E", alter: -1 }, mode: "major" },
    ];
    const eFlatMajorModel = buildScorePreviewModel(project);
    expect(eFlatMajorModel.measures[0].keySignature).toBe("Eb");
  });
});
