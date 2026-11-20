import { chordIdentityToneSpellings } from "../../chordModel";
import { pitchClassEquals, toMidi, type SpelledPitchClass } from "../../pitch";
import type { AnalysisSlice } from "../analysis";
import type { CadenceSpanFacts } from "./types";

export function writtenAttack(facts: CadenceSpanFacts, required: readonly SpelledPitchClass[]) {
  const slice = facts.boundarySlice;
  const bass = slice?.notes.bass;
  const soprano = slice?.notes.soprano;
  if (!slice || !bass || !soprano || !facts.chord || slice.endTick !== facts.span.toTick ||
      !pitchClassEquals(bass.pitch, facts.chord.identity.bass)) return false;
  const tones = chordIdentityToneSpellings(facts.chord.identity);
  const notes = Object.values(slice.notes);
  return required.every(tone => notes.some(note => pitchClassEquals(note.pitch, tone))) &&
    notes.every(note => note.startTick === slice.tick && note.startTick + note.durationTicks === slice.endTick &&
      !note.nonChordToneRole && toMidi(note.pitch) >= toMidi(bass.pitch) && toMidi(note.pitch) <= toMidi(soprano.pitch) &&
      tones.some(tone => pitchClassEquals(tone, note.pitch)));
}

export function sameDetachedRhythm(
  pre: AnalysisSlice, attack: AnalysisSlice, arrival: AnalysisSlice, slices: readonly AnalysisSlice[], beatTicks: number,
) {
  if (attack.index !== pre.index + 2 || arrival.index !== attack.index + 2) return false;
  const firstRest = slices[pre.index + 1], secondRest = slices[attack.index + 1];
  const duration = attack.endTick - attack.tick, gap = arrival.tick - attack.endTick;
  return duration <= beatTicks && gap > 0 && gap <= beatTicks && pre.endTick - pre.tick === duration &&
    attack.tick - pre.endTick === gap && !firstRest.chord && !secondRest.chord &&
    Object.keys(firstRest.notes).length === 0 && Object.keys(secondRest.notes).length === 0 &&
    [pre, firstRest, attack, secondRest].every(slice => slice.key.id === arrival.key.id);
}
