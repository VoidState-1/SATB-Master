import {
  chordIdentityEquals,
  chordIdentityToneSpellingForDegree,
  chordVoicingPolicy,
  identityContainsWrittenPitchClass,
  isSeventhStructure,
} from "../../../chordModel";
import { keyEquals, pitchClassEquals, spelledPitchEquals, toMidi } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import type { RuleStepContext } from "../../runtime";
import { returnsByWrittenStep } from "../../writtenNeighbors";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import type { ObligationEnvironment } from "./obligation";
import type { SeventhPayload } from "./tendency";
import { supportsTendencyResolutionRules } from "./tendencyContext";

function soundsWrittenChordFrame(slice: AnalysisSlice, neighborNoteId?: string) {
  const identity = slice.chord?.identity;
  const bass = slice.notes.bass;
  if (!identity || !slice.completeSatb || !bass || !pitchClassEquals(bass.pitch, identity.bass)) return false;
  const notes = Object.values(slice.notes).filter(note => note.id !== neighborNoteId);
  return notes.every(note => !note.nonChordToneRole && toMidi(note.pitch) >= toMidi(bass.pitch) &&
    identityContainsWrittenPitchClass(identity, note.pitch)) &&
    chordVoicingPolicy(identity).requiredDegrees.every(degree => {
      const tone = chordIdentityToneSpellingForDegree(identity, degree);
      return tone && notes.some(note => pitchClassEquals(note.pitch, tone));
    });
}

/** A continuous voice can gain a seventh at an independently sounded harmonic entry. */
export function preparedSeventhEntries(context: RuleStepContext): VoiceId[] {
  const { previous, slice, transitionFromPrevious } = context;
  const prior = previous?.chord, chord = slice.chord;
  if (!previous || !prior || !chord || !isSeventhStructure(chord.identity.structure) ||
      !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey ||
      crossesManualPhraseBoundary(context.rules, previous.tick, slice.tick)) return [];

  const seventh = chordIdentityToneSpellingForDegree(chord.identity, 7);
  const priorSeventh = chordIdentityToneSpellingForDegree(prior.identity, 7);
  if (!seventh || (priorSeventh && pitchClassEquals(priorSeventh, seventh))) return [];
  const hasMotion = transitionFromPrevious.changedVoiceIds.some(voice => {
    const before = previous.notes[voice], after = slice.notes[voice];
    return before && after && !spelledPitchEquals(before.pitch, after.pitch);
  });
  if (!hasMotion || !supportsTendencyResolutionRules(context, prior) ||
      !soundsWrittenChordFrame(previous) || !soundsWrittenChordFrame(slice)) return [];
  return VOICE_ORDER.filter(voice => {
    const note = slice.notes[voice];
    return note && previous.notes[voice]?.id === note.id && pitchClassEquals(note.pitch, seventh);
  });
}

/** A weak upper neighbor over unchanged supporting voices leaves the same seventh pending. */
export function ornamentsPreparedSeventh(environment: ObligationEnvironment<SeventhPayload>) {
  const { context, obligation: { openedAt, payload } } = environment;
  const { rules, slice } = context;
  const voice = payload.voiceId;
  const neighbor = slice.notes[voice];
  if (!payload.preparedAtEntry || voice === "bass" || !neighbor ||
      toMidi(neighbor.pitch) <= payload.seventhMidi) return false;

  const start = neighbor.startTick, end = start + neighbor.durationTicks;
  const before = rules.sliceAt(start - 1), after = rules.sliceAt(end);
  const source = before?.notes[voice], returned = after?.notes[voice];
  if (!before?.chord || !after?.chord || !slice.chord || !source || !returned ||
      toMidi(source.pitch) !== payload.seventhMidi || !returnsByWrittenStep(source, neighbor, returned) ||
      !chordIdentityEquals(before.chord.identity, after.chord.identity) ||
      !supportsTendencyResolutionRules(context, after.chord)) return false;

  const seventh = chordIdentityToneSpellingForDegree(before.chord.identity, 7);
  const middle = slice.chord.identity;
  if (!seventh || !pitchClassEquals(source.pitch, seventh) || !pitchClassEquals(before.chord.identity.root, middle.root) ||
      middle.structure.kind !== "tertian" || middle.structure.extensions.length ||
      !["major", "minor", "diminished", "augmented"].includes(middle.structure.quality) ||
      !soundsWrittenChordFrame(before) || !soundsWrittenChordFrame(after) ||
      !VOICE_ORDER.every(other => other === voice || before.notes[other]?.id === after.notes[other]?.id)) return false;

  // A key restatement can split a held note. Compare the musical onsets and
  // check the intervening slices for real changes to the supporting voices.
  const preparation = Math.max(openedAt.tick, before.chord.startTick,
    ...Object.values(before.notes).map(note => note.startTick));
  if (rules.metric.compare(rules.metric.positionAt(start), rules.metric.positionAt(preparation)) !== "weaker" ||
      !keyEquals(before.key, after.key) || crossesManualPhraseBoundary(rules, preparation, end)) return false;

  const neighborId = neighbor.nonChordToneRole === "neighbor" ? neighbor.id : undefined;
  return rules.slices({ overlapping: { fromTick: preparation, toTick: end } }).all(frame => {
    if (!keyEquals(frame.key, before.key)) return false;
    if (frame.tick < start) return true;
    return !!frame.chord && chordIdentityEquals(frame.chord.identity, middle) &&
      supportsTendencyResolutionRules(context, frame.chord) &&
      soundsWrittenChordFrame(frame, neighborId) &&
      VOICE_ORDER.every(part => frame.notes[part]?.id === (part === voice ? neighbor.id : before.notes[part]?.id));
  });
}
