import { chordIdentityInversion, chordIdentityToneSpellings, chordToneSpellings, type KeyReference } from "../../chordModel";
import { pitchClassEquals, toMidi, writtenInterval } from "../../pitch";
import type { AnalysisSlice } from "../analysis";
import { sameDetachedRhythm, writtenAttack } from "./detachedAttacks";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";

function hasDetachedAuthenticApproach(
  preparation: CadenceSpanFacts, dominant: CadenceSpanFacts, arrival: AnalysisSlice, key: KeyReference,
  slices: readonly AnalysisSlice[], beatTicks: number | undefined, downbeat: number | undefined,
) {
  if (!preparation.isSubdominant || !preparation.chord || !dominant.chord || !beatTicks || downbeat !== arrival.tick ||
      chordIdentityInversion(dominant.chord.identity) !== 0) return false;
  const source = dominant.chord.identity.structure;
  if (source.kind !== "tertian" || source.quality !== "dominant7" || source.extensions.length || source.alterations.length) return false;

  const pre = preparation.boundarySlice, attack = dominant.boundarySlice;
  if (!pre?.notes.bass || !attack || !arrival.notes.soprano || !pitchClassEquals(arrival.notes.soprano.pitch, key.tonic) ||
      !pitchClassEquals(preparation.key.tonic, key.tonic) || preparation.key.mode !== key.mode ||
      !sameDetachedRhythm(pre, attack, arrival, slices, beatTicks)) return false;

  const [root, third, , seventh] = chordIdentityToneSpellings(dominant.chord.identity);
  return writtenAttack(preparation, chordIdentityToneSpellings(preparation.chord.identity)) &&
    writtenAttack(dominant, [root, third, seventh]) &&
    !slices.slice(arrival.index + 1).some(slice => Object.keys(slice.notes).length);
}

/** A rest can belong to an ongoing cadence when the predominant and dominant
 * use the same detached rhythm through the final downbeat. */
export function detachedAuthenticEvidence(
  preparation: CadenceSpanFacts | undefined, dominant: CadenceSpanFacts, tonic: CadenceSpanFacts,
  slices: readonly AnalysisSlice[], beatTicks: number | undefined, downbeat: number | undefined,
): CadenceEvidence | undefined {
  const arrival = tonic.boundarySlice, identity = tonic.chord?.identity;
  if (!preparation || !arrival || !identity || !tonic.isTonic || tonic.span.semantics?.cadenceRole ||
      downbeat !== tonic.span.fromTick || !pitchClassEquals(identity.root, tonic.key.tonic) ||
      chordIdentityInversion(identity) !== 0) return;
  const target = identity.structure;
  if (target.kind !== "tertian" || target.quality !== tonic.key.mode || target.extensions.length || target.alterations.length ||
      !hasDetachedAuthenticApproach(preparation, dominant, arrival, tonic.key, slices, beatTicks, downbeat) ||
      !writtenAttack(tonic, chordIdentityToneSpellings(identity).slice(0, 2))) return;
  return {
    code: "detached-dominant-to-tonic", value: "下属准备与属七以相同节奏起奏、全休，末端强拍落主",
    refs: [preparation.span.id, dominant.span.id, tonic.span.id],
  };
}

/** Mozart, Spasobin 20–277. Score only the cadence on the three sounding
 * notes; the rest pattern establishes the landing without a chord label. */
export function detachedSparseTonicEvidence(
  preparation: CadenceSpanFacts, dominant: CadenceSpanFacts, arrival: AnalysisSlice,
  slices: readonly AnalysisSlice[], beatTicks: number | undefined, downbeat: number | undefined,
): CadenceEvidence | undefined {
  const { bass, soprano, alto, tenor } = arrival.notes;
  const inner = alto ?? tenor;
  const sourceBass = dominant.boundarySlice?.notes.bass;
  if (arrival.chord || !bass || !soprano || !inner || (alto && tenor) || !sourceBass || !beatTicks ||
      arrival.endTick - arrival.tick < beatTicks ||
      dominant.key.mode !== arrival.key.mode || !pitchClassEquals(dominant.key.tonic, arrival.key.tonic)) return;
  const [root, third] = chordToneSpellings(arrival.key.tonic, arrival.key.mode);
  const notes = [bass, inner, soprano];
  if (!pitchClassEquals(bass.pitch, root) || !pitchClassEquals(soprano.pitch, root) || !pitchClassEquals(inner.pitch, third) ||
      toMidi(bass.pitch) >= toMidi(inner.pitch) || toMidi(inner.pitch) >= toMidi(soprano.pitch) ||
      notes.some(note => note.nonChordToneRole || note.startTick !== arrival.tick ||
        note.startTick + note.durationTicks !== arrival.endTick)) return;
  const motion = writtenInterval(sourceBass.pitch, bass.pitch);
  if (!((motion.diatonicSteps === 3 && motion.semitones === 5) ||
        (motion.diatonicSteps === -4 && motion.semitones === -7)) ||
      !hasDetachedAuthenticApproach(preparation, dominant, arrival, dominant.key, slices, beatTicks, downbeat)) return;
  return {
    code: "detached-sparse-tonic",
    value: "同型顿奏与全休之后，外声实奏主音，内声实奏三音，三个声部同步收束",
    refs: [preparation.span.id, dominant.span.id, ...notes.map(note => note.id)],
  };
}
