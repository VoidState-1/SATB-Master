import {
  chordIdentityEquals,
  chordIdentityToneSpellings,
  chordToneSpellings,
  type ChordIdentity,
  type KeyReference,
} from "../../../../chordModel";
import {
  keyEquals,
  isWrittenStep,
  leadingTonePitchClass,
  enharmonicSpellings,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  stepIndex,
  toMidi,
  writtenInterval,
  type SpelledPitchClass,
  formatPitchClass,
  formatSpelledPitch,
} from "../../../../pitch";
import type { VoiceId } from "../../../../project/types";
import { VOICE_ORDER } from "../../../../project/voice";
import {
  sameChordIdentityWithoutBass,
  type AnalysisNote,
  type AnalysisSlice,
  type MelodyTransition,
} from "../../../analysis";
import { hasWrittenVoicing, matchesWrittenChord, resolvesInVoice } from "../../../facts/tendencyResolution";
import {
  hasCompleteWrittenTertianVoicing,
  readCompleteWrittenChord,
  soundsCompleteWrittenChord,
  soundsCompleteWrittenTones,
  soundsDeclaredChord,
} from "../../../facts/writtenVoicing";
import { readWrittenDominantSeventh } from "../../../facts/dominantMotion";
import type { RuleDiagnostic } from "../../../runtime";
import type { HarmonyRuleContext } from "../../context/createRuleContext";
import {
  hasExactPitch,
  diagnostic,
  intervalName,
  noteEvidence,
  voiceName,
  crossesManualPhraseBoundary,
} from "../../helpers/core";
import { sameHarmonyAtMelodicAttack, sameHarmonyOnTransition } from "../../helpers/motionHarmony";
import { isWrittenLowerNeighborMotion } from "../../helpers/ornaments";
import { resolvesDominantSeventhEntry, isResolvedDominantSixthBass } from "./appliedAndDeceptive";
import { resolvesGermanSixthDiminishedThird } from "./augmentedSixth";
import {
  readDominantSeventhHandoffSpelling,
  halfDiminishedChainArrivals,
  isMinorSixthChordBassLine,
  isNeapolitanSeventhBassTritone,
  readWrittenStructuralSpelling,
} from "./chordSpellingAndDiatonic";
import { resolvesRaisedSecondApproach, resolvesContextualMinorDominantSixth } from "./doubleDominant";

function writtenDegree(key: KeyReference, pitch: SpelledPitchClass) {
  return (stepIndex(pitch.step) - stepIndex(key.tonic.step) + 7) % 7 + 1;
}

// 第 41 章例 41-616、617。索引从 I 到 VII，0 表示该级只采用自然写法。
const ASCENDING_ALTERATIONS = [1, 1, 0, 1, 1, 0, -1];
const DESCENDING_ALTERATIONS = [0, -1, -1, 1, 0, -1, -1];

function usualChromaticSpelling(key: KeyReference, pitch: SpelledPitchClass, ascending: boolean) {
  // 小调上行参照平行大调，下行参照同主音大调。
  const tonic = key.mode === "minor" && ascending ? scaleDegreePitchClass(key, 3) : key.tonic;
  const major = { tonic, mode: "major" } as const;
  const degree = writtenDegree(major, pitch);
  if (pitchClassEquals(pitch, scaleDegreePitchClass(major, degree))) return true;
  const alteration = (ascending ? ASCENDING_ALTERATIONS : DESCENDING_ALTERATIONS)[degree - 1];
  return alteration !== 0 && pitchClassEquals(pitch, scaleDegreePitchClass(major, degree, alteration));
}

function localKey(context: HarmonyRuleContext, slice: AnalysisSlice) {
  if (!slice.chord) return slice.key;
  const interpretation = context.harmony.primaryInterpretation(slice.chord);
  if (interpretation.status === "ambiguous") return undefined;
  return interpretation.status === "resolved" ? interpretation.value.localKey ?? slice.key : slice.key;
}

function fullySoundsTriad(slice: AnalysisSlice, identity: ChordIdentity, passingId?: string) {
  const bass = slice.notes.bass;
  return !!bass && slice.completeSatb && soundsCompleteWrittenChord(identity, Object.values(slice.notes), bass, passingId);
}

function plainTriad(root: SpelledPitchClass, quality: "major" | "minor", bass: SpelledPitchClass): ChordIdentity {
  return { root, bass, structure: { kind: "tertian", quality, extensions: [], alterations: [] } };
}

function continuousContext(context: HarmonyRuleContext, fromTick: number, to: AnalysisSlice) {
  return !context.analysis.phraseBoundaries.some(mark =>
    !mark.stale && fromTick < mark.tick && mark.tick <= to.tick) &&
    !context.analysis.project.keyEvents.some(event => fromTick < event.tick && event.tick <= to.tick);
}

function resolvedDegree(context: HarmonyRuleContext, slice: AnalysisSlice, degree: 1 | 5) {
  const chord = slice.chord;
  if (!chord || chord.semantics?.interpretations.length !== 1) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== degree ||
      reading.value.degreeAlteration !== 0 || reading.value.appliedTarget ||
      reading.value.designation?.kind !== "primary" ||
      reading.value.designation.primaryFunction !== (degree === 1 ? "tonic" : "dominant")) return;
  return reading.value.localKey ?? slice.key;
}

