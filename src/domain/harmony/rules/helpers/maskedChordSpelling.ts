import {
  chordIdentityToneSpellings, chordToneSpellings, QUALITY_INTERVALS, type ChordQuality,
} from "../../../chordModel";
import {
  pitchClassEquals, pitchClassValue, spellPitchClassForStep, stepIndex, toMidi, type SpelledPitchClass,
} from "../../../pitch";
import { VOICE_ORDER, type VoiceId } from "../../../project";
import type { AnalysisSlice } from "../../analysis";
import { canOmitDominantFifth } from "../../writtenDominantSeventh";

export interface CompletedVoicing {
  root: SpelledPitchClass;
  quality: ChordQuality;
  member: SpelledPitchClass;
}

const letter = (index: number) => ((index % 7) + 7) % 7;

/** Each written root is derived from an unmasked member. The tested pitch supplies only sound. */
export function completeVoicings(
  slice: AnalysisSlice, masked: VoiceId, qualities: readonly ChordQuality[],
  { canSupplyMissingMember = true, allowOmittedDominantFifth = false }:
    { canSupplyMissingMember?: boolean; allowOmittedDominantFifth?: boolean } = {},
) {
  const note = slice.notes[masked], bass = slice.notes.bass;
  if (!slice.completeSatb || !note || !bass) return [];
  const peers = VOICE_ORDER.filter(voice => voice !== masked).map(voice => slice.notes[voice]!.pitch);
  const lowest = toMidi(bass.pitch);
  if (toMidi(note.pitch) < lowest || peers.some(pitch => toMidi(pitch) < lowest)) return [];

  const [anchor] = peers;
  const sound = pitchClassValue(note.pitch);
  const readings: CompletedVoicing[] = [];
  for (const quality of qualities) {
    for (const [index, interval] of QUALITY_INTERVALS[quality].entries()) {
      const rootLetter = letter(stepIndex(anchor.step) - 2 * index);
      const root = spellPitchClassForStep(pitchClassValue(anchor) - interval, rootLetter);
      if (stepIndex(root.step) !== rootLetter) continue;
      const tones = chordToneSpellings(root, quality);
      if (tones.some((tone, i) => stepIndex(tone.step) !== letter(rootLetter + 2 * i))) continue;
      const member = tones.find(tone => pitchClassValue(tone) === sound);
      if (!member || !peers.every(pitch => tones.some(tone => pitchClassEquals(pitch, tone)))) continue;
      const omitFifth = allowOmittedDominantFifth && quality === "dominant7" &&
        canOmitDominantFifth(root, masked === "bass" ? member : bass.pitch, [member, ...peers]);
      if (!tones.every((tone, index) => (index === 2 && omitFifth) ||
          (canSupplyMissingMember && pitchClassEquals(member, tone)) ||
          peers.some(pitch => pitchClassEquals(pitch, tone)))) continue;
      readings.push({ root, quality, member });
    }
  }
  return readings;
}

export function agreedMember(readings: readonly CompletedVoicing[]) {
  const first = readings[0]?.member;
  return first && readings.every(chord => pitchClassEquals(chord.member, first)) ? first : undefined;
}

export function agreesWithExplicitIdentity(
  frame: AnalysisSlice, masked: VoiceId, voicing: CompletedVoicing, trackLocked: boolean,
) {
  const chord = frame.chord;
  if (!chord) return true;
  // An absolute-only label has no provenance. Preserve a conflicting spelling
  // there just as on a locked track or an explicitly confirmed chord.
  const explicit = trackLocked || chord.locked || !chord.semantics || chord.semantics.interpretations.some(
    meaning => meaning.source === "manual" || meaning.source === "confirmed",
  );
  if (!explicit) return true;

  const bass = masked === "bass" ? voicing.member : frame.notes.bass!.pitch;
  if (!pitchClassEquals(chord.identity.root, voicing.root) || !pitchClassEquals(chord.identity.bass, bass)) return false;
  const declared = chordIdentityToneSpellings(chord.identity);
  const realized = chordToneSpellings(voicing.root, voicing.quality);
  return declared.length === realized.length &&
    realized.every(tone => declared.some(member => pitchClassEquals(tone, member)));
}
