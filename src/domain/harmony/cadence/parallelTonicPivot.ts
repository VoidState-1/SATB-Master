import { chordIdentityInversion, chordIdentityToneSpellingForDegree, type ChordIdentity } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { AnalysisSlice } from "../analysis";
import { soundsCompleteWrittenChord } from "../writtenNeighbors";
import type { CadenceSpanFacts } from "./types";

function plain(identity: ChordIdentity, quality: "major" | "minor" | "dominant7") {
  const structure = identity.structure;
  return structure.kind === "tertian" && structure.quality === quality &&
    !structure.alterations.length && !structure.extensions.length;
}

function soundsAs(slice: AnalysisSlice, identity: ChordIdentity) {
  return slice.completeSatb &&
    soundsCompleteWrittenChord(identity, VOICE_ORDER.map(voice => slice.notes[voice]!), slice.notes.bass!);
}

/** A short V–V2 resolves into an opposite-mode I6 that is also iii/III
 * of the next key (Spasobin §54.1c, §54.2a). */
export function continuesThroughParallelTonic(
  previous: CadenceSpanFacts, terminal: CadenceSpanFacts,
  pivot: CadenceSpanFacts, onward: CadenceSpanFacts, slices: readonly AnalysisSlice[],
  writtenBeatAt: (tick: number) => number | undefined,
) {
  const opening = previous.chord?.identity;
  const dominant = terminal.chord?.identity;
  const tonic = pivot.chord?.identity;
  const nextDominant = onward.chord?.identity;
  if (!opening || !dominant || !tonic || !nextDominant ||
      !plain(opening, "major") || chordIdentityInversion(opening) !== 0 ||
      !plain(dominant, "dominant7") || chordIdentityInversion(dominant) !== 3 ||
      !pitchClassEquals(opening.root, dominant.root) ||
      !plain(tonic, terminal.key.mode === "major" ? "minor" : "major") ||
      chordIdentityInversion(tonic) !== 1 || !pitchClassEquals(tonic.root, terminal.key.tonic) ||
      !pitchClassEquals(pivot.key.tonic, terminal.key.tonic) ||
      pitchClassEquals(onward.key.tonic, terminal.key.tonic) ||
      onward.key.mode !== terminal.key.mode ||
      !pitchClassEquals(tonic.root, scaleDegreePitchClass(onward.key, 3)) ||
      !plain(nextDominant, "dominant7")) return false;

  const before = previous.boundarySlice, arrival = pivot.boundarySlice, newKey = onward.boundarySlice;
  const tick = pivot.span.fromTick;
  const source = slices[terminal.span.sliceIndices.at(-1)!];
  if (!before || !source || !arrival || !newKey ||
      source.endTick !== tick || arrival.tick !== tick || newKey.tick !== onward.span.fromTick ||
      newKey.key.id !== before.key.id || !soundsAs(newKey, nextDominant)) return false;

  const succession = [[previous, opening, terminal], [terminal, dominant, pivot], [pivot, tonic, onward]] as const;
  if (!succession.every(([part, identity, following]) => {
    const beat = writtenBeatAt(part.span.fromTick);
    return beat !== undefined && part.span.toTick - part.span.fromTick <= beat &&
      part.span.toTick === following.span.fromTick && part.span.sliceIndices.every(index => {
        const slice = slices[index];
        return slice.key.id === before.key.id && soundsAs(slice, identity);
      });
  })) return false;

  const bass = source.notes.bass!, tonicBass = arrival.notes.bass!;
  const bassStep = writtenInterval(bass.pitch, tonicBass.pitch);
  if (bass.startTick + bass.durationTicks !== tick || tonicBass.startTick !== tick ||
      !isWrittenStep(bassStep) || bassStep.diatonicSteps !== -1) return false;

  const leading = chordIdentityToneSpellingForDegree(dominant, 3)!;
  const voices = VOICE_ORDER.filter(voice => voice !== "bass");
  const resolvedLeading = voices.some(voice => {
    const note = source.notes[voice]!, next = arrival.notes[voice]!;
    const step = writtenInterval(note.pitch, next.pitch);
    return pitchClassEquals(note.pitch, leading) && next.startTick === tick &&
      note.startTick + note.durationTicks === tick && pitchClassEquals(next.pitch, tonic.root) &&
      step.diatonicSteps === 1 && step.semitones === 1;
  });
  const heldCommonTone = voices.some(voice => {
    const first = before.notes[voice]!, middle = source.notes[voice]!, last = arrival.notes[voice]!;
    return first.id === middle.id && middle.id === last.id && pitchClassEquals(first.pitch, dominant.root);
  });

  return resolvedLeading && heldCommonTone;
}
