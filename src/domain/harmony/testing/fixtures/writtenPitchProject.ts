import { HARMONY_PHASE_B_GOLDEN } from "../../../fixtures/harmonyPhaseB.v1";
import { functionalTargetForDegree } from "../../../chordModel";
import {
  PPQ,
  type ChordIdentity,
  type ChordQuality,
  type ChordRegion,
  type HarmonySemantics,
  type NoteEvent,
  type ProjectDocument,
  type SpelledPitch,
  type SpelledPitchClass,
  type VoiceId,
} from "../../../project";

export function note(
  id: string,
  startTick: number,
  durationTicks: number,
  pitch: SpelledPitch,
): NoteEvent {
  return {
    id,
    startTick,
    durationTicks,
    pitch: { ...pitch },
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

export function setNotes(
  project: ProjectDocument,
  voiceId: VoiceId,
  notes: NoteEvent[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = notes;
}

export function tertianIdentity(
  root: SpelledPitchClass,
  quality: ChordQuality,
  bass: SpelledPitchClass,
): ChordIdentity {
  return {
    root,
    structure: { kind: "tertian", quality, extensions: [], alterations: [] },
    bass,
  };
}

export function semantics(
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  options: {
    degreeAlteration?: -2 | -1 | 0 | 1 | 2;
    appliedTarget?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    cadenceRole?: HarmonySemantics["cadenceRole"];
  } = {},
): HarmonySemantics {
  return {
    interpretations: [
      {
        id: "primary",
        degree,
        degreeAlteration: options.degreeAlteration ?? 0,
        appliedTarget: options.appliedTarget
          ? functionalTargetForDegree(options.appliedTarget)
          : undefined,
        source: "manual",
        confidence: "certain",
      },
    ],
    primaryInterpretationId: "primary",
    cadenceRole: options.cadenceRole,
  };
}

export function fSharpMajorRegion(functionAnalysis = false): ChordRegion {
  return {
    id: "f-sharp-major",
    startTick: 0,
    durationTicks: PPQ,
    identity: tertianIdentity(
      { ...HARMONY_PHASE_B_GOLDEN.enharmonicChordTone.chordRoot },
      "major",
      { step: "F", alter: 1 },
    ),
    semantics: functionAnalysis
      ? semantics(4, { degreeAlteration: 1 })
      : undefined,
    locked: false,
  };
}
