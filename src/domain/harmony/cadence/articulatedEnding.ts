import { chordIdentityInversion, chordIdentityToneSpellings } from "../../chordModel";
import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval } from "../../pitch";
import { VOICE_ORDER } from "../../project/voice";
import type { MeasureInfo } from "../../time";
import type { AnalysisSlice } from "../analysis";
import type { PhraseSegment } from "../phrase";
import { soundsCompleteWrittenChord } from "../writtenNeighbors";
import type { CadenceEvidence, CadenceSpanFacts } from "./types";

type MeasureFor = (tick: number) => MeasureInfo | undefined;

export function bassStepsUpToSubmediant(before: AnalysisSlice, arrival: AnalysisSlice) {
  if (!before.notes.bass || !arrival.notes.bass) return false;
  const bass = writtenInterval(before.notes.bass.pitch, arrival.notes.bass.pitch);
  return bass.diatonicSteps === 1 && isWrittenStep(bass);
}

/** A release with no rest can close an internal clause when all four parts
 * sustain the arrival for a bar and begin a new, shorter rhythm together. */
export function articulatedEndingEvidence(
  phrase: PhraseSegment,
  dominant: CadenceSpanFacts,
  ending: CadenceSpanFacts,
  continuation: CadenceSpanFacts,
  slices: readonly AnalysisSlice[],
  measureFor: MeasureFor,
): CadenceEvidence | undefined {
  const source = dominant.chord?.identity;
  const target = ending.chord?.identity;
  const following = continuation.chord?.identity;
  if (!source || !target || !following ||
      source.structure.kind !== "tertian" ||
      !["major", "dominant7"].includes(source.structure.quality) ||
      source.structure.alterations.length || source.structure.extensions.length ||
      target.structure.kind !== "tertian" ||
      !["major", "minor"].includes(target.structure.quality) ||
      target.structure.alterations.length || target.structure.extensions.length ||
      chordIdentityInversion(target) !== 0 || ending.span.semantics?.cadenceRole === "pedal64" ||
      ending.span.semantics?.cadenceRole === "passing64" ||
      continuation.family === undefined || continuation.family === ending.family) return;
  const inversion = chordIdentityInversion(source);
  if (inversion !== 0 && !(ending.isTonic && inversion === 1 && source.structure.quality === "major")) return;

  const landing = ending.boundarySlice;
  const restart = continuation.boundarySlice;
  const before = slices[dominant.span.sliceIndices.at(-1)!];
  const bar = measureFor(ending.span.fromTick);
  const newBar = measureFor(ending.span.toTick);
  if (!bar || !newBar || !before?.completeSatb || !landing?.completeSatb || !restart?.completeSatb ||
      landing.tick !== bar.startTick || ending.span.toTick !== bar.endTick ||
      landing.endTick !== bar.endTick || before.endTick !== landing.tick ||
      restart.tick !== newBar.startTick || restart.index !== landing.index + 1 ||
      newBar.endTick > phrase.toTick || newBar.denominator !== bar.denominator ||
      newBar.numerator !== bar.numerator || before.key.id !== landing.key.id || landing.key.id !== restart.key.id ||
      landing.attackVoiceIds.length !== VOICE_ORDER.length ||
      restart.attackVoiceIds.length !== VOICE_ORDER.length) return;

  const writtenNotes = (slice: AnalysisSlice) => VOICE_ORDER.map(voice => slice.notes[voice]!);
  const arrival = writtenNotes(landing);
  const onset = writtenNotes(restart);
  if (arrival.some(note => note.startTick !== bar.startTick || note.startTick + note.durationTicks !== bar.endTick) ||
      !soundsCompleteWrittenChord(source, writtenNotes(before), before.notes.bass!) ||
      !soundsCompleteWrittenChord(target, arrival, landing.notes.bass!) ||
      !soundsCompleteWrittenChord(following, onset, restart.notes.bass!)) return;

  const [targetRoot, targetThird] = chordIdentityToneSpellings(target);
  const [, leading, , seventh] = chordIdentityToneSpellings(source);
  const expectedRoot = scaleDegreePitchClass(ending.key, ending.isTonic ? 1 : 6);
  if (!pitchClassEquals(targetRoot, expectedRoot) ||
      (!ending.isTonic && (!bassStepsUpToSubmediant(before, landing) ||
        arrival.filter(note => pitchClassEquals(note.pitch, targetThird)).length !== 2))) return;

  // Verify the leading tone and, when present, the seventh in their own voices.
  const leadingVoice = VOICE_ORDER.find(voice => pitchClassEquals(before.notes[voice]!.pitch, leading))!;
  const leadMotion = writtenInterval(before.notes[leadingVoice]!.pitch, landing.notes[leadingVoice]!.pitch);
  if (leadMotion.diatonicSteps !== 1 || leadMotion.semitones !== 1 ||
      !pitchClassEquals(landing.notes[leadingVoice]!.pitch, ending.key.tonic)) return;
  if (seventh) {
    const voice = VOICE_ORDER.find(voice => pitchClassEquals(before.notes[voice]!.pitch, seventh))!;
    const step = writtenInterval(before.notes[voice]!.pitch, landing.notes[voice]!.pitch);
    if (step.diatonicSteps !== -1 || !isWrittenStep(step)) return;
  }

  let renewedAttacks = 0;
  for (let index = restart.index + 1; index < slices.length && slices[index].tick < newBar.endTick; index++) {
    const next = slices[index];
    if (next.key.id !== restart.key.id || !next.completeSatb) return;
    if (next.attackVoiceIds.length === VOICE_ORDER.length &&
        VOICE_ORDER.some(voice => !spelledPitchEquals(next.notes[voice]!.pitch, slices[index - 1].notes[voice]!.pitch))) {
      renewedAttacks++;
    }
  }
  if (renewedAttacks < 2) return;
  return {
    code: "articulated-interior-ending",
    value: "四部整小节保持并同时释放，后小节以更短的齐奏节奏重新展开",
    refs: [...arrival, ...onset].map(note => note.id),
  };
}
