import { createChordRegion } from "../../../chords";
import { checkHarmony } from "../../registry";
import {
  createEmptyProject,
  PPQ,
  type ChordRegion,
  type NoteEvent,
  type ProjectDocument,
  type VoiceId,
} from "../../../project";
import type { SpelledPitch } from "../../../pitch";

export function note(id: string, startTick: number, pitch: SpelledPitch): NoteEvent {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    pitch,
    velocity: 88,
    locked: false,
    spellingSource: "manual",
  };
}

export function setLine(
  project: ProjectDocument,
  voiceId: VoiceId,
  pitches: readonly SpelledPitch[],
) {
  project.satbTracks.find((track) => track.id === voiceId)!.notes = pitches.map(
    (pitch, index) => note(`${voiceId}-${index}`, index * PPQ, pitch),
  );
}

export function pitch(step: SpelledPitch["step"], alter: -1 | 0 | 1, octave: number) {
  return { step, alter, octave } satisfies SpelledPitch;
}

export function diagnosticFor(project: ProjectDocument, ruleId: string) {
  return checkHarmony(project).diagnostics.find(
    (diagnostic) => diagnostic.ruleId === ruleId,
  );
}

export function dominantNinthRegion(): ChordRegion {
  return {
    id: "dominant-ninth",
    startTick: 0,
    durationTicks: PPQ,
    identity: {
      root: { step: "G", alter: 0 },
      bass: { step: "G", alter: 0 },
      structure: {
        kind: "tertian",
        quality: "dominant7",
        extensions: [9],
        alterations: [],
      },
    },
    locked: false,
  };
}

export function dominantNinthProject(pitchesByVoice: Record<VoiceId, SpelledPitch>) {
  const project = createEmptyProject();
  project.lengthTicks = PPQ;
  project.chordTrack.regions = [dominantNinthRegion()];
  for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const)
    setLine(project, voiceId, [pitchesByVoice[voiceId]]);
  return project;
}

export function triadRegion(
  id: string,
  startTick: number,
  root: SpelledPitch["step"],
  quality: "major" | "minor",
): ChordRegion {
  return {
    id,
    startTick,
    durationTicks: PPQ,
    identity: {
      root: { step: root, alter: 0 },
      bass: { step: root, alter: 0 },
      structure: {
        kind: "tertian",
        quality,
        extensions: [],
        alterations: [],
      },
    },
    locked: false,
  };
}

export function twoChordProject(
  first: ChordRegion,
  second: ChordRegion,
  lines: Record<VoiceId, readonly SpelledPitch[]>,
) {
  const project = createEmptyProject();
  project.lengthTicks = PPQ * 2;
  project.chordTrack.regions = [first, second];
  for (const voiceId of ["soprano", "alto", "tenor", "bass"] as const)
    setLine(project, voiceId, lines[voiceId]);
  return project;
}

export function functionalChord(
  project: ProjectDocument,
  id: string,
  index: number,
  draft: Parameters<typeof createChordRegion>[3],
) {
  return createChordRegion(project, index * PPQ, PPQ, draft, id);
}

export const manualCertain = {
  source: "manual",
  confidence: "certain",
} as const;
