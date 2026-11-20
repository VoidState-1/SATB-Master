import { sameChordIdentityWithoutBass, type AnalysisSlice } from "../../analysis";
import { pitchClassEquals, scaleDegreePitchClass, toMidi } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import type { RuleStepContext } from "../../runtime";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import { movesToWrittenTone } from "../../dominantSixthMotion";
import { writtenSeventhHandoff } from "../state/writtenSeventhHandoff";

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
  if (!previous?.chord || !slice.chord || !departure || !arrival ||
      toMidi(departure.pitch) !== seventhMidi || !sameChordIdentityWithoutBass(previous.chord.identity, slice.chord.identity) ||
      !pitchClassEquals(arrival.pitch, slice.chord.identity.root) ||
      !completeSupertonicSeventh(context, previous) || !completeSupertonicSeventh(context, slice) ||
      crossesManualPhraseBoundary(context.rules, openedTick, slice.tick)) return false;

  return receivers.some(receiver => {
    const handoff = writtenSeventhHandoff(context, voice, receiver, departure.pitch);
    return handoff && pitchClassEquals(handoff.partner.pitch, arrival.pitch) &&
      handoff.outgoing.diatonicSteps === 1 && handoff.outgoing.semitones === 2 &&
      handoff.incoming.diatonicSteps === -1 && handoff.incoming.semitones === -2;
  });
}

// Chapter 21 §§5–6. Cadential and passing tonic six-fours share the
// same written tones. Neither licenses this upward third in the seventh's voice.
export function seventhLeapsToUnlabelledSixFour(
  context: RuleStepContext, voice: VoiceId, openingNoteId: string | undefined, openedTick: number,
) {
  const { previous, slice, rules } = context;
  const bass = slice.notes.bass;
  if (slice.chord || !previous?.chord || !slice.completeSatb || !bass ||
      previous.key.id !== slice.key.id || slice.key.mode !== "major" ||
      previous.tick !== openedTick || previous.endTick !== slice.tick ||
      previous.chord.startTick + previous.chord.durationTicks !== slice.tick ||
      previous.notes[voice]?.id !== openingNoteId || previous.chord.semantics?.cadenceRole ||
      crossesManualPhraseBoundary(rules, openedTick, slice.endTick - 1) ||
      !completeSupertonicSeventh(context, previous)) return false;

  const { key } = slice;
  const dominant = scaleDegreePitchClass(key, 5);
  if (!pitchClassEquals(previous.chord.identity.root, scaleDegreePitchClass(key, 2)) ||
      !pitchClassEquals(previous.chord.identity.bass, scaleDegreePitchClass(key, 4)) ||
      !pitchClassEquals(bass.pitch, dominant)) return false;

  const duration = slice.endTick - slice.tick;
  const sourceDuration = previous.endTick - previous.tick;
  const stableForBeat = (at: number, length: number) => {
    const metric = rules.metric.positionAt(at);
    const measure = metric && context.analysis.metricTimeline.measures[metric.measureNumber - 1];
    return !!measure && length >= measure.beatLength;
  };
  if (!stableForBeat(previous.tick, sourceDuration) || !stableForBeat(slice.tick, duration)) return false;
  return rules.harmony.chordMembersAt(previous).every(({ voiceId, note, chordToneIndex }) => {
    const next = slice.notes[voiceId];
    if (!next || next.nonChordToneRole || note.startTick !== openedTick || note.durationTicks !== sourceDuration ||
        next.startTick !== slice.tick || next.durationTicks !== duration || toMidi(next.pitch) < toMidi(bass.pitch)) return false;
    switch (chordToneIndex) {
      case 0: return movesToWrittenTone(note.pitch, next.pitch, key.tonic, -1, -2);
      case 1: return voiceId === "bass" && movesToWrittenTone(note.pitch, next.pitch, dominant, 1, 2);
      case 2: return movesToWrittenTone(note.pitch, next.pitch, dominant, -1, -2);
      case 3: return voiceId === voice && movesToWrittenTone(note.pitch, next.pitch, scaleDegreePitchClass(key, 3), 2, 4);
      default: return false;
    }
  });
}
