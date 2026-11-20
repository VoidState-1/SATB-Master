import { chordIdentityInversion, chordIdentityToneSpellings } from "../../chordModel";
import { pitchClassEquals, toMidi, type SpelledPitchClass } from "../../pitch";
import type { AnalysisSlice } from "../analysis";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";

function writtenAttack(facts: CadenceSpanFacts, required: readonly SpelledPitchClass[]) {
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

/** A rest between attacks can belong to an ongoing cadence when the written
 * predominant and dominant use the same detached rhythm through the final downbeat. */
export function detachedAuthenticEvidence(
  preparation: CadenceSpanFacts | undefined, dominant: CadenceSpanFacts, tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[], beatTicks: number | undefined, downbeat: number | undefined,
): CadenceEvidence | undefined {
  if (!preparation?.isSubdominant || !preparation.chord || !dominant.chord || !tonic.chord ||
      !beatTicks || downbeat !== tonic.span.fromTick || !tonic.isTonic || tonic.span.semantics?.cadenceRole ||
      !pitchClassEquals(tonic.chord.identity.root, tonic.key.tonic) ||
      chordIdentityInversion(dominant.chord.identity) !== 0 || chordIdentityInversion(tonic.chord.identity) !== 0) return;
  const source = dominant.chord.identity.structure, target = tonic.chord.identity.structure;
  if (source.kind !== "tertian" || source.quality !== "dominant7" || source.extensions.length || source.alterations.length ||
      target.kind !== "tertian" || target.quality !== tonic.key.mode || target.extensions.length || target.alterations.length) return;

  const pre = preparation.boundarySlice, attack = dominant.boundarySlice, arrival = tonic.boundarySlice;
  if (!pre?.notes.bass || !attack || !arrival?.notes.soprano || !pitchClassEquals(arrival.notes.soprano.pitch, tonic.key.tonic) ||
      !pitchClassEquals(preparation.key.tonic, tonic.key.tonic) || preparation.key.mode !== tonic.key.mode ||
      attack.index !== pre.index + 2 || arrival.index !== attack.index + 2) return;
  const firstRest = slices[pre.index + 1], secondRest = slices[attack.index + 1];
  const duration = attack.endTick - attack.tick, gap = arrival.tick - attack.endTick;
  if (duration > beatTicks || gap <= 0 || gap > beatTicks || pre.endTick - pre.tick !== duration ||
      attack.tick - pre.endTick !== gap || firstRest.chord || secondRest.chord ||
      Object.keys(firstRest.notes).length || Object.keys(secondRest.notes).length ||
      [pre, firstRest, attack, secondRest].some(slice => slice.key.id !== arrival.key.id)) return;

  const [root, third, , seventh] = chordIdentityToneSpellings(dominant.chord.identity);
  const targetTones = chordIdentityToneSpellings(tonic.chord.identity);
  if (!writtenAttack(preparation, chordIdentityToneSpellings(preparation.chord.identity)) ||
      !writtenAttack(dominant, [root, third, seventh]) ||
      !writtenAttack(tonic, targetTones.slice(0, 2)) ||
      slices.slice(arrival.index + 1).some(slice => Object.keys(slice.notes).length)) return;
  return {
    code: "detached-dominant-to-tonic", value: "下属准备与属七以相同节奏起奏、全休，末端强拍落主",
    refs: [preparation.span.id, dominant.span.id, tonic.span.id],
  };
}