function keyOfCadentialBackbone(context: HarmonyRuleContext, slice: AnalysisSlice, root: SpelledPitchClass) {
  const bass = slice.notes.bass!;
  // The same real dominant bass must reach a written V7–I within its measure.
  const limit = bass.startTick + bass.durationTicks;
  const dominant = context.sliceAt(limit - 1);
  const tonic = context.sliceAt(limit);
  if (!dominant || !tonic || tonic.tick !== limit || !dominant.chord || !tonic.chord ||
      dominant.chord.startTick !== dominant.tick || tonic.chord.startTick !== limit ||
      dominant.notes.bass?.id !== bass.id || !pitchClassEquals(bass.pitch, root) ||
      context.metric.positionAt(dominant.tick)?.measureNumber !== context.metric.positionAt(slice.tick)?.measureNumber ||
      !continuousContext(context, slice.tick, tonic)) return;
  const key = resolvedDegree(context, tonic, 1);
  const domKey = resolvedDegree(context, dominant, 5);
  if (!key || !domKey || key.mode !== "major" || !keyEquals(key, domKey) ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, 5)) ||
      !matchesWrittenChord(dominant, root, "dominant7")) return;

  const third = scaleDegreePitchClass(key, 3);
  const tonicIdentity = plainTriad(key.tonic, "major", key.tonic);
  if (!chordIdentityEquals(tonic.chord.identity, tonicIdentity) || !tonic.notes.bass ||
      !pitchClassEquals(tonic.notes.bass.pitch, key.tonic) ||
      (!hasWrittenVoicing(tonic, chordToneSpellings(key.tonic, "major")) &&
        !hasWrittenVoicing(tonic, [key.tonic, third]))) return;
  const tones = chordToneSpellings(root, "dominant7");
  const leading = VOICE_ORDER.find(voice => pitchClassEquals(dominant.notes[voice]!.pitch, tones[1]))!;
  const seventh = VOICE_ORDER.find(voice => pitchClassEquals(dominant.notes[voice]!.pitch, tones[3]))!;
  if (resolvesInVoice(dominant, tonic, leading, key.tonic, 1) &&
      resolvesInVoice(dominant, tonic, seventh, third, -1)) return key;
}

function compatibleBackbone(
  context: HarmonyRuleContext, slice: AnalysisSlice, harmony: ChordIdentity, key: KeyReference,
) {
  if (!slice.chord) return true;
  const labelled = localKey(context, slice);
  return (slice.chord.semantics?.interpretations.length ?? 0) <= 1 && !!labelled && keyEquals(labelled, key) &&
    chordIdentityEquals(slice.chord.identity, harmony);
}

function isDiatonicIn(key: KeyReference, note: AnalysisNote) {
  return pitchClassEquals(note.pitch, scaleDegreePitchClass(key, writtenDegree(key, note.pitch)));
}

function hasStepwiseEntry(
  context: HarmonyRuleContext, voice: VoiceId, fromTick: number, left: AnalysisNote,
  key: KeyReference, harmony: ChordIdentity,
) {
  const onset = context.sliceAt(fromTick);
  if (!onset?.notes[voice] || !fullySoundsTriad(onset, harmony)) return false;
  const line = context.notes({ voiceId: voice })
    .where(({ note }) => fromTick <= note.startTick && note.startTick <= left.startTick)
    .select(({ note }) => note)
    .toArray();
  if (line.length < 2 || line.length > 3 || line[0].id !== onset.notes[voice].id ||
      line[line.length - 1].id !== left.id) return false;
  return line.slice(1).every((note, index) => {
    const prior = line[index];
    const step = writtenInterval(prior.pitch, note.pitch);
    return prior.startTick + prior.durationTicks === note.startTick &&
      step.diatonicSteps === -1 && (step.semitones === -1 || step.semitones === -2) &&
      isDiatonicIn(key, note) && (!note.nonChordToneRole || note.nonChordToneRole === "passing");
  });
}

function preparesNinthOnDominant(
  context: HarmonyRuleContext, voice: VoiceId, fromTick: number, left: AnalysisNote,
  key: KeyReference, root: SpelledPitchClass,
) {
  const preparation = context.sliceAt(fromTick - 1), arrival = context.sliceAt(fromTick);
  if (!preparation || !arrival || preparation.notes[voice]?.id !== left.id || arrival.notes[voice]?.id !== left.id ||
      !pitchClassEquals(left.pitch, scaleDegreePitchClass(key, 6)) ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, 5)) ||
      (!preparation.notes.bass || !pitchClassEquals(preparation.notes.bass.pitch, scaleDegreePitchClass(key, 4, 1))) ||
      !matchesWrittenChord(preparation, scaleDegreePitchClass(key, 4, 1), "diminished7")) return;
  if (preparation.chord) {
    const reading = context.harmony.primaryInterpretation(preparation.chord);
    if (reading.status !== "resolved" || preparation.chord.semantics?.interpretations.length !== 1) return;
    const { degree, degreeAlteration, designation, appliedTarget, localKey } = reading.value;
    if (degree !== 7 || degreeAlteration !== 0 || !keyEquals(localKey ?? preparation.key, key) ||
        (designation?.kind !== "double-dominant-leading-tone" && designation?.kind !== "applied-leading-tone") ||
        appliedTarget?.degree !== 5 || appliedTarget.primaryFunction !== "dominant" || appliedTarget.secondaryFunction) return;
  }
  const seventh = VOICE_ORDER.find(part =>
    pitchClassEquals(preparation.notes[part]!.pitch, scaleDegreePitchClass(key, 3, -1)))!;
  if (!resolvesInVoice(preparation, arrival, "bass", root, 1) ||
      !resolvesInVoice(preparation, arrival, seventh, scaleDegreePitchClass(key, 2), -1)) return;
  return true;
}

/** §41.1b/§41.3: a chromatic step may connect a diatonic passing tone
 * (or a prepared ninth) to a chord tone over a physically held triad. */
