import { pitchClassEquals, scaleDegreePitchClass, type KeyLike } from "../../../pitch";
import { resolvesDoubleAugmentedFourThree } from "../../doubleAugmentedFourThree";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { ConnectionView } from "../context/views";
import { activeNotes } from "../helpers/core";

/** Spasobin §§36–37: two prepared upward suspensions over the new K46 bass.
 * Verify the actual same-voice releases inside the already identified K46. */
export function resolvesPreparedDoubleAugmentedFourThree(
  context: HarmonyRuleContext,
  { source, sourceBoundary: before, targetBoundary: entry, target }: ConnectionView,
  key: KeyLike,
): boolean {
  const chord = entry.chord;
  const bass = entry.notes.bass;
  if (!chord || !bass || bass.startTick !== entry.tick) return false;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== 1 ||
      reading.value.degreeAlteration !== 0 || reading.value.appliedTarget) return false;
  const designation = reading.value.designation;
  if (designation && designation.kind !== "cadential64" &&
      (designation.kind !== "primary" || designation.primaryFunction !== "tonic")) return false;

  const raised = [scaleDegreePitchClass(key, 2, 1), scaleDegreePitchClass(key, 4, 1)];
  const held = activeNotes(before).filter(({ voiceId, note }) =>
    voiceId !== "bass" && raised.some(tone => pitchClassEquals(note.pitch, tone)));
  if (held.length !== 2) return false;
  const releaseTick = held[0].note.startTick + held[0].note.durationTicks;
  if (releaseTick <= entry.tick || releaseTick >= target.span.toTick ||
      held.some(({ voiceId, note }) => entry.notes[voiceId]?.id !== note.id ||
        note.startTick + note.durationTicks !== releaseTick)) return false;
  const landing = context.sliceAt(releaseTick);
  if (!landing?.completeSatb || landing.chord?.id !== chord.id || landing.notes.bass?.id !== bass.id ||
      held.some(({ voiceId }) => landing.notes[voiceId]?.startTick !== releaseTick)) return false;

  const accent = context.metric.positionAt(entry.tick);
  const weak = context.metric.positionAt(releaseTick);
  if (!accent || !weak || accent.measureNumber !== weak.measureNumber ||
      weak.beatPosition - accent.beatPosition > 1 || context.metric.compare(accent, weak) !== "stronger" ||
      context.analysis.phraseBoundaries.some(mark =>
        mark.source === "manual" && source.span.fromTick < mark.tick && mark.tick <= releaseTick)) return false;

  const common = activeNotes(before).find(({ voiceId, note }) =>
    voiceId !== "bass" && pitchClassEquals(note.pitch, key.tonic));
  if (!common || common.note.id !== landing.notes[common.voiceId]?.id) return false;
  if (context.slices({ overlapping: { fromTick: entry.tick, toTick: releaseTick } }).any(slice =>
    slice.chord?.id !== chord.id || slice.key.id !== before.key.id)) return false;

  return landing.key.id === before.key.id &&
    resolvesDoubleAugmentedFourThree(before.notes, landing.notes, key);
}
