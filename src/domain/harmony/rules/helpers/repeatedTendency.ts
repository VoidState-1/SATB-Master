import { chordIdentityEquals, chordIdentityToneSpellings } from "../../../chordModel";
import { pitchClassEquals, type SpelledPitchClass } from "../../../pitch";
import type { AnalysisSlice } from "../../analysis";
import { sameFunctionalReading } from "../../facts/functionalContext";
import { soundsDeclaredChord } from "../../facts/writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes, crossesManualPhraseBoundary } from "./core";
import type { ChordSliceFact } from "./chordVoicing";
import { isVerifiedChordOrnament, isVerifiedOrnamentalBass, readUnmarkedOrnament, resolvePassingChain } from "./ornaments";

// Inference can leave several successive rest slices unlabelled. Require
// the same complete harmony on both sides and an unchanged supporting voice
// through the gap. The two real labels remain available as evidence.
function bracketedPartialVoicings(context: HarmonyRuleContext, left: AnalysisSlice, right: AnalysisSlice,
  gap: readonly AnalysisSlice[]): ChordSliceFact[] {
  const chord = left.chord;
  if (!chord || !right.chord || left.key.id !== right.key.id ||
      crossesManualPhraseBoundary(context, left.tick, right.tick) ||
      !chordIdentityEquals(chord.identity, right.chord.identity) || !soundsDeclaredChord(left) || !soundsDeclaredChord(right)) return [];
  const first = context.harmony.primaryInterpretation(chord), last = context.harmony.primaryInterpretation(right.chord);
  if (first.status !== "resolved" || last.status !== "resolved" || !sameFunctionalReading(first.value, last.value) ||
      chord.semantics?.cadenceRole !== right.chord.semantics?.cadenceRole ||
      chord.semantics?.pedalContext || right.chord.semantics?.pedalContext) return [];
  const tones = chordIdentityToneSpellings(chord.identity);
  const anchored = activeNotes(left).some(({ note, voiceId }) => context.pitch.sameWrittenPitch(note, right.notes[voiceId]!) &&
    gap.every(s => s.notes[voiceId] && context.pitch.sameWrittenPitch(note, s.notes[voiceId]!)));
  if (!anchored) return [];
  const facts = gap.map(slice => ({ slice, chord, supportingChord: right.chord, tones, active: activeNotes(slice), stableComplete: false }));
  return facts.every(({ slice, active }) => active.length >= 2 && active.every(({ note }) => !note.nonChordToneRole &&
    tones.some(t => pitchClassEquals(t, note.pitch))) && (!slice.notes.bass || pitchClassEquals(slice.notes.bass.pitch, chord.identity.bass)))
    ? facts : [];
}

export function partialTendencyVoicings(context: HarmonyRuleContext): ChordSliceFact[] {
  const facts: ChordSliceFact[] = [];
  let previous: AnalysisSlice | undefined;
  let gap: AnalysisSlice[] = [];
  for (const slice of context.slices()) {
    if (!slice.chord && !slice.completeSatb) {
      gap.push(slice);
      continue;
    }
    if (gap.length && previous) facts.push(...bracketedPartialVoicings(context, previous, slice, gap));
    previous = slice;
    gap = [];
  }
  return facts;
}

/** A collision belongs to the sounding voices, even during a partial voicing. */
export function repeatedStructuralTone(context: HarmonyRuleContext, fact: ChordSliceFact, tone: SpelledPitchClass) {
  const sounding = fact.active.filter(({ note }) => pitchClassEquals(note.pitch, tone));
  if (sounding.length < 2) return [];
  return sounding.filter(item => {
    const { slice, chord, structural } = fact;
    return !structural?.voices.some(part => part.voice === item.voiceId && part.ornament) &&
      !(item.note.nonChordToneRole === "passing" && resolvePassingChain(context, item)) &&
      !isVerifiedChordOrnament(context, chord, item) &&
      !readUnmarkedOrnament(context, slice, item.voiceId, item.note) &&
      !(item.voiceId === "bass" && isVerifiedOrnamentalBass(context, slice, chord, item.note));
  });
}