function readHeldTriadForDescendingPassing(
  context: HarmonyRuleContext, first: MelodyTransition, second: MelodyTransition,
) {
  const { previous: left, current: middle, voiceId } = first;
  const { current: right } = second;
  if (first.current.id !== second.previous.id || !first.contiguous || !second.contiguous ||
      !first.sameKey || !second.sameKey || voiceId === "bass" ||
      first.writtenInterval.diatonicSteps !== 0 || first.writtenInterval.semitones !== -1 ||
      second.writtenInterval.diatonicSteps !== -1 || second.writtenInterval.semitones !== -1 ||
      (left.nonChordToneRole && left.nonChordToneRole !== "passing") || right.nonChordToneRole ||
      (middle.nonChordToneRole && middle.nonChordToneRole !== "passing")) return;
  const from = context.sliceAt(middle.startTick - 1);
  const to = context.sliceAt(right.startTick);
  if (!from?.completeSatb || !to?.completeSatb) return;
  const weak = context.metric.positionAt(middle.startTick);
  if (weak?.role !== "subdivision" || context.metric.compare(context.metric.positionAt(right.startTick), weak) !== "stronger" ||
      middle.durationTicks > Math.min(left.durationTicks, right.durationTicks)) return;

  const bass = to.notes.bass!;
  const others = VOICE_ORDER.filter(voice => voice !== voiceId);
  const held = others.map(voice => to.notes[voice]!);
  if (held.some(note => note.nonChordToneRole || toMidi(note.pitch) < toMidi(bass.pitch)) ||
      ![left, middle, right].every(note => toMidi(note.pitch) >= toMidi(bass.pitch))) return;
  const root = held.find(({ pitch }) => chordToneSpellings(pitch, "major").every(tone =>
    held.some(note => pitchClassEquals(note.pitch, tone))))?.pitch;
  if (!root) return;
  const harmony = plainTriad(root, "major", bass.pitch);
  const tones = chordToneSpellings(root, "major");
  if (!hasExactPitch(right, tones) || hasExactPitch(left, tones) || hasExactPitch(middle, tones)) return;
  const backingStart = Math.max(...held.map(note => note.startTick));
  const spans = context.slices({ overlapping: { fromTick: backingStart, toTick: right.startTick + 1 } });
  if (backingStart >= middle.startTick || !continuousContext(context, Math.min(backingStart, left.startTick), to) ||
      !spans.all(slice => slice.completeSatb && held.every((note, index) => slice.notes[others[index]]?.id === note.id))) return;

  const prepared = left.startTick < backingStart;
  const key = prepared ? keyOfCadentialBackbone(context, to, root) : localKey(context, to);
  if (!key || key.mode !== "major" || !isDiatonicIn(key, left) || !isDiatonicIn(key, right) ||
      !usualChromaticSpelling(key, middle.pitch, false) ||
      !spans.all(slice => compatibleBackbone(context, slice, harmony, key))) return;
  if (prepared) return preparesNinthOnDominant(context, voiceId, backingStart, left, key, root);
  return hasStepwiseEntry(context, voiceId, backingStart, left, key, harmony);
}

function chromaticPassingDirection(left: AnalysisNote, middle: AnalysisNote, right: AnalysisNote) {
  if (left.startTick + left.durationTicks !== middle.startTick ||
      middle.startTick + middle.durationTicks !== right.startTick ||
      left.nonChordToneRole || right.nonChordToneRole ||
      (middle.nonChordToneRole && middle.nonChordToneRole !== "passing")) return;
  const a = writtenInterval(left.pitch, middle.pitch);
  const b = writtenInterval(middle.pitch, right.pitch);
  if (Math.abs(a.semitones) === 1 && a.semitones === b.semitones &&
      a.diatonicSteps + b.diatonicSteps === a.semitones &&
      (a.diatonicSteps === 0 || b.diatonicSteps === 0)) return a.semitones;
}

/** §41.1a. A complete written chord can establish the source of a chromatic
 * passing motion after the moving voice arpeggiates and leaves one member out. */
export function readHeldChromaticPassing(
  context: HarmonyRuleContext, voice: VoiceId, left: AnalysisNote, middle: AnalysisNote, right: AnalysisNote,
) {
  if (voice === "bass" || chromaticPassingDirection(left, middle, right) === undefined) return;
  const position = context.metric.positionAt(middle.startTick);
  if (position?.confidence !== "certain" || position.level >= 2 ||
      middle.durationTicks > Math.min(left.durationTicks, right.durationTicks)) return;

  const from = context.sliceAt(middle.startTick - 1);
  const via = context.sliceAt(middle.startTick);
  const to = context.sliceAt(right.startTick);
  if (!from?.completeSatb || !via?.completeSatb || !to?.completeSatb ||
      from.notes[voice]?.id !== left.id || via.notes[voice]?.id !== middle.id ||
      to.notes[voice]?.id !== right.id ||
      hasCompleteWrittenTertianVoicing(Object.values(via.notes).map(note => note.pitch))) return;
  const arrival = readCompleteWrittenChord(to);
  if (!arrival || arrival.structure.kind !== "tertian") return;

  const accompaniment = VOICE_ORDER.filter(part => part !== voice);
  const heldSince = Math.max(...accompaniment.map(part => from.notes[part]!.startTick));
  if (heldSince >= left.startTick) return;
  const frames = context.slices({ overlapping: { fromTick: heldSince, toTick: right.startTick } }).toArray();
  let anchorIndex = frames.length;
  let harmony: ChordIdentity | undefined;
  while (anchorIndex > 0 && !harmony) {
    const frame = frames[--anchorIndex];
    if (frame.tick < left.startTick) harmony = readCompleteWrittenChord(frame);
  }
  if (!harmony || harmony.structure.kind !== "tertian" ||
      (harmony.structure.quality !== "major" && harmony.structure.quality !== "minor") ||
      harmony.structure.extensions.length || harmony.structure.alterations.length) return;

  const anchor = frames[anchorIndex];
  const key = localKey(context, anchor);
  const landingKey = localKey(context, to);
  if (!key || !landingKey || !keyEquals(key, landingKey) || !continuousContext(context, anchor.tick, to) ||
      !pitchClassEquals(from.notes.bass!.pitch, harmony.bass)) return;

  const tones = chordIdentityToneSpellings(harmony);
  const missing = tones.filter(tone => !Object.values(from.notes).some(note => pitchClassEquals(note.pitch, tone)));
  if (missing.length !== 1 || pitchClassEquals(missing[0], harmony.root) ||
      !isDiatonicIn(key, left) || !isDiatonicIn(key, right) ||
      hasExactPitch(middle, tones) || hasExactPitch(middle, chordIdentityToneSpellings(arrival))) return;

  const bass = from.notes.bass!;
  const uninterrupted = frames.slice(anchorIndex).every(frame => {
    const note = frame.notes[voice];
    if (!frame.completeSatb || frame.key.id !== to.key.id ||
        !accompaniment.every(part => frame.notes[part]?.id === from.notes[part]?.id) ||
        !compatibleBackbone(context, frame, harmony, key) ||
        !note || toMidi(note.pitch) < toMidi(bass.pitch)) return false;
    if (frame.tick >= middle.startTick) return note.id === middle.id;
    return !note.nonChordToneRole && hasExactPitch(note, tones);
  });
  if (uninterrupted) return key;
}

