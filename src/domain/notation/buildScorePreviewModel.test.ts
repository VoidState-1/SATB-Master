import { describe, expect, it } from "vitest";
import { addAuxiliaryTrack, addNote } from "../editing";
import { createEmptyProject, type AuxiliaryTrack, type NoteEvent } from "../project";
import { spellMidi } from "../pitch";
import { buildScorePreviewModel, SCORE_VOICE_LAYOUT } from "./buildScorePreviewModel";
import { decomposeDuration } from "./rhythm";

function auxiliaryNote(id: string, midi: number, startTick: number, durationTicks: number): NoteEvent {
  return {
    id, startTick, durationTicks, pitch: spellMidi(midi),
    velocity: 90, locked: false, spellingSource: "manual",
  };
}

function withAuxiliaryTracks(...tracks: Partial<AuxiliaryTrack>[]) {
  let project = createEmptyProject();
  for (const track of tracks) {
    project = addAuxiliaryTrack(project).project;
    Object.assign(project.auxiliaryTracks.at(-1)!, track);
  }
  return project;
}

describe("score preview notation model", () => {
  it("preserves the automatically spelled E sharp leading tone in F sharp minor", () => {
    const project = createEmptyProject();
    const key = {
      ...project.keyEvents[0],
      tonic: { step: "F" as const, alter: 1 as const },
      mode: "minor" as const,
    };
    project.keyEvents = [key];
    const result = addNote(project, "soprano", {
      id: "leading-e-sharp",
      startTick: 0,
      durationTicks: project.ppq,
      pitch: spellMidi(65, key),
      velocity: 88,
      locked: false,
      spellingSource: "manual",
    });
    expect(result.error).toBeUndefined();
    const measure = buildScorePreviewModel(result.project).measures[0];
    expect(measure.keySignature).toBe("F#m");
    expect(measure.voices.soprano.events[0]).toMatchObject({
      kind: "note",
      pitch: { step: "E", alter: 1, octave: 4 },
    });
  });

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

  it("reports hidden auxiliary tracks including legacy tracks without a preview flag", () => {
    const project = withAuxiliaryTracks(
      { showInScorePreview: false, notes: [auxiliaryNote("hidden", 72, 0, 960)] },
      { showInScorePreview: undefined },
    );
    const model = buildScorePreviewModel(project);
    expect(model.omittedAuxiliaryTrackCount).toBe(2);
    expect(model.omittedAuxiliaryNoteCount).toBe(1);
    expect(model.includedAuxiliaryTrackIds).toEqual([]);
    expect(model.measures[0].auxiliaryStaves).toEqual([]);
    expect(model.warnings.at(-1)?.code).toBe("omitted-auxiliary");
  });

  it("uses the project flags or an explicit allowlist in project order", () => {
    const project = withAuxiliaryTracks(
      { id: "high", name: "旋律", shortName: "Mel", color: "#123456", showInScorePreview: true,
        notes: [auxiliaryNote("high-note", 60, 0, 960), auxiliaryNote("low-outlier", 36, 3840, 960)] },
      { id: "low", notes: [auxiliaryNote("low-note", 59, 0, 960)] },
      { id: "empty" },
    );
    const defaults = buildScorePreviewModel(project);
    expect(defaults.includedAuxiliaryTrackIds).toEqual(["high"]);
    expect(defaults.omittedAuxiliaryNoteCount).toBe(1);
    const explicit = buildScorePreviewModel(project, { includedAuxiliaryTrackIds: ["empty", "low", "high", "missing", "low"] });
    expect(explicit.includedAuxiliaryTrackIds).toEqual(["high", "low", "empty"]);
    expect(explicit.omittedAuxiliaryTrackCount).toBe(0);
    expect(explicit.measures[0].auxiliaryStaves).toMatchObject([
      { trackId: "high", name: "旋律", shortName: "Mel", color: "#123456", clef: "treble" },
      { trackId: "low", clef: "bass" },
      { trackId: "empty", clef: "treble", lanes: [{
        laneIndex: 0, stemDirection: undefined, totalTicks: 3840, events: [{ kind: "rest", fromTick: 0, toTick: 3840 }],
      }] },
    ]);
    expect(explicit.measures[1].auxiliaryStaves[0].clef).toBe("treble");
    expect(buildScorePreviewModel(project, { includedAuxiliaryTrackIds: [] }).includedAuxiliaryTrackIds).toEqual([]);
  });

  it("groups identical spans by ascending MIDI pitch and fills staggered lanes to the barline", () => {
    const project = withAuxiliaryTracks({ showInScorePreview: true, notes: [
      auxiliaryNote("upper", 72, 0, 1920),
      auxiliaryNote("lower", 60, 0, 1920),
      auxiliaryNote("overlap", 64, 960, 1920),
      auxiliaryNote("later", 67, 1920, 960),
    ] });
    const measure = buildScorePreviewModel(project).measures[0];
    const { lanes } = measure.auxiliaryStaves[0];
    expect(lanes.map((lane) => lane.stemDirection)).toEqual(["up", "down"]);
    expect(lanes[0].events[0]).toMatchObject({
      kind: "chord", fromTick: 0, toTick: 1920,
      notes: [{ sourceNoteId: "lower" }, { sourceNoteId: "upper" }],
    });
    expect(lanes[0].events[1]).toMatchObject({ kind: "chord", notes: [{ sourceNoteId: "later" }] });
    expect(lanes[1].events[1]).toMatchObject({ kind: "chord", notes: [{ sourceNoteId: "overlap" }] });
    for (const lane of lanes) {
      expect(lane.totalTicks).toBe(measure.toTick - measure.fromTick);
      let tick = measure.fromTick;
      for (const event of lane.events) {
        expect(event.fromTick).toBe(tick);
        if (event.kind !== "unsupported") expect(event.duration.ticks).toBe(event.toTick - tick);
        tick = event.toTick;
      }
      expect(tick).toBe(measure.toTick);
    }
  });

  it("tracks ties per pitch across both duration splits and measure boundaries", () => {
    const project = withAuxiliaryTracks({ showInScorePreview: true, notes: [
      auxiliaryNote("split", 72, 0, 1200),
      auxiliaryNote("sustained", 67, 2880, 1920),
      auxiliaryNote("ending", 72, 2880, 960),
      auxiliaryNote("entering", 60, 3840, 960),
    ] });
    const [first, second] = buildScorePreviewModel(project).measures;
    const chords = first.auxiliaryStaves[0].lanes[0].events.filter((event) => event.kind === "chord");
    expect(chords.map((event) => event.notes)).toMatchObject([
      [{ sourceNoteId: "split", tieFromPrevious: false, tieToNext: true }],
      [{ sourceNoteId: "split", tieFromPrevious: true, tieToNext: false }],
      [
        { sourceNoteId: "sustained", tieFromPrevious: false, tieToNext: true },
        { sourceNoteId: "ending", tieFromPrevious: false, tieToNext: false },
      ],
    ]);
    expect(second.auxiliaryStaves[0].lanes[0].events[0]).toMatchObject({
      kind: "chord",
      notes: [
        { sourceNoteId: "entering", tieFromPrevious: false, tieToNext: false },
        { sourceNoteId: "sustained", tieFromPrevious: true, tieToNext: false },
      ],
    });
  });

  it("keeps unsupported spans exact and warns when all four lanes are occupied", () => {
    const project = withAuxiliaryTracks({ id: "crowded", showInScorePreview: true, notes: [
      auxiliaryNote("off-grid", 60, 0, 61),
      ...Array.from({ length: 5 }, (_, index) => auxiliaryNote(`layer-${index}`, 62 + index, 120 + index * 120, 960)),
    ] });
    const { measures, warnings } = buildScorePreviewModel(project);
    const { lanes } = measures[0].auxiliaryStaves[0];
    expect(lanes).toHaveLength(4);
    expect(lanes[0].events[0]).toMatchObject({ kind: "unsupported", fromTick: 0, toTick: 61 });
    expect(lanes.every(({ events }) => events.at(-1)?.toTick === 3840)).toBe(true);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported-rhythm", trackId: "crowded", sourceNoteId: "off-grid" }),
      expect.objectContaining({ code: "invalid-overlap", trackId: "crowded", sourceNoteId: "layer-4" }),
    ]));
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
