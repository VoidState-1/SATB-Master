import { chordToneSpellings } from "../../../chordModel";
import {
  keyEquals, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval,
  type SpelledPitchClass,
} from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import type { ObligationEnvironment } from "./obligation";
import type { LeadingTonePayload } from "./tendency";
import { allowsWrittenLocalRole } from "./writtenLocalRole";

function rootPositionMajorTriad(frame: AnalysisSlice, root: SpelledPitchClass) {
  const bass = frame.notes.bass;
  return !!bass && pitchClassEquals(bass.pitch, root) && matchesWrittenChord(frame, root, "major");
}

// Called only for complete written four-part voicings.
function upperVoiceSpan(frame: AnalysisSlice) {
  const top = toMidi(frame.notes.soprano!.pitch);
  const middle = toMidi(frame.notes.alto!.pitch);
  const bottom = toMidi(frame.notes.tenor!.pitch);
  if (bottom <= toMidi(frame.notes.bass!.pitch) || middle <= bottom || top <= middle ||
      middle - bottom > 12 || top - middle > 12) return 0;
  return top - bottom;
}

/** Spasobin §7.2, ex. 7-83: in an open-to-close V–I connection, the
 * tenor may leap from the dominant's third to the tonic's third. */
export function tenorLeapsToTonicThird(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context, obligation: { payload, openedAt } } = environment;
  const { previous, slice, rules, transitionFromPrevious } = context;
  if (payload.voiceId !== "tenor" || payload.targetMode !== "major" ||
      !previous || !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey) return false;

  const key = { tonic: { step: payload.targetStep, alter: payload.targetAlter }, mode: payload.targetMode };
  const dominant = scaleDegreePitchClass(key, 5);
  if (!rootPositionMajorTriad(previous, dominant) || !rootPositionMajorTriad(slice, key.tonic) ||
      !allowsWrittenLocalRole(rules, slice, key, 1)) return false;

  const before = previous.notes, after = slice.notes;
  const [, dominantThird, dominantFifth] = chordToneSpellings(dominant, "major");
  const tenor = before.tenor!.pitch, tonicThird = after.tenor!.pitch;
  const leap = writtenInterval(tenor, tonicThird);
  if (!pitchClassEquals(tenor, dominantThird) || toMidi(tenor) !== payload.leadingMidi ||
      !pitchClassEquals(tonicThird, scaleDegreePitchClass(key, 3)) ||
      leap.diatonicSteps !== 3 || leap.semitones !== 5) return false;

  const landingSpan = upperVoiceSpan(slice);
  const bassMove = writtenInterval(before.bass!.pitch, after.bass!.pitch);
  if (!pitchClassEquals(before.alto!.pitch, dominant) || !spelledPitchEquals(before.alto!.pitch, after.alto!.pitch) ||
      !pitchClassEquals(before.soprano!.pitch, dominantFifth) ||
      !resolvesInVoice(previous, slice, "soprano", key.tonic, -1) ||
      upperVoiceSpan(previous) <= 12 || landingSpan === 0 || landingSpan >= 12 ||
      !((bassMove.diatonicSteps === 3 && bassMove.semitones === 5) ||
        (bassMove.diatonicSteps === -4 && bassMove.semitones === -7)) ||
      crossesManualPhraseBoundary(rules, openedAt.tick, slice.tick)) return false;

  return rules.slices({ overlapping: { fromTick: openedAt.tick, toTick: slice.tick } }).all(frame => {
    const note = frame.notes.tenor;
    return !!note && spelledPitchEquals(note.pitch, tenor) && keyEquals(frame.key, slice.key) &&
      rootPositionMajorTriad(frame, dominant) && allowsWrittenLocalRole(rules, frame, key, 5);
  });
}