interface PassingSpellingCorrection {
  note: AnalysisNote;
  spelling: AnalysisNote["pitch"];
}

function readChromaticPassingSpelling(context: HarmonyRuleContext, first: MelodyTransition, second: MelodyTransition): PassingSpellingCorrection | undefined {
  if (first.current.id !== second.previous.id || !first.contiguous || !second.contiguous ||
      !first.sameKey || !second.sameKey) return;
  const { previous: left, current: middle } = first;
  const { current: right } = second;
  const direction = chromaticPassingDirection(left, middle, right);
  if (direction === undefined) return;
  const heldKey = readHeldChromaticPassing(context, first.voiceId, left, middle, right);
  if (heldKey) return usualChromaticSpelling(heldKey, middle.pitch, direction > 0)
    ? undefined : passingSpellingCorrection(heldKey, left, middle, right, direction > 0);
  const meter = context.metric.positionAt(middle.startTick);
  if (!meter || meter.confidence === "ambiguous" || meter.role === "downbeat") return;
  const from = context.sliceAt(middle.startTick - 1);
  const via = context.sliceAt(middle.startTick);
  const to = context.sliceAt(right.startTick);
  if (!from || !to || !via) return;
  const key = localKey(context, from);
  const landingKey = localKey(context, to);
  const middleKey = via.chord ? localKey(context, via) : key;
  if (!key || ![middleKey, landingKey].every(k => k && keyEquals(k, key))) return;
  if (![left, right].every(note => isDiatonicIn(key, note))) return;
  if (usualChromaticSpelling(key, middle.pitch, direction > 0)) return;
  if (!from.chord || !to.chord) return;
  if (!hasExactPitch(left, chordIdentityToneSpellings(from.chord.identity)) ||
      !hasExactPitch(right, chordIdentityToneSpellings(to.chord.identity))) return;

  // 此处只判断旋律写法。三个伴随声部持续时，纵切也可能构成变化和弦。
  const harmony = from.chord.identity;
  const tones = chordIdentityToneSpellings(harmony);
  if (hasExactPitch(middle, tones)) return;
  const otherVoices = VOICE_ORDER.filter(voice => voice !== first.voiceId);
  const slices = context.slices({ overlapping: { fromTick: middle.startTick, toTick: right.startTick } });
  const heldAccompaniment = slices.all(slice =>
    (!slice.chord || sameChordIdentityWithoutBass(slice.chord.identity, harmony)) &&
    otherVoices.every(voice => {
      const before = from.notes[voice];
      const now = slice.notes[voice];
      return before && now && spelledPitchEquals(before.pitch, now.pitch) && hasExactPitch(before, tones);
    }),
  );
  if (!heldAccompaniment) return;

  // §41.3 permits chordal spellings in parallel motion. Reattacking the same
  // written pitch does not add a moving voice. Respect explicit nonchord roles.
  if (meter.confidence !== "certain" || meter.level >= 2 ||
      middle.durationTicks > Math.min(left.durationTicks, right.durationTicks) ||
      !continuousContext(context, left.startTick, to) ||
      !soundsDeclaredChord(from) || !soundsDeclaredChord(to) ||
      hasCompleteWrittenTertianVoicing(Object.values(via.notes).map(note => note.pitch)) ||
      !slices.all(slice => otherVoices.every(voice => !slice.notes[voice]?.nonChordToneRole))) return;
  return passingSpellingCorrection(key, left, middle, right, direction > 0);
}

function passingSpellingCorrection(
  key: KeyReference, left: AnalysisNote, middle: AnalysisNote, right: AnalysisNote, ascending: boolean,
): PassingSpellingCorrection | undefined {
  const otherStep = middle.pitch.step === left.pitch.step ? right.pitch.step : left.pitch.step;
  const spelling = enharmonicSpellings(middle.pitch).find(pitch =>
    pitch.step === otherStep && usualChromaticSpelling(key, pitch, ascending));
  if (spelling) return { note: middle, spelling };
}

export function chromaticPassingSpellingCorrections(context: HarmonyRuleContext) {
  const corrections = new Map<string, PassingSpellingCorrection>();
  for (const voiceId of VOICE_ORDER) {
    for (const [first, second] of context.melodyTransitions({ voiceId }).window(2)) {
      const correction = readChromaticPassingSpelling(context, first, second);
      if (!correction) continue;

      // A held triad or a prepared resolution can justify the written spelling.
      if (readHeldTriadForDescendingPassing(context, first, second) ||
          hasInsertedChromaticResolution(context, first, second)) continue;

      const unison = first.writtenInterval.diatonicSteps === 0 ? first : second;
      corrections.set(unison.id, correction);
    }
  }
  return corrections;
}

const upperVoices = ["soprano", "alto", "tenor"] as const;

function isInsertedStep(left: AnalysisNote, middle: AnalysisNote, right: AnalysisNote, direction: number) {
  const entry = writtenInterval(left.pitch, middle.pitch);
  const exit = writtenInterval(middle.pitch, right.pitch);
  return left.startTick + left.durationTicks === middle.startTick &&
    middle.startTick + middle.durationTicks === right.startTick &&
    entry.diatonicSteps === 0 && entry.semitones === direction &&
    exit.diatonicSteps === direction && exit.semitones === direction &&
    (!left.nonChordToneRole || left.nonChordToneRole === (direction < 0 ? "suspension" : "retardation")) &&
    (!middle.nonChordToneRole || middle.nonChordToneRole === "passing") && !right.nonChordToneRole;
}

