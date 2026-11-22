import {
  createEmptyProject,
  PPQ,
  type ChordRegion,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../../../project";
import type { SpelledPitch } from "../../../pitch";

export function correctionProject(lengthTicks = PPQ * 4) {
  const project = createEmptyProject("规则引擎修正样本");
  project.lengthTicks = lengthTicks;
  project.loop.endTick = Math.min(project.loop.endTick, lengthTicks);
  return project;
}

export function correctionNote(
  id: string,
  startTick: number,
  pitch: SpelledPitch,
  durationTicks = PPQ,
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch,
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

export function setCorrectionVoice(
  project: ProjectDocument,
  voiceId: VoiceId,
  notes: readonly NoteEvent[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = [...notes];
}

export function correctionChord(
  id: string,
  startTick: number,
  durationTicks: number,
): ChordRegion {
  return {
    id,
    startTick,
    durationTicks,
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
    semantics: {
      interpretations: [
        {
          id: `${id}-tonic`,
          degree: 1,
          degreeAlteration: 0,
          source: "manual",
          confidence: "certain",
        },
      ],
      primaryInterpretationId: `${id}-tonic`,
    },
    locked: false,
  };
}
