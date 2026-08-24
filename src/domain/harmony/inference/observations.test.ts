import { describe, expect, it } from "vitest";
import { createEmptyProject, PPQ, type NoteEvent, type VoiceId } from "../../project";
import { spellMidi } from "../../pitch";
import { buildChordInferenceObservations } from "./observations";

function note(
  id: string,
  startTick: number,
  durationTicks: number,
  midiNote: number,
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: spellMidi(midiNote),
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

function addNote(
  project: ReturnType<typeof createEmptyProject>,
  voiceId: VoiceId,
  value: NoteEvent,
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes.push(value);
}

describe("和弦推导音符观察", () => {
  it("按音符边界建立观察，并忽略已有和弦边界", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 2;
    addNote(project, "soprano", note("s0", 0, PPQ * 2, 72));
    addNote(project, "alto", note("a0", 0, PPQ * 2, 67));
    addNote(project, "tenor", note("t0", 0, PPQ * 2, 64));
    addNote(project, "bass", note("b0", 0, PPQ, 48));
    addNote(project, "bass", note("b1", PPQ, PPQ, 55));
    project.chordTrack.regions.push({
      id: "stale-chord-boundary",
      startTick: PPQ / 2,
      durationTicks: PPQ / 2,
      identity: {
        root: { step: "C", alter: 0 },
        bass: { step: "C", alter: 0 },
        structure: {
          kind: "tertian",
          quality: "major",
          extensions: [],
          alterations: [],
        },
      },
      locked: false,
    });

    const observations = buildChordInferenceObservations(project);

    expect(observations.map((item) => [item.fromTick, item.toTick])).toEqual([
      [0, PPQ],
      [PPQ, PPQ * 2],
    ]);
    expect(observations[0].bass?.id).toBe("b0");
    expect(observations[1].bass?.id).toBe("b1");
    expect(observations[0].completeSatb).toBe(true);
    expect(observations[0].metric?.role).toBe("downbeat");
  });

  it("限制范围时只返回范围内的半开观察区间", () => {
    const project = createEmptyProject();
    project.lengthTicks = PPQ * 4;
    addNote(project, "soprano", note("s0", 0, PPQ * 4, 72));
    addNote(project, "alto", note("a0", 0, PPQ * 4, 67));
    addNote(project, "tenor", note("t0", 0, PPQ * 4, 64));
    addNote(project, "bass", note("b0", 0, PPQ * 4, 48));

    const observations = buildChordInferenceObservations(project, {
      fromTick: PPQ,
      toTick: PPQ * 3,
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      fromTick: PPQ,
      toTick: PPQ * 3,
    });
  });
});