function soundsTertian(frame: AnalysisSlice) {
  const bass = frame.notes.bass;
  if (!frame.completeSatb || !bass) return false;
  const pitches = Object.values(frame.notes).map(note => note.pitch);
  return pitches.every(pitch => toMidi(pitch) >= toMidi(bass.pitch)) && hasCompleteWrittenTertianVoicing(pitches);
}

function hasWrittenArrival(landing: AnalysisSlice, bass: AnalysisNote) {
  if (!soundsTertian(landing)) return false;
  const landedBass = landing.notes.bass!;
  if (landedBass.nonChordToneRole && landedBass.nonChordToneRole !== "pedal") return false;
  if (spelledPitchEquals(landedBass.pitch, bass.pitch)) return true;

  // A bass descent can add the written seventh at the moment of resolution.
  const step = writtenInterval(bass.pitch, landedBass.pitch);
  const upper = upperVoices.map(voice => landing.notes[voice]!.pitch);
  return step.diatonicSteps === -1 && (step.semitones === -1 || step.semitones === -2) &&
    upper.some(pitch => pitchClassEquals(pitch, bass.pitch)) &&
    upper.every(pitch => !pitchClassEquals(pitch, landedBass.pitch)) &&
    hasCompleteWrittenTertianVoicing(upper);
}

function areParallelThirdsOrSixths(lower: VoiceId, upper: VoiceId, frames: readonly AnalysisSlice[]) {
  const intervals = frames.map(frame => writtenInterval(frame.notes[lower]!.pitch, frame.notes[upper]!.pitch));
  const first = intervals[0];
  return first.semitones > 0 && [2, 5].includes(first.diatonicSteps % 7) &&
    intervals.every(interval => interval.diatonicSteps === first.diatonicSteps && interval.semitones === first.semitones);
}

/** §45.2b: the chromatic insertion continues a prepared whole-tone resolution. */
export function hasInsertedChromaticResolution(
  context: HarmonyRuleContext, first: MelodyTransition, second: MelodyTransition,
) {
  const { voiceId, previous: left, current: middle, writtenInterval: entry } = first;
  const right = second.current;
  if (voiceId === "bass" || entry.diatonicSteps !== 0 || Math.abs(entry.semitones) !== 1 ||
      middle.id !== second.previous.id || !isInsertedStep(left, middle, right, entry.semitones)) return false;

  const from = context.sliceAt(middle.startTick - 1);
  const via = context.sliceAt(middle.startTick);
  const landing = context.sliceAt(right.startTick);
  const bass = from?.notes.bass;
  if (!from?.completeSatb || !via?.completeSatb || !landing?.completeSatb || !bass ||
      (bass.nonChordToneRole && bass.nonChordToneRole !== "pedal") ||
      bass.startTick >= middle.startTick || !hasWrittenArrival(landing, bass)) return false;

  const onset = context.sliceAt(bass.startTick);
  const preparation = context.sliceAt(bass.startTick - 1);
  const oldBass = preparation?.notes.bass;
  if (!onset?.completeSatb || !oldBass || spelledPitchEquals(oldBass.pitch, bass.pitch) ||
      context.metric.compare(context.metric.positionAt(bass.startTick), context.metric.positionAt(middle.startTick)) !== "stronger") return false;

  const moving = upperVoices.filter(voice => from.notes[voice]!.id !== via.notes[voice]!.id);
  if (!moving.includes(voiceId) || moving.length > 2) return false;
  // A single prepared ninth resolving to the bass's pitch class already has
  // dedicated cadence, spelling, and bass-continuity checks in chromaticPassing.
  if (moving.length === 1 && entry.semitones < 0 && pitchClassEquals(right.pitch, bass.pitch)) return false;
  if (moving.length === 2 && !areParallelThirdsOrSixths(moving[1], moving[0], [from, via, landing])) return false;
  const fixed = upperVoices.filter(voice => !moving.includes(voice));
  if (!fixed.every(voice => !from.notes[voice]!.nonChordToneRole && !landing.notes[voice]!.nonChordToneRole &&
      spelledPitchEquals(from.notes[voice]!.pitch, landing.notes[voice]!.pitch))) return false;

  const arrivalPitches = Object.values(landing.notes).map(note => note.pitch);
  if (!moving.every(voice => {
    const initial = from.notes[voice]!, inserted = via.notes[voice]!, resolved = landing.notes[voice]!;
    return initial.startTick <= bass.startTick && onset.notes[voice]?.id === initial.id &&
      inserted.startTick === middle.startTick && resolved.startTick === right.startTick &&
      isInsertedStep(initial, inserted, resolved, entry.semitones) &&
      !arrivalPitches.some(pitch => pitchClassEquals(pitch, initial.pitch) || pitchClassEquals(pitch, inserted.pitch));
  })) return false;

  const motion = context.slices({ overlapping: { fromTick: bass.startTick, toTick: right.startTick } });
  if (!motion.all(slice => slice.notes.bass?.id === bass.id && slice.key.id === landing.key.id &&
      upperVoices.every(voice => {
        const expected = slice.tick < middle.startTick ? from.notes[voice]! : via.notes[voice]!;
        return slice.notes[voice]?.id === expected.id && toMidi(expected.pitch) >= toMidi(bass.pitch);
      }))) return false;

  // In 45-661 the upper voice can leave a complete preparation just
  // before the next bass attack. Look back only under the same old bass
  // and while the prepared voice(s) still sound at the same pitch.
  const candidates = context.slices({ overlapping: { fromTick: oldBass.startTick, toTick: bass.startTick } }).toArray();
  for (let index = candidates.length - 1; index >= 0; index--) {
    const slice = candidates[index];
    if (slice.key.id !== landing.key.id || slice.notes.bass?.id !== oldBass.id ||
        !moving.every(voice => {
          const note = slice.notes[voice];
          return note && spelledPitchEquals(note.pitch, from.notes[voice]!.pitch);
        }) || context.analysis.project.structure.phraseBoundaries.some(boundary =>
          boundary.source === "manual" && !boundary.stale && slice.tick < boundary.tick && boundary.tick <= landing.tick)) return false;
    if (soundsTertian(slice)) return true;
  }
  return false;
}

