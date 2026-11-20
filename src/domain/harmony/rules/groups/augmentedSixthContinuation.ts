import { chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals, scaleDegreePitchClass, writtenInterval, type KeyLike } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";

// Spasobin §30, example 460. The fifth can descend a semitone while
// the written augmented-sixth endpoints continue through the French voicing.
export function isGermanToFrenchVoicing(
  context: HarmonyRuleContext, before: AnalysisSlice, after: AnalysisSlice, key: KeyLike,
) {
  if (!before.completeSatb || !after.completeSatb) return false;
  const german = before.chord?.identity;
  const french = after.chord?.identity;
  if (german?.structure.kind !== "augmented-sixth" || german.structure.variant !== "german" ||
      french?.structure.kind !== "augmented-sixth" || french.structure.variant !== "french" ||
      before.endTick !== after.tick || before.key.id !== after.key.id ||
      context.phraseAt(before.tick)?.id !== context.phraseAt(after.tick)?.id) return false;

  const low = scaleDegreePitchClass({ ...key, mode: "minor" }, 6);
  if (![german.root, german.bass, french.root, french.bass, before.notes.bass!.pitch]
      .every(pitch => pitchClassEquals(pitch, low))) return false;
  const reading = context.harmony.primaryInterpretation(after.chord!);
  const sourceReading = context.harmony.primaryInterpretation(before.chord!);
  if (reading.status === "ambiguous" || sourceReading.status === "ambiguous") return false;
  const targetKey = (reading.status === "resolved" && reading.value.localKey) || after.key;
  if (!pitchClassEquals(targetKey.tonic, key.tonic) || targetKey.mode !== key.mode) return false;

  const tones = chordIdentityToneSpellings(german);
  const notes = activeNotes(before);
  if (!tones.every(tone => notes.some(({ note }) => pitchClassEquals(tone, note.pitch)))) return false;
  const frenchFourth = chordIdentityToneSpellings(french)[2];
  const retained = notes.every(({ voiceId, note }) => {
    const next = after.notes[voiceId]!;
    if (note.nonChordToneRole || next.nonChordToneRole) return false;
    if (!pitchClassEquals(note.pitch, tones[2])) return context.pitch.sameWrittenPitch(note, next);
    const descent = writtenInterval(note.pitch, next.pitch);
    return descent.diatonicSteps === -1 && descent.semitones === -1 &&
      pitchClassEquals(next.pitch, frenchFourth);
  });
  return retained;
}
