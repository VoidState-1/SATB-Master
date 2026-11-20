import { keyEquals, pitchClassEquals, scaleDegreePitchClass } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";
import { cadentialSixFourInKey, resolvesRaisedSecondApproach } from "./chromaticDoubleDominant";
import { resolvesPreparedDoubleAugmentedFourThree } from "./preparedDoubleAugmentedFourThree";

/** Both outside notes must be the prepared upper voices of the same K64 release. */
export function preparedCadentialPair(
  context: HarmonyRuleContext, slice: AnalysisSlice, outside: ReturnType<typeof activeNotes>,
) {
  if (outside.length !== 2 || !slice.chord || !slice.completeSatb) return false;
  const reading = context.harmony.primaryInterpretation(slice.chord);
  if (reading.status !== "resolved" || reading.value.degree !== 1 ||
      reading.value.degreeAlteration !== 0 || reading.value.appliedTarget) return false;
  const key = reading.value.localKey ?? slice.key;
  if (key.mode !== "major" || !cadentialSixFourInKey(context, slice, key)) return false;

  const span = context.spanAt(slice.tick);
  const link = span && context.spanNeighborhood(span).incoming;
  if (!link?.connection.contiguous || !link.connection.sameKey) return false;
  const { sourceBoundary: before, targetBoundary: entry } = link;
  const chord = before.chord;
  const bass = before.notes.bass;
  if (!chord || !bass || !before.completeSatb || entry.chord?.id !== slice.chord.id ||
      entry.notes.bass?.startTick !== entry.tick ||
      outside.some(({ voiceId, note }) => voiceId === "bass" ||
        before.notes[voiceId]?.id !== note.id || entry.notes[voiceId]?.id !== note.id)) return false;

  const source = context.harmony.primaryInterpretation(chord);
  if (source.status !== "resolved") return false;
  const sourceKey = source.value.localKey ?? before.key;
  if (!keyEquals(sourceKey, key)) return false;

  const release = outside[0].note.startTick + outside[0].note.durationTicks;
  if (context.analysis.phraseBoundaries.some(mark =>
    !mark.stale && link.source.span.fromTick < mark.tick && mark.tick <= release)) return false;
  const structure = chord.identity.structure;
  if (structure.kind === "augmented-sixth") {
    // A German label may conflict with written #II. The resolution proof
    // checks the actual spelling; the source voicing rule keeps its diagnosis.
    return (structure.variant === "doubleAugmented43" || structure.variant === "german") &&
      pitchClassEquals(chord.identity.root, bass.pitch) && pitchClassEquals(chord.identity.bass, bass.pitch) &&
      resolvesPreparedDoubleAugmentedFourThree(context, link, key);
  }

  if (structure.quality !== "diminished7") return false;
  const raised = outside.find(({ note }) => pitchClassEquals(note.pitch, scaleDegreePitchClass(key, 2, 1)));
  if (!raised) return false;
  const landing = context.sliceAt(release);
  if (!landing || landing.chord?.id !== slice.chord.id || slice.endTick > release ||
      outside.some(({ voiceId, note }) => note.startTick + note.durationTicks !== release ||
        landing.notes[voiceId]?.startTick !== release)) return false;
  // The common tonic can rearticulate with the arriving bass, but neither
  // supporting part changes again when the two suspensions release.
  if (activeNotes(entry).some(({ voiceId, note }) =>
    !outside.some(part => part.voiceId === voiceId) && landing.notes[voiceId]?.id !== note.id)) return false;
  const accent = context.metric.positionAt(entry.tick);
  const weak = context.metric.positionAt(release);
  if (!accent || !weak || accent.measureNumber !== weak.measureNumber ||
      weak.beatPosition - accent.beatPosition > 1 || context.metric.compare(accent, weak) !== "stronger") return false;
  return context.melodyTransitions({ voiceId: raised.voiceId }).any(motion =>
    motion.current.id === raised.note.id && resolvesRaisedSecondApproach(context, motion));
}