const AUGMENTED = "melody.augmented-interval";

function declaredDiminishedMotionChord(context: HarmonyRuleContext, frame: AnalysisSlice) {
  const { chord } = frame;
  if (!chord || chord.locked || context.analysis.project.chordTrack.locked) return chord;
  const readings = chord.semantics?.interpretations;
  return readings?.length && readings.every(reading => reading.source === "inferred") ? undefined : chord;
}

function isRootPositionLeadingTriad(context: HarmonyRuleContext, frame: AnalysisSlice) {
  const bass = frame.notes.bass;
  if (!bass) return false;
  const key = localKey(context, frame);
  if (!pitchClassEquals(bass.pitch, leadingTonePitchClass(frame.key)) &&
      (!key || !pitchClassEquals(bass.pitch, leadingTonePitchClass(key)))) return false;
  const declared = declaredDiminishedMotionChord(context, frame)?.identity;
  const diminished = chordToneSpellings(bass.pitch, "diminished");
  return (declared?.structure.kind === "tertian" && declared.structure.quality === "diminished" &&
    pitchClassEquals(declared.root, bass.pitch) && pitchClassEquals(declared.bass, bass.pitch)) ||
    soundsCompleteWrittenTones(diminished, Object.values(frame.notes).map(({ pitch }) => ({ pitch })), bass);
}

function supportsDiminishedMotionVoicing(context: HarmonyRuleContext, frame: AnalysisSlice, ornamentId?: string) {
  const notes = Object.values(frame.notes).filter(note => note.id !== ornamentId);
  const bass = frame.notes.bass ?? notes.reduce<AnalysisNote | undefined>((lowest, note) =>
    !lowest || toMidi(note.pitch) < toMidi(lowest.pitch) ? note : lowest, undefined);
  if (!bass || bass.id === ornamentId || notes.some(note => toMidi(note.pitch) < toMidi(bass.pitch))) return false;
  const declared = declaredDiminishedMotionChord(context, frame)?.identity;
  const written = (identity: ChordIdentity) => soundsCompleteWrittenChord(identity, notes, bass);
  const rootAndThird = (quality: "major" | "minor") =>
    soundsCompleteWrittenTones(chordToneSpellings(bass.pitch, quality).slice(0, 2), notes, bass);
  const seventh = ornamentId ? undefined : readWrittenDominantSeventh(frame.notes);
  if (declared) {
    if (written(declared)) return true;
    if (declared.structure.kind === "tertian" && !declared.structure.extensions.length &&
        !declared.structure.alterations.length && pitchClassEquals(declared.root, bass.pitch) &&
        pitchClassEquals(declared.bass, bass.pitch) &&
        (declared.structure.quality === "major" || declared.structure.quality === "minor")) {
      return rootAndThird(declared.structure.quality);
    }
    return !!seventh && declared.structure.kind === "tertian" &&
      declared.structure.quality === "dominant7" && !declared.structure.extensions.length &&
      !declared.structure.alterations.length && pitchClassEquals(seventh.root, declared.root) &&
      pitchClassEquals(bass.pitch, declared.bass);
  }

  if (seventh || hasCompleteWrittenTertianVoicing(notes.map(note => note.pitch)) ||
      (notes.length >= 3 && (rootAndThird("major") || rootAndThird("minor")))) return true;
  const inferred = frame.chord?.identity;
  if (inferred?.structure.kind === "augmented-sixth" && written(inferred)) return true;
  const key = localKey(context, frame) ?? frame.key;
  const root = scaleDegreePitchClass(key, 6, key.mode === "major" ? -1 : 0);
  if (!pitchClassEquals(bass.pitch, root)) return false;
  return (["italian", "french", "german", "doubleAugmented43"] as const).some(variant =>
    written({ root, bass: root, structure: { kind: "augmented-sixth", variant } }));
}

function hasPreparedOrPassingSupport(
  context: HarmonyRuleContext, frame: AnalysisSlice, movingVoice: VoiceId,
) {
  return upperVoices.some(voice => {
    const note = frame.notes[voice];
    if (voice === movingVoice || !note || (note.nonChordToneRole && note.nonChordToneRole !== "passing" &&
        note.nonChordToneRole !== "suspension" && note.nonChordToneRole !== "retardation")) return false;
    const nextTick = note.startTick + note.durationTicks;
    const after = context.sliceAt(nextTick);
    const resolved = after?.notes[voice];
    if (!after || !resolved || resolved.startTick !== nextTick ||
        crossesManualPhraseBoundary(context, note.startTick, nextTick) || !keyEquals(frame.key, after.key) ||
        !VOICE_ORDER.every(part => part === voice || frame.notes[part]?.id === after.notes[part]?.id) ||
        !supportsDiminishedMotionVoicing(context, after) ||
        !supportsDiminishedMotionVoicing(context, frame, note.id)) return false;
    const exit = writtenInterval(note.pitch, resolved.pitch);
    if (!isWrittenStep(exit) || Math.sign(exit.semitones) !== exit.diatonicSteps) return false;

    if (note.startTick < frame.tick && context.sliceAt(frame.tick - 1)?.notes[voice]?.id === note.id) {
      const preparation = context.sliceAt(note.startTick);
      return !!preparation && (!note.nonChordToneRole ||
        note.nonChordToneRole === (exit.semitones < 0 ? "suspension" : "retardation")) &&
        supportsDiminishedMotionVoicing(context, preparation);
    }
    const before = context.sliceAt(note.startTick - 1);
    const prior = before?.notes[voice];
    if (!before || !prior || !keyEquals(before.key, frame.key) ||
        crossesManualPhraseBoundary(context, before.tick, note.startTick) ||
        prior.startTick + prior.durationTicks !== note.startTick ||
        (note.nonChordToneRole && note.nonChordToneRole !== "passing") ||
        context.metric.compare(context.metric.positionAt(after.tick), context.metric.positionAt(note.startTick)) !== "stronger" ||
        !supportsDiminishedMotionVoicing(context, before)) return false;
    const entry = writtenInterval(prior.pitch, note.pitch);
    return isWrittenStep(entry) && entry.diatonicSteps === exit.diatonicSteps &&
      Math.sign(entry.semitones) === Math.sign(exit.semitones);
  });
}

