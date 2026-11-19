import { chordIdentityToneSpellings } from "../../../chordModel";
import {
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  writtenInterval,
  type KeyLike,
  type SpelledPitchClass,
} from "../../../pitch";
import type { AnalysisNote, AnalysisSlice, MelodyTransition } from "../../analysis";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { activeNotes } from "../helpers/core";

const scaleDegrees = [1, 2, 3, 4, 5, 6, 7] as const;

function sameKey(left: KeyLike, right: KeyLike) {
  return left.mode === right.mode && pitchClassEquals(left.tonic, right.tonic);
}

function exactlyVoiced(slice: AnalysisSlice, tones: readonly SpelledPitchClass[]) {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass) return false;
  const notes = activeNotes(slice);
  const bassMidi = toMidi(bass.pitch);
  return notes.every(({ voiceId, note }) =>
    !note.nonChordToneRole &&
    (voiceId === "bass" || toMidi(note.pitch) > bassMidi) &&
    tones.some(tone => pitchClassEquals(note.pitch, tone)),
  ) &&
    tones.every(tone => notes.some(({ note }) => pitchClassEquals(note.pitch, tone)));
}

function hasPreparation(context: HarmonyRuleContext, before: AnalysisSlice, key: KeyLike) {
  const reading = before.chord && context.harmony.primaryInterpretation(before.chord);
  if (reading?.status === "resolved" && reading.value.localKey &&
      !sameKey(reading.value.localKey, key)) return false;

  // Check that the unaltered scale degree belonged to a sounded diatonic
  // triad. The preceding chord's label is not evidence for this pitch.
  const scale = scaleDegrees.map(degree => scaleDegreePitchClass(key, degree));
  return scale.some((root, index) =>
    exactlyVoiced(before, [root, scale[(index + 2) % 7], scale[(index + 4) % 7]]),
  );
}

function hasLanding(context: HarmonyRuleContext, slice: AnalysisSlice, key: KeyLike) {
  const chord = slice.chord;
  if (!chord || chord.startTick !== slice.tick || !slice.notes.bass) return false;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" ||
      !sameKey(reading.value.localKey ?? slice.key, key) ||
      reading.value.appliedTarget || reading.value.degreeAlteration !== 0) return false;

  const { identity, semantics } = chord;
  const { structure } = identity;
  const dominant = scaleDegreePitchClass(key, 5);
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length ||
      !pitchClassEquals(identity.bass, dominant) || !pitchClassEquals(slice.notes.bass.pitch, dominant) ||
      !exactlyVoiced(slice, chordIdentityToneSpellings(identity))) return false;

  const { degree, designation } = reading.value;
  const role = semantics?.cadenceRole;
  if (role === "cadential64" || (role === undefined && designation?.kind === "cadential64")) {
    return degree === 1 && structure.quality === key.mode &&
      (!designation || designation.kind === "cadential64" ||
        (designation.kind === "primary" && designation.primaryFunction === "tonic")) &&
      pitchClassEquals(identity.root, key.tonic);
  }
  return role === undefined && degree === 5 &&
    (!designation || (designation.kind === "primary" && designation.primaryFunction === "dominant")) &&
    structure.quality === "major" && pitchClassEquals(identity.root, dominant);
}

function resolvesEndpoint(
  previous: AnalysisNote,
  current: AnalysisNote,
  dominant: SpelledPitchClass,
  direction: 1 | -1,
) {
  const motion = writtenInterval(previous.pitch, current.pitch);
  return current.startTick === previous.startTick + previous.durationTicks &&
    pitchClassEquals(current.pitch, dominant) &&
    motion.diatonicSteps === direction && motion.semitones === direction;
}

/** 斯波索宾第 30 章 §§2–4，例 30-451、452、456、458。
 * 只核对无和弦标注处的旋律增一度及两端点的实际解决。 */
export function recognizesAugmentedSixthPreparation(
  context: HarmonyRuleContext,
  transition: MelodyTransition,
): boolean {
  const { previous, current, voiceId, writtenInterval: entry } = transition;
  if (!transition.contiguous || !transition.sameKey || entry.diatonicSteps !== 0 ||
      Math.abs(entry.semitones) !== 1 || previous.nonChordToneRole || current.nonChordToneRole) return false;

  const onset = current.startTick;
  const arrival = onset + current.durationTicks;
  const before = context.sliceAt(onset - 1);
  const middle = context.sliceAt(onset);
  const landing = context.sliceAt(arrival);
  if (!before || !middle?.completeSatb || middle.chord || !landing?.completeSatb ||
      before.notes[voiceId]?.id !== previous.id || middle.notes[voiceId]?.id !== current.id) return false;
  const key = middle.key;
  if (!sameKey(before.key, key) || !sameKey(landing.key, key) ||
      context.analysis.project.keyEvents.some(event =>
        event.tick > previous.startTick && event.tick <= arrival && !sameKey(event, key)) ||
      context.analysis.phraseBoundaries.some(boundary =>
        !boundary.stale && boundary.tick > previous.startTick && boundary.tick <= arrival)) return false;

  const major = { tonic: key.tonic, mode: "major" } as const;
  const loweredSixth = scaleDegreePitchClass(major, 6, -1);
  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const dominant = scaleDegreePitchClass(key, 5);
  const sounding = activeNotes(middle);
  const highCandidates = sounding.filter(({ note }) => pitchClassEquals(note.pitch, raisedFourth));
  if (highCandidates.length !== 1 || !pitchClassEquals(middle.notes.bass!.pitch, loweredSixth)) return false;
  const [upperEnd] = highCandidates;

  const preparingHigh = voiceId === upperEnd.voiceId && entry.semitones === 1 &&
    pitchClassEquals(previous.pitch, scaleDegreePitchClass(key, 4));
  const preparingLow = voiceId === "bass" && key.mode === "major" && entry.semitones === -1 &&
    pitchClassEquals(previous.pitch, scaleDegreePitchClass(major, 6));
  if (!preparingHigh && !preparingLow) return false;

  const tones = chordIdentityToneSpellings({
    root: loweredSixth,
    bass: loweredSixth,
    structure: { kind: "augmented-sixth", variant: "italian" },
  });
  if (!exactlyVoiced(middle, tones) || sounding.filter(({ note }) =>
    pitchClassEquals(note.pitch, key.tonic)).length !== 2) return false;

  // Cover the whole unidentified span. Accept rearticulations of the other
  // parts only while they continue to supply the same written voicing.
  if (context.slices({ overlapping: { fromTick: onset, toTick: arrival } }).any(slice =>
    slice.chord !== undefined || sounding.some(({ voiceId, note }) => {
      const sustained = slice.notes[voiceId];
      return !sustained || sustained.nonChordToneRole || !context.pitch.sameWrittenPitch(note, sustained);
    }),
  )) return false;

  const ending = context.sliceAt(arrival - 1)!;
  return hasPreparation(context, before, key) && hasLanding(context, landing, key) &&
    resolvesEndpoint(ending.notes.bass!, landing.notes.bass!, dominant, -1) &&
    resolvesEndpoint(ending.notes[upperEnd.voiceId]!, landing.notes[upperEnd.voiceId]!, dominant, 1);
}
