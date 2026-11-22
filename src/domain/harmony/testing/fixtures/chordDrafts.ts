import { createChordRegion } from "../../../chords";
import { createEmptyProject, PPQ, type ChordDraft } from "../../../project";

export type TestChordDraft = Omit<ChordDraft, "source" | "confidence"> & {
  source?: ChordDraft["source"];
  confidence?: ChordDraft["confidence"];
};

function testChordDraft(analysis: TestChordDraft): ChordDraft {
  return {
    ...analysis,
    source: analysis.source ?? "manual",
    confidence: analysis.confidence ?? "certain",
  };
}

export function chordRegion(
  project: ReturnType<typeof createEmptyProject>,
  id: string,
  startTick: number,
  durationTicks: number,
  analysis: TestChordDraft,
) {
  return createChordRegion(
    project,
    startTick,
    durationTicks,
    testChordDraft(analysis),
    id,
  );
}

export function addChord(
  project: ReturnType<typeof createEmptyProject>,
  id: string,
  index: number,
  analysis: TestChordDraft,
) {
  project.chordTrack.regions.push(
    chordRegion(project, id, index * PPQ, PPQ, analysis),
  );
}