function requiresSpecificDiminishedResolution(
  context: HarmonyRuleContext, motion: MelodyTransition, from: AnalysisSlice, to: AnalysisSlice, resolution: AnalysisSlice,
) {
  const { voiceId, previous, current, writtenInterval: leap } = motion;
  const bass = to.notes.bass;
  if (voiceId === "bass" || !bass) return false;

  // A possible minor cadential 6/4 after the raised fourth needs the full
  // German sixth resolution that B.4 already verifies.
  if (leap.diatonicSteps === -2 && leap.semitones === -2 &&
      pitchClassEquals(previous.pitch, bass.pitch) &&
      pitchClassEquals(current.pitch, scaleDegreePitchClass({ tonic: bass.pitch, mode: "major" }, 6, 1))) {
    const fifth = resolution.notes[voiceId]!.pitch;
    const tonic = scaleDegreePitchClass({ tonic: fifth, mode: "major" }, 4);
    const notes = Object.values(resolution.notes);
    if (chordToneSpellings(tonic, "minor").every(tone => notes.some(note => pitchClassEquals(note.pitch, tone)))) {
      return true;
    }
  }

  // The special bII7–V7 tritone belongs to the bass. It does not license
  // another part to leap between the two fifths in the same connection.
  const priorBass = from.notes.bass;
  if (Math.abs(leap.semitones) !== 6 || !priorBass || bass.startTick !== to.tick ||
      !pitchClassEquals(previous.pitch, chordToneSpellings(priorBass.pitch, "major")[2]) ||
      !pitchClassEquals(current.pitch, chordToneSpellings(bass.pitch, "major")[2])) return false;
  const bassLeap = context.melodyTransitions({ voiceId: "bass" }).first(transition => transition.current.id === bass.id);
  return !!bassLeap && isNeapolitanSeventhBassTritone(context, bassLeap);
}

/** B.4 and B.5 use the same evidence for a written diminished leap. */
export function resolvesDiminishedLeap(
  context: HarmonyRuleContext, motion: MelodyTransition, named: ReturnType<typeof intervalName>,
) {
  const { previous, current, voiceId } = motion;
  const leap = motion.writtenInterval;
  if (named.quality !== "减" || named.number < 3 || !motion.contiguous ||
      Math.sign(leap.semitones) !== Math.sign(leap.diatonicSteps)) return false;
  const end = current.startTick + current.durationTicks;
  const arrival = context.sliceAt(current.startTick);
  const resolution = context.sliceAt(end);
  const next = resolution?.notes[voiceId];
  if (!arrival || !resolution || !next || next.startTick !== end ||
      crossesManualPhraseBoundary(context, previous.startTick, end) ||
      context.analysis.project.keyEvents.some(event => previous.startTick < event.tick && event.tick <= end)) return false;
  const step = writtenInterval(current.pitch, next.pitch);
  if (!isWrittenStep(step) || step.diatonicSteps !== Math.sign(step.semitones) ||
      step.semitones * leap.semitones >= 0 || Math.abs(step.semitones) >= Math.abs(leap.semitones)) return false;

  if (context.slices({ overlapping: { fromTick: previous.startTick, toTick: end + 1 } })
    .all(frame => !frame.chord && !!frame.notes[voiceId] && Object.keys(frame.notes).length === 1)) {
    // Without accompaniment, multiple chromatic spellings need harmonic evidence.
    return [previous, current, next].filter(note =>
      !isDiatonicIn(arrival.key, note) && !pitchClassEquals(note.pitch, leadingTonePitchClass(arrival.key))).length <= 1;
  }

  const supported = (frame: AnalysisSlice) =>
    supportsDiminishedMotionVoicing(context, frame) || hasPreparedOrPassingSupport(context, frame, voiceId);
  const departure = context.sliceAt(current.startTick - 1);
  return !!departure && !requiresSpecificDiminishedResolution(context, motion, departure, arrival, resolution) &&
    supported(departure) && supported(resolution) &&
    context.slices({ overlapping: { fromTick: arrival.tick, toTick: end } }).all(frame =>
      (voiceId !== "bass" || !isRootPositionLeadingTriad(context, frame)) && supported(frame));
}

function hasSupportedDiminishedMotion(context: HarmonyRuleContext, motion: MelodyTransition) {
  return isMinorSixthChordBassLine(context, motion) ||
    isResolvedDominantSixthBass(context, motion) ||
    resolvesDominantSeventhEntry(context, motion) ||
    resolvesRaisedSecondApproach(context, motion) ||
    resolvesGermanSixthDiminishedThird(context, motion) ||
    isWrittenLowerNeighborMotion(context, motion);
}

