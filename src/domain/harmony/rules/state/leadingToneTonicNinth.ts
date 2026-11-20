import { chordToneSpellings } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval } from "../../../pitch";
import { VOICE_ORDER } from "../../../project";
import { allowsWrittenTertianIdentity, matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import type { ObligationEnvironment } from "./obligation";
import type { LeadingTonePayload } from "./tendency";
import { allowsWrittenLocalRole } from "./writtenLocalRole";

/** Spasobin §§36.3, 44.4–7 and Huang II, p. 299: a dominant member in
 * another part can prepare the accented upper neighbor of the tonic. */
export function leadingToneReachesTonicThroughNinth(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context: { previous, slice, rules, transitionFromPrevious }, obligation: { payload, openedAt } } = environment;
  if (payload.voiceId !== "soprano" || !previous?.completeSatb || !slice.completeSatb ||
      !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey) return;
  const lead = previous.notes.soprano!, ninth = slice.notes.soprano!, bass = slice.notes.bass!;
  const { targetStep, targetAlter, targetMode } = payload;
  const tonic = { step: targetStep, alter: targetAlter };
  const target = { tonic, mode: targetMode };
  const dominant = scaleDegreePitchClass(target, 5);
  const leading = { step: payload.leadingStep, alter: payload.leadingAlter };
  const ascent = writtenInterval(lead.pitch, ninth.pitch);
  if (!pitchClassEquals(lead.pitch, leading) || toMidi(lead.pitch) !== payload.leadingMidi ||
      lead.startTick + lead.durationTicks !== slice.tick || ninth.startTick !== slice.tick ||
      (ninth.nonChordToneRole && ninth.nonChordToneRole !== "appoggiatura" && ninth.nonChordToneRole !== "suspension") ||
      ascent.diatonicSteps !== 2 || ascent.semitones !== 3 ||
      !matchesWrittenChord(previous, dominant, "dominant7") || !allowsWrittenLocalRole(rules, previous, target, 5)) return;
  const [root, , preparedNinth, seventh] = chordToneSpellings(dominant, "dominant7");
  if (!pitchClassEquals(ninth.pitch, preparedNinth) || !pitchClassEquals(bass.pitch, tonic) ||
      bass.startTick !== slice.tick || writtenInterval(bass.pitch, ninth.pitch).diatonicSteps < 8) return;

  const resolutionTick = ninth.startTick + ninth.durationTicks;
  const settled = rules.sliceAt(resolutionTick);
  if (!settled || settled.tick !== resolutionTick || !keyEquals(settled.key, slice.key) ||
      crossesManualPhraseBoundary(rules, openedAt.tick, settled.tick) ||
      !matchesWrittenChord(settled, tonic, targetMode) || !allowsWrittenLocalRole(rules, settled, target, 1) ||
      !spelledPitchEquals(bass.pitch, settled.notes.bass!.pitch) ||
      !resolvesInVoice(slice, settled, "soprano", tonic, -1)) return;
  const accent = rules.metric.positionAt(slice.tick), release = rules.metric.positionAt(settled.tick);
  if (accent?.confidence !== "certain" || release?.confidence !== "certain" ||
      accent.level < 2 || release.level >= accent.level) return;

  // V7 is complete, so its fifth (the coming ninth) already sounds in another
  // part. On I, its bass and fifth anchor the harmony while the soprano resolves.
  const fifthVoice = pitchClassEquals(slice.notes.alto!.pitch, root) ? "alto" : "tenor";
  const fifth = slice.notes[fifthVoice]!;
  if (!pitchClassEquals(fifth.pitch, root) || !spelledPitchEquals(fifth.pitch, settled.notes[fifthVoice]!.pitch)) return;
  const thirdVoice = fifthVoice === "alto" ? "tenor" : "alto";
  const before = previous.notes[thirdVoice]!, overTonic = slice.notes[thirdVoice]!;
  const [, tonicThird] = chordToneSpellings(tonic, targetMode);
  if (!pitchClassEquals(before.pitch, seventh)) return;

  // The seventh can resolve at the bass arrival or participate in a separate 4–3.
  const directThird = spelledPitchEquals(overTonic.pitch, settled.notes[thirdVoice]!.pitch) &&
    resolvesInVoice(previous, slice, thirdVoice, tonicThird, -1);
  const departure = rules.sliceAt(settled.tick - 1)!;
  const delayedThird = spelledPitchEquals(before.pitch, overTonic.pitch) &&
    resolvesInVoice(departure, settled, thirdVoice, tonicThird, -1);
  if (!directThird && !delayedThird) return;

  const underNinth = rules.slices({ overlapping: { fromTick: slice.tick, toTick: settled.tick } });
  if (!underNinth.all(frame => {
    if (!frame.completeSatb || !keyEquals(frame.key, slice.key) || frame.notes.soprano!.id !== ninth.id ||
        !allowsWrittenTertianIdentity(frame, tonic, targetMode) || !allowsWrittenLocalRole(rules, frame, target, 1)) return false;
    const thirdRole = frame.notes[thirdVoice]!.nonChordToneRole;
    return !frame.notes.bass!.nonChordToneRole && !frame.notes[fifthVoice]!.nonChordToneRole &&
      (!thirdRole || (delayedThird && thirdRole === "suspension")) &&
      VOICE_ORDER.every(voice => spelledPitchEquals(frame.notes[voice]!.pitch, slice.notes[voice]!.pitch));
  })) return;
  return settled.notes.soprano;
}
