import { chordIdentityEquals, chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, type KeyLike } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import {
  verifyPreparedSuspensionVoicing,
  type PreparationSupport,
} from "../../preparedSuspensionVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";

function sameKey(left: KeyLike, right: KeyLike) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

function functionalKey(context: HarmonyRuleContext, slice: AnalysisSlice, degree: 1 | 5) {
  const chord = slice.chord;
  if (!chord || chord.semantics?.cadenceRole || chord.semantics?.pedalContext) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== degree ||
      reading.value.degreeAlteration !== 0 || reading.value.appliedTarget) return;
  const { designation, localKey } = reading.value;
  if (designation && (designation.kind !== "primary" ||
      designation.primaryFunction !== (degree === 1 ? "tonic" : "dominant"))) return;
  return localKey ?? slice.key;
}

function preparationSupport(
  context: HarmonyRuleContext,
  slice: AnalysisSlice,
  onset: AnalysisSlice,
  key: KeyLike,
): PreparationSupport {
  if (!slice.completeSatb || slice.key.id !== onset.key.id) return "blocked";
  const notes = activeNotes(slice);
  if (notes.some(({ note }) => note.nonChordToneRole)) return "blocked";
  const chord = slice.chord;
  if (!chord) return "surface";

  const localKey = functionalKey(context, slice, 5);
  const { identity } = chord;
  const { structure } = identity;
  if (!localKey || !sameKey(localKey, key) || structure.kind !== "tertian" ||
      structure.quality !== "dominant7" || structure.alterations.length || structure.extensions.length ||
      !pitchClassEquals(identity.root, scaleDegreePitchClass(key, 5)) ||
      !pitchClassEquals(slice.notes.bass!.pitch, identity.bass)) return "blocked";

  const tones = chordIdentityToneSpellings(identity);
  return tones.every(tone => notes.some(({ note }) => pitchClassEquals(note.pitch, tone)))
    ? "confirmed"
    : "surface";
}

/** Limit the score proof to the part of the note that is outside the
 * annotated tonic. The caller leaves all persisted roles untouched. */
export function heldSuspensionsAt(context: HarmonyRuleContext, slice: AnalysisSlice): readonly string[] {
  const { chord } = slice;
  const bass = slice.notes.bass;
  if (!chord || !bass || !slice.completeSatb) return [];
  const key = functionalKey(context, slice, 1);
  const { root, bass: writtenBass, structure } = chord.identity;
  if (!key || structure.kind !== "tertian" || structure.quality !== key.mode ||
      structure.alterations.length || structure.extensions.length ||
      !pitchClassEquals(root, key.tonic) || !pitchClassEquals(root, writtenBass)) return [];

  // Use the actual bass attack, since a label can divide a held voicing
  // into several slices without adding any musical attack.
  const onset = context.sliceAt(bass.startTick);
  if (!onset || onset.tick !== bass.startTick) return [];
  const isSameTonic = (part: AnalysisSlice) => {
    if (part.key.id !== onset.key.id || !part.chord ||
        !chordIdentityEquals(part.chord.identity, chord.identity)) return false;
    const localKey = functionalKey(context, part, 1);
    return localKey !== undefined && sameKey(localKey, key);
  };
  if (!isSameTonic(onset)) return [];
  const tones = chordIdentityToneSpellings(chord.identity);
  if (activeNotes(onset).some(({ note }) => note.nonChordToneRole || pitchClassEquals(note.pitch, tones[1])))
    return [];

  const beatTicks = context.analysis.project.ppq;
  const timeline = context.slices({ overlapping: {
    fromTick: Math.max(0, onset.tick - beatTicks - 1),
    toTick: onset.tick + beatTicks + 1,
  } }).toArray();
  const onsetIndex = timeline.findIndex(part => part.index === onset.index);
  const verified = verifyPreparedSuspensionVoicing({
    slices: timeline.map(part => ({ fromTick: part.tick, toTick: part.endTick, notes: part.notes })),
    onsetIndex,
    key,
    beatTicks,
    metricAt: context.metric.positionAt,
    preparationAt: index => preparationSupport(context, timeline[index], onset, key),
  });
  if (!verified || slice.tick < verified.fromTick || slice.endTick > verified.toTick) return [];

  const prep = timeline[verified.preparationIndex];
  const resolution = timeline[verified.resolutionIndex];
  if (context.analysis.phraseBoundaries.some(boundary =>
    !boundary.stale && prep.tick < boundary.tick && boundary.tick <= verified.toTick,
  ) || !timeline.slice(onsetIndex, verified.resolutionIndex + 1).every(isSameTonic)) return [];

  const resolvedNotes = activeNotes(resolution);
  if (!resolvedNotes.every(({ note }) => !note.nonChordToneRole &&
    context.harmony.isWrittenChordTone(note, chord),
  ) || !tones.every(tone => resolvedNotes.some(({ note }) => pitchClassEquals(note.pitch, tone)))) return [];

  return verified.motions.map(({ noteId }) => noteId);
}