function chromaticSpellingDiagnostic(
  context: HarmonyRuleContext,
  transition: MelodyTransition,
  named: ReturnType<typeof intervalName>,
  corrections: ReturnType<typeof chromaticPassingSpellingCorrections>,
): RuleDiagnostic | undefined {
  const { previous, current, voiceId } = transition;
  // An established chordal reading takes precedence over a conjectured passing note.
  const handoff = readDominantSeventhHandoffSpelling(context, transition);
  const structural = handoff ? undefined : readWrittenStructuralSpelling(context, transition);
  const spelling = handoff ?? structural;
  const correction = corrections.get(transition.id);
  if (!spelling && !correction) return;
  const notes = [previous, current];
  const evidence = [noteEvidence(previous, "前一音"), noteEvidence(current, "当前音")];
  const options = {
    melodyTransitionId: transition.id,
    params: { intervalNumber: named.number, quality: named.quality, semitones: 1 },
  };
  if (spelling) {
    const expected = [spelling.previous, spelling.current];
    const incorrect = notes.flatMap((note, i) => pitchClassEquals(note.pitch, expected[i])
      ? [] : [`${formatSpelledPitch(note.pitch)} 宜写为 ${formatPitchClass(expected[i])}`]);
    if (!incorrect.length) return;
    if (handoff) evidence.push(
      noteEvidence(handoff.resolvingSeventh, "另一声部的原七音"),
      noteEvidence(handoff.resolvedThird, "同次进行解决到新三音"),
    );
    return diagnostic(AUGMENTED, current.startTick, current.startTick + current.durationTicks,
      [voiceId], notes, "和声性半音的拼写", incorrect.join("，") + "。" + (structural?.reason ?? ""), {
        ...options, motionSameHarmony: handoff ? false : structural?.motionSameHarmony,
        messageKey: `${AUGMENTED}.structural-spelling`, evidence,
      });
  }
  if (!correction) return;
  evidence.push({ kind: "interval", label: "书写音程", value: named.label });
  return diagnostic(AUGMENTED, current.startTick, current.startTick + current.durationTicks,
    [voiceId], notes, "半音经过音的拼写",
    `单声部半音经过时，${formatSpelledPitch(correction.note.pitch)} 建议写为同音高的 ${formatSpelledPitch(correction.spelling)}。`, {
      ...options, motionSameHarmony: sameHarmonyAtMelodicAttack(context, current.startTick, voiceId),
      messageKey: `${AUGMENTED}.passing-spelling`, evidence,
    });
}

function alteredIntervalRule(context: HarmonyRuleContext, expectedQuality: "增" | "减") {
  const augmented = expectedQuality === "增";
  const ruleId = augmented ? AUGMENTED : "melody.diminished-interval";
  const diagnostics: RuleDiagnostic[] = [];
  const corrections = augmented ? chromaticPassingSpellingCorrections(context) : undefined;
  const chain = augmented ? undefined : halfDiminishedChainArrivals(context);
  for (const transition of context.melodyTransitions().where(item => item.contiguous)) {
    const { previous, current, voiceId, writtenInterval } = transition;
    const named = intervalName(writtenInterval);
    const semitones = Math.abs(writtenInterval.semitones);
    // §32: a chromatic alteration normally occurs in the same voice. Its mere
    // presence cannot diagnose a mistake, even when the harmony is unknown.
    if (corrections && semitones === 1 && named.quality !== "减") {
      const issue = chromaticSpellingDiagnostic(context, transition, named, corrections);
      if (issue) diagnostics.push(issue);
      continue;
    }
    if (named.quality !== expectedQuality || semitones === 0 ||
        isNeapolitanSeventhBassTritone(context, transition) ||
        chain?.has(current.id) || (!augmented && (resolvesDiminishedLeap(context, transition, named) ||
          hasSupportedDiminishedMotion(context, transition)))) continue;

    const attack = context.sliceAt(current.startTick);
    // The following 6→5 stays within V7. That internal continuity cannot
    // exempt a separate melodic leap into the proved start of this V7.
    const contextualDominantOnset = attack && attack.notes.bass?.startTick === attack.tick &&
      attack.notes.soprano?.startTick === attack.tick && resolvesContextualMinorDominantSixth(attack, context);
    diagnostics.push(diagnostic(ruleId, current.startTick, current.startTick + current.durationTicks,
      [voiceId], [previous, current], "旋律出现增减音程",
      `${voiceName(context.analysis, voiceId)}的 ${formatSpelledPitch(previous.pitch)} 到 ${formatSpelledPitch(current.pitch)} 构成${named.label}。`, {
        motionSameHarmony: contextualDominantOnset
          ? sameHarmonyAtMelodicAttack(context, current.startTick, voiceId) : undefined,
        messageKey: `${ruleId}.${named.quality}`,
        params: { intervalNumber: named.number, quality: named.quality, semitones },
        evidence: [noteEvidence(previous, "前一音"), noteEvidence(current, "当前音"),
          { kind: "interval", label: "书写音程", value: named.label }],
      }));
  }
  return diagnostics;
}

export function augmentedIntervalRule(context: HarmonyRuleContext) {
  return alteredIntervalRule(context, "增");
}

export function diminishedIntervalRule(context: HarmonyRuleContext) {
  return alteredIntervalRule(context, "减");
}

/** In two complete written V7 voicings, this leap takes over another part's seventh
 * (Liu & Liu, ch. 15 §4). The chord can genuinely remain the same. */
export function previousSeventhInTritoneTransfer(context: HarmonyRuleContext, melody: MelodyTransition) {
  const { voiceId, previous, current, writtenInterval } = melody;
  if (voiceId === "bass" || writtenInterval.diatonicSteps !== -3 || writtenInterval.semitones !== -6 ||
      crossesManualPhraseBoundary(context, previous.startTick, current.startTick)) return;

  const landing = context.sliceAt(current.startTick);
  const transition = landing && context.sliceTransitions({ toSliceIndex: landing.index }).first();
  if (!transition || !sameHarmonyOnTransition(transition, context.harmony)) return;
  const source = transition.previous;
  const target = transition.current;
  const chord = source.chord;
  if (!chord || chord.identity.structure.kind !== "tertian" ||
      chord.identity.structure.quality !== "dominant7" || chord.identity.structure.extensions.length ||
      chord.identity.structure.alterations.length ||
      source.notes[voiceId]?.id !== previous.id || target.notes[voiceId]?.id !== current.id ||
      !soundsDeclaredChord(source) || !soundsDeclaredChord(target)) return;

  const [, third, , seventh] = chordIdentityToneSpellings(chord.identity);
  if (!pitchClassEquals(previous.pitch, third) || !pitchClassEquals(current.pitch, seventh)) return;

  // Full SATB voicings with all four written members have only one seventh at each attack.
  return Object.values(source.notes).find(note =>
    pitchClassEquals(note.pitch, seventh) && note.startTick + note.durationTicks === current.startTick);
}
