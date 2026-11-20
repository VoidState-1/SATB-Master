import type { ProjectSnapshot } from "../analysis";
import { analyzePhrases } from "../phrase/analyze";
import { buildHarmonySpans, buildSlices } from "../segments";

export function cadenceInputs(project: ProjectSnapshot) {
  const phraseAnalysis = analyzePhrases(project, { generateCandidates: false });
  const { slices, notesByVoice } = buildSlices(project);
  const { harmonySpans, sliceSpanIds, chordSpanIds } = buildHarmonySpans(slices);
  const chordById = new Map(project.chordTrack.regions.map(chord => [chord.id, chord] as const));
  return {
    project, phraseSegments: phraseAnalysis.segments, phraseAnalysis, slices, notesByVoice,
    harmonySpans, sliceSpanIds, chordSpanIds, chordById,
  };
}
