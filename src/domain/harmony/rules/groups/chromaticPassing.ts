import { chordIdentityEquals, chordIdentityToneSpellings, chordToneSpellings, type ChordIdentity, type KeyReference } from "../../../chordModel";
import { keyEquals, enharmonicSpellings, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, stepIndex, toMidi, writtenInterval, type SpelledPitchClass } from "../../../pitch";
import { VOICE_ORDER, type VoiceId } from "../../../project";
import { sameChordIdentityWithoutBass, type AnalysisNote, type AnalysisSlice, type MelodyTransition } from "../../analysis";
import { hasCompleteWrittenTertianVoicing } from "../../writtenTertian";
import { readCompleteWrittenChord, soundsCompleteWrittenChord, soundsDeclaredChord } from "../../writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { hasInsertedChromaticResolution } from "./insertedChromaticResolution";
import { hasExactPitch } from "../helpers/core";
import { hasWrittenVoicing, matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";

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
