import { pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../../../pitch";
import { VOICE_ORDER } from "../../../project/voice";
import type { SliceTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { VoicePairTransitionFact } from "../sharedFacts";

/** Spasobin §30, examples 458–459. The German sixth and dominant triad
 * can have descending parallel fifths between the bass and an inner voice. */
export function isMozartFifth(
  context: HarmonyRuleContext, { previous, current, contiguous, sameKey }: SliceTransition,
  pair: VoicePairTransitionFact,
) {
  const [inner, lower] = pair.voiceIds;
  if (lower !== "bass" || (inner !== "tenor" && inner !== "alto") ||
      !contiguous || !sameKey || !previous.completeSatb || !current.completeSatb) return false;

  const source = previous.chord;
  const target = current.chord;
  const before = source && context.harmony.primaryInterpretation(source);
  const after = target && context.harmony.primaryInterpretation(target);
  if (before?.status === "ambiguous" || after?.status === "ambiguous") return false;
  const sourceKey = (before?.status === "resolved" && before.value.localKey) || previous.key;
  const targetKey = (after?.status === "resolved" && after.value.localKey) || current.key;
  if (sourceKey.mode !== targetKey.mode || !pitchClassEquals(sourceKey.tonic, targetKey.tonic)) return false;

  // These spellings are the same in major and its parallel minor.
  const minor = { tonic: sourceKey.tonic, mode: "minor" } as const;
  const low = scaleDegreePitchClass(minor, 6);
  const fifth = scaleDegreePitchClass(minor, 3);
  const high = scaleDegreePitchClass(minor, 4, 1);
  const dominant = scaleDegreePitchClass(minor, 5);
  if (source && (source.identity.structure.kind !== "augmented-sixth" ||
      source.identity.structure.variant !== "german" || !pitchClassEquals(source.identity.root, low) ||
      !pitchClassEquals(source.identity.bass, low))) return false;
  if (target && (target.identity.structure.kind !== "tertian" || target.identity.structure.quality !== "major" ||
      target.identity.structure.extensions.length || target.identity.structure.alterations.length ||
      !pitchClassEquals(target.identity.root, dominant) || !pitchClassEquals(target.identity.bass, dominant))) return false;
  if (after?.status === "resolved" && (after.value.appliedTarget || after.value.degree !== 5 ||
      after.value.degreeAlteration !== 0)) return false;

  if (!pitchClassEquals(previous.notes.bass!.pitch, low) ||
      !pitchClassEquals(previous.notes[inner]!.pitch, fifth)) return false;
  const sourceNotes = VOICE_ORDER.map(voice => previous.notes[voice]!);
  if (![minor.tonic, high].every(tone => sourceNotes.some(note => pitchClassEquals(note.pitch, tone))))
    return false;

  // All four voices move by a written semitone. Only the raised fourth
  // ascends. This also verifies both augmented-sixth endpoints in register.
  return VOICE_ORDER.every(voice => {
    const departure = previous.notes[voice]!;
    const arrival = current.notes[voice]!;
    const step = pitchClassEquals(departure.pitch, high) ? 1 : -1;
    const motion = writtenInterval(departure.pitch, arrival.pitch);
    return !departure.nonChordToneRole && !arrival.nonChordToneRole &&
      motion.diatonicSteps === step && motion.semitones === step;
  });
}
