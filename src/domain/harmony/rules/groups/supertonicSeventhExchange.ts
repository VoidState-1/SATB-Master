import { sameChordIdentityWithoutBass, type AnalysisSlice } from "../../analysis";
import { pitchClassEquals, scaleDegreePitchClass, toMidi, writtenInterval } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import type { RuleStepContext } from "../../runtime";
import { crossesManualPhraseBoundary } from "./dominantSixthSubstitution";

function completeSupertonicSeventh(context: RuleStepContext, slice: AnalysisSlice) {
  const { chord, key, notes } = slice;
  if (!chord || !slice.completeSatb || !notes.bass || chord.semantics?.mixture || chord.semantics?.pedalContext)
    return false;
  const { identity } = chord;
  const { structure } = identity;
  if (structure.kind !== "tertian" || structure.quality !== "minor7" || structure.extensions.length ||
      structure.alterations.length || !pitchClassEquals(notes.bass.pitch, identity.bass)) return false;

  const reading = context.rules.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== 2 || reading.value.degreeAlteration !== 0 ||
      reading.value.appliedTarget) return false;
  const localKey = reading.value.localKey ?? key;
  if (localKey.mode !== "major" || !pitchClassEquals(identity.root, scaleDegreePitchClass(localKey, 2))) return false;
  const bassMidi = toMidi(notes.bass.pitch);
  const members = context.rules.harmony.chordMembersAt(slice);
  return members.every(member => member.isWrittenChordTone && !member.note.nonChordToneRole &&
    toMidi(member.note.pitch) >= bassMidi) && new Set(members.map(member => member.chordToneIndex)).size === 4;
}

/** The seventh rises to the root while that root steps down to take the seventh (chapter 21). */
export function exchangesSupertonicSeventhWithRoot(
  context: RuleStepContext,
  voice: VoiceId,
  seventhMidi: number,
  openedTick: number,
  receivers: readonly VoiceId[],
) {
  const { previous, slice } = context;
  const departure = previous?.notes[voice], arrival = slice.notes[voice];
  if (!previous?.chord || !slice.chord || !departure || !arrival || previous.key.id !== slice.key.id ||
      arrival.startTick !== slice.tick || departure.startTick + departure.durationTicks !== slice.tick ||
      toMidi(departure.pitch) !== seventhMidi || !sameChordIdentityWithoutBass(previous.chord.identity, slice.chord.identity) ||
      !pitchClassEquals(arrival.pitch, slice.chord.identity.root)) return false;
  const upward = writtenInterval(departure.pitch, arrival.pitch);
  if (upward.diatonicSteps !== 1 || upward.semitones !== 2 ||
      !completeSupertonicSeventh(context, previous) || !completeSupertonicSeventh(context, slice) ||
      crossesManualPhraseBoundary(context.rules, openedTick, slice.tick)) return false;

  return receivers.some(receiver => {
    const root = previous.notes[receiver], seventh = slice.notes[receiver];
    if (!root || !seventh || root.startTick + root.durationTicks !== slice.tick ||
        !pitchClassEquals(root.pitch, arrival.pitch) || !pitchClassEquals(seventh.pitch, departure.pitch)) return false;
    const downward = writtenInterval(root.pitch, seventh.pitch);
    return downward.diatonicSteps === -1 && downward.semitones === -2;
  });
}
