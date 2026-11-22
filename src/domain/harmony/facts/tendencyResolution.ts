import {
  chordToneSpellings,
  type ChordQuality,
  type KeyReference,
  primaryHarmonyInterpretation,
} from "../../chordModel";
import {
  isWrittenStep,
  keyDeclarationEquals,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  stepIndex,
  toMidi,
  writtenInterval,
  type SpelledPitchClass,
  type KeyLike,
  keyEquals,
  leadingTonePitchClass,
} from "../../pitch";
import { VOICE_ORDER, type VoiceId } from "../../project";
import type { AnalysisSlice } from "../analysis";
import {
  soundsCompleteWrittenTones,
  hasCompleteWrittenTertianVoicing,
  soundsDeclaredChord,
} from "./writtenVoicing";
import type { NoteEvent } from "../../project/types";
import { compareMetricStrength, type MetricPosition } from "../../rhythm/metric";

export function hasWrittenVoicing(slice: Pick<AnalysisSlice, "notes" | "completeSatb">, tones: readonly SpelledPitchClass[]) {
  const bass = slice.notes.bass;
  return !!bass && slice.completeSatb && soundsCompleteWrittenTones(tones, Object.values(slice.notes), bass);
}

/** An absent label permits a written reading. A named chord must agree in spelling, bass and structure. */
export function allowsWrittenTertianIdentity(
  slice: Pick<AnalysisSlice, "chord" | "notes">, root: SpelledPitchClass, quality: ChordQuality,
) {
  const identity = slice.chord?.identity;
  if (!identity) return true;
  const { structure } = identity;
  const bass = slice.notes.bass;
  return !!bass && pitchClassEquals(identity.bass, bass.pitch) && pitchClassEquals(identity.root, root) &&
    structure.kind === "tertian" && structure.quality === quality &&
    !structure.extensions.length && !structure.alterations.length;
}

export function matchesWrittenChord(slice: AnalysisSlice, root: SpelledPitchClass, quality: ChordQuality) {
  return allowsWrittenTertianIdentity(slice, root, quality) && hasWrittenVoicing(slice, chordToneSpellings(root, quality));
}

type WrittenVoiceFrame = Pick<AnalysisSlice, "tick" | "notes">;

export function resolvesInVoice(source: WrittenVoiceFrame, target: WrittenVoiceFrame, voice: VoiceId,
  destination: SpelledPitchClass, direction: -1 | 1) {
  const from = source.notes[voice], to = target.notes[voice];
  if (!from || !to || from.startTick + from.durationTicks !== target.tick || to.startTick !== target.tick ||
      !pitchClassEquals(to.pitch, destination)) return false;
  const step = writtenInterval(from.pitch, to.pitch);
  return step.diatonicSteps === direction &&
    (step.semitones === direction || (direction === -1 && step.semitones === -2));
}

export function resolvesMaskedStep(
  from: WrittenVoiceFrame, to: WrittenVoiceFrame, voice: VoiceId, expectedFrom: SpelledPitchClass,
  destination: SpelledPitchClass, semitones: -1 | 1,
) {
  const start = from.notes[voice]!, end = to.notes[voice]!;
  return !start.nonChordToneRole && !end.nonChordToneRole && start.startTick + start.durationTicks === to.tick &&
    end.startTick === to.tick && pitchClassEquals(end.pitch, destination) &&
    (stepIndex(destination.step) - stepIndex(expectedFrom.step) + 7) % 7 === (semitones + 7) % 7 &&
    toMidi(end.pitch) - toMidi(start.pitch) === semitones;
}

export function keepsWrittenMember(from: WrittenVoiceFrame, to: WrittenVoiceFrame, voice: VoiceId) {
  const start = from.notes[voice]!, end = to.notes[voice]!;
  return !start.nonChordToneRole && !end.nonChordToneRole && spelledPitchEquals(start.pitch, end.pitch) &&
    (start.id === end.id || (start.startTick + start.durationTicks === to.tick && end.startTick === to.tick));
}

export function respeltDegrees(key: KeyReference) {
  return {
    tonic: key.tonic,
    tonicThird: scaleDegreePitchClass(key, 3),
    raisedSecond: scaleDegreePitchClass(key, 2, 1),
    raisedFourth: scaleDegreePitchClass(key, 4, 1),
    sixth: scaleDegreePitchClass(key, 6),
    dominant: scaleDegreePitchClass(key, 5),
  };
}

type WrittenResolutionFrame = Pick<AnalysisSlice, "tick" | "endTick" | "notes" | "completeSatb">;
type KeyedResolutionFrame = WrittenResolutionFrame & Pick<AnalysisSlice, "key">;

// Spasobin §28, ex. 28-423/427. The leading seventh of V may write its
// seventh as ♯II in root position or first inversion before K64.
function doubleDominantWindow<T extends WrittenResolutionFrame>(
  source: T, following: Iterable<T>, key: KeyReference,
) {
  if (key.mode !== "major" || !source.completeSatb) return;
  const { tonic, tonicThird, raisedSecond, raisedFourth, sixth, dominant } = respeltDegrees(key);
  const bass = source.notes.bass!.pitch;
  if (!pitchClassEquals(bass, raisedFourth) && !pitchClassEquals(bass, sixth)) return;

  const loweredThird = scaleDegreePitchClass(key, 3, -1);
  const voiceId = VOICE_ORDER.find(voice => {
    const pitch = source.notes[voice]!.pitch;
    return pitchClassEquals(pitch, loweredThird) || pitchClassEquals(pitch, raisedSecond);
  });
  if (!voiceId || !hasWrittenVoicing(source, [raisedFourth, sixth, tonic, source.notes[voiceId]!.pitch])) return;

  let previous = source;
  const arrivalTicks = new Map<VoiceId, number>();
  for (const target of following) {
    if (!target.completeSatb || previous.endTick !== target.tick) return;
    const lowest = toMidi(target.notes.bass!.pitch);
    for (const voice of VOICE_ORDER) {
      const note = target.notes[voice]!;
      if (note.nonChordToneRole || toMidi(note.pitch) < lowest) return;
      if (keepsWrittenMember(previous, target, voice)) continue;
      const original = source.notes[voice]!.pitch;
      if (arrivalTicks.has(voice) || pitchClassEquals(original, tonic)) return;
      const resolves = voice === voiceId
        ? resolvesMaskedStep(previous, target, voice, raisedSecond, tonicThird, 1)
        : resolvesInVoice(previous, target, voice, dominant, pitchClassEquals(original, raisedFourth) ? 1 : -1);
      if (!resolves) return;
      arrivalTicks.set(voice, target.tick);
    }
    if (arrivalTicks.size === 3) {
      if (pitchClassEquals(target.notes.bass!.pitch, dominant) && hasWrittenVoicing(target, [tonic, tonicThird, dominant]))
        return { voiceId, previous: raisedSecond, current: tonicThird, landing: target, arrivalTicks };
      return;
    }
    previous = target;
  }
}

export function writtenDoubleDominantResolution(
  source: WrittenResolutionFrame, target: WrittenResolutionFrame, key: KeyReference,
) {
  const result = doubleDominantWindow(source, [target], key);
  if (result) return { voiceId: result.voiceId, previous: result.previous, current: result.current };
}

function* withinWrittenPhrase<T extends KeyedResolutionFrame>(
  source: T, following: Iterable<T>, manualBoundaries: readonly number[],
) {
  let previous = source;
  for (const frame of following) {
    if (previous.endTick !== frame.tick || !keyDeclarationEquals(source.key, frame.key) ||
        manualBoundaries.some(tick => previous.tick < tick && tick <= frame.tick)) return;
    yield frame;
    previous = frame;
  }
}

/** Start with the complete departure and stop at the first complete arrival.
 * A voice can reattack its original pitch or its arrival in the same register. */
export function writtenDoubleDominantWindow<T extends KeyedResolutionFrame>(
  source: T, following: Iterable<T>, key: KeyReference, manualBoundaries: readonly number[],
) {
  return doubleDominantWindow(source, withinWrittenPhrase(source, following, manualBoundaries), key);
}

/** Recognize an unlabelled cadential six-four by its written arrival on V
 * and the fourth's resolution. The voicing may redistribute during the 64. */
export function writtenCadentialSixFourExit<T extends KeyedResolutionFrame>(
  landing: T, following: Iterable<T>, key: KeyReference, manualBoundaries: readonly number[],
) {
  const { tonic, tonicThird, dominant } = respeltDegrees(key);
  const triad = [tonic, tonicThird, dominant];
  const bass = landing.notes.bass;
  if (!bass || !pitchClassEquals(bass.pitch, dominant) || !hasWrittenVoicing(landing, triad)) return;
  const [root, third, fifth, seventh] = chordToneSpellings(dominant, "dominant7");
  let previous = landing;
  for (const frame of withinWrittenPhrase(landing, following, manualBoundaries)) {
    const low = frame.notes.bass;
    if (!low || !pitchClassEquals(low.pitch, dominant)) return;
    if (spelledPitchEquals(low.pitch, bass.pitch) && hasWrittenVoicing(frame, triad)) {
      previous = frame;
      continue;
    }
    if ((hasWrittenVoicing(frame, [root, third, fifth]) ||
         hasWrittenVoicing(frame, [root, third, fifth, seventh]) ||
         (hasWrittenVoicing(frame, [root, third, seventh]) &&
          VOICE_ORDER.filter(voice => pitchClassEquals(frame.notes[voice]!.pitch, root)).length === 2)) &&
        VOICE_ORDER.some(voice => pitchClassEquals(previous.notes[voice]!.pitch, tonic) &&
          resolvesInVoice(previous, frame, voice, third, -1))) return frame;
    return;
  }
}

/** §22.3: the leading seventh's root and third rise, while its fifth and seventh
 * descend. The two middle members meet on the third of the receiving tonic. */
export function resolvesLeadingSeventhToDoubledThird(
  source: WrittenResolutionFrame, target: WrittenResolutionFrame,
  sourceTones: readonly SpelledPitchClass[], tonicTones: readonly SpelledPitchClass[],
) {
  const destinations = [tonicTones[0], tonicTones[1], tonicTones[1], tonicTones[2]];
  return VOICE_ORDER.every(voice => {
    const from = source.notes[voice], to = target.notes[voice];
    if (!from || !to || from.startTick + from.durationTicks !== source.endTick || to.startTick !== source.endTick) return false;
    const member = sourceTones.findIndex(tone => pitchClassEquals(from.pitch, tone));
    if (member < 0 || !pitchClassEquals(to.pitch, destinations[member])) return false;
    const motion = writtenInterval(from.pitch, to.pitch);
    return isWrittenStep(motion) && motion.diatonicSteps === (member < 2 ? 1 : -1);
  });
}

/** §32.4c. A doubled chromatically altered degree leaves in contrary stepwise motion. */
export function doublesMoveAgainstAlteration(
  before: Pick<AnalysisSlice, "notes">, after: Pick<AnalysisSlice, "notes">,
  alteredVoice: VoiceId, unalteredTone: SpelledPitchClass, semitones: number,
) {
  return VOICE_ORDER.every(voice => {
    const from = before.notes[voice];
    if (voice === alteredVoice || !from || !pitchClassEquals(from.pitch, unalteredTone)) return true;
    const to = after.notes[voice];
    if (!to) return false;
    const motion = writtenInterval(from.pitch, to.pitch);
    return motion.diatonicSteps === -semitones && Math.sign(motion.semitones) === -semitones &&
      Math.abs(motion.semitones) <= 2;
  });
}

type SoundingNote = Readonly<Pick<NoteEvent, "id" | "pitch" | "startTick" | "durationTicks">>;
type SoundingVoices = Readonly<Partial<Record<VoiceId, SoundingNote>>>;

export interface PreparedSuspensionSlice {
  readonly fromTick: number;
  readonly toTick: number;
  readonly notes: SoundingVoices;
}

/** Report what the caller knows about harmony, separately from the score. */
export type PreparationSupport = "confirmed" | "surface" | "blocked";

interface PreparedSuspensionInput {
  readonly slices: readonly PreparedSuspensionSlice[];
  readonly onsetIndex: number;
  readonly key: KeyLike;
  readonly beatTicks: number;
  readonly metricAt: (tick: number) => MetricPosition | undefined;
  readonly preparationAt: (index: number, singleNinth: boolean) => PreparationSupport;
}

interface SuspensionMotion {
  readonly voiceId: VoiceId;
  readonly noteId: string;
  readonly resolutionNoteId: string;
  readonly figure: "4-3" | "9-8";
}

function findSoundedPreparation(
  { slices, onsetIndex, beatTicks, metricAt, preparationAt }: PreparedSuspensionInput,
  onsetTick: number,
  duration: number,
  motions: readonly SuspensionMotion[],
  singleNinth: boolean,
) {
  const prepBass = slices[onsetIndex - 1]?.notes.bass;
  if (!prepBass) return;

  let coveredFrom = onsetTick;
  let lastConfirmedEnd: number | undefined;
  const surfaceVoicings: SoundingNote[][] = [];
  for (let index = onsetIndex - 1; index >= 0; index--) {
    const slice = slices[index];
    const notes = Object.values(slice.notes).filter(note => note !== undefined);
    if (slice.toTick !== coveredFrom || notes.length !== VOICE_ORDER.length ||
        slice.notes.bass?.id !== prepBass.id ||
        !motions.every(({ voiceId, noteId }) => slice.notes[voiceId]?.id === noteId)) return;

    const support = preparationAt(index, singleNinth);
    if (singleNinth && (support !== "confirmed" || notes.some(note => note.startTick > onsetTick - duration))) return;
    const pitches = notes.map(note => note.pitch);
    const tertian = hasCompleteWrittenTertianVoicing(pitches);
    if (support === "blocked") return;
    if (support === "surface") {
      // Use the actual attack, even if a chord label split this voicing.
      const attack = Math.max(...notes.map(note => note.startTick));
      if (lastConfirmedEnd !== undefined || tertian || onsetTick - slice.fromTick > beatTicks ||
          metricAt(attack)?.role !== "subdivision") return;
      surfaceVoicings.push(notes);
    } else {
      if (!tertian) return;
      // A surface change can count toward the preparation while the
      // established harmony still sounds under one changed voice.
      if (lastConfirmedEnd === undefined) {
        if (surfaceVoicings.some(voicing => voicing.filter(note =>
          !pitches.some(pitch => pitchClassEquals(pitch, note.pitch)),
        ).length > 1)) return;
        lastConfirmedEnd = slice.toTick;
      }
      if (onsetTick - slice.fromTick >= duration) {
        return { preparationIndex: index, preparationSurfaceTicks: onsetTick - lastConfirmedEnd };
      }
    }
    coveredFrom = slice.fromTick;
  }
}

/** Check a complete root-position major/minor triad in its actual register. */
function soundedRootTriad(notes: SoundingVoices, bass: SoundingNote) {
  const pitches = VOICE_ORDER.map(voice => notes[voice]!.pitch);
  if (pitches.some(pitch => toMidi(pitch) < toMidi(bass.pitch))) return false;
  return (["major", "minor"] as const).some(quality => {
    const tones = chordToneSpellings(bass.pitch, quality);
    return tones.every(tone => pitches.some(pitch => pitchClassEquals(pitch, tone))) &&
      pitches.every(pitch => tones.some(tone => pitchClassEquals(pitch, tone)));
  });
}

/** Verify a prepared tonic 4–3 (possibly doubled by 9–8), or one 9–8
 * resolving into a complete written root-position triad. Durations are measured between real note events, even when
 * the caller's timeline includes cuts introduced by chord annotations. */
export function verifyPreparedSuspensionVoicing(input: PreparedSuspensionInput) {
  const { slices, onsetIndex, key, beatTicks, metricAt } = input;
  const onset = slices[onsetIndex];
  const bass = onset?.notes.bass;
  const beforeBass = slices[onsetIndex - 1]?.notes.bass;
  if (!onset || !bass || !beforeBass || bass.startTick !== onset.fromTick ||
      pitchClassEquals(bass.pitch, beforeBass.pitch)) return;
  const active = Object.values(onset.notes).filter(note => note !== undefined);
  if (active.length !== VOICE_ORDER.length ||
      hasCompleteWrittenTertianVoicing(active.map(note => note.pitch))) return;

  const fromTick = onset.fromTick;
  const toTick = Math.min(...active.map(note => note.startTick + note.durationTicks));
  const duration = toTick - fromTick;
  const accent = metricAt(fromTick);
  if (duration <= 0 || duration > beatTicks || (accent?.level ?? 0) < 2 ||
      compareMetricStrength(accent, metricAt(toTick)) !== "stronger") return;

  let tick = fromTick;
  let resolutionIndex = onsetIndex;
  while (tick < toTick) {
    const slice = slices[resolutionIndex];
    if (!slice || slice.fromTick !== tick || slice.toTick <= tick || slice.toTick > toTick ||
        VOICE_ORDER.some(voice => slice.notes[voice]?.id !== onset.notes[voice]?.id)) return;
    tick = slice.toTick;
    resolutionIndex++;
  }
  const resolution = slices[resolutionIndex];
  if (resolution?.fromTick !== toTick || resolution.notes.bass?.id !== bass.id) return;

  const motions: SuspensionMotion[] = [];
  const heldVoiceIds: VoiceId[] = [];
  const rearticulatedVoiceIds: VoiceId[] = [];
  for (const voiceId of VOICE_ORDER) {
    const note = onset.notes[voiceId]!;
    const landing = resolution.notes[voiceId];
    if (!landing) return;
    if (spelledPitchEquals(note.pitch, landing.pitch)) {
      (note.id === landing.id ? heldVoiceIds : rearticulatedVoiceIds).push(voiceId);
      continue;
    }
    const descent = writtenInterval(note.pitch, landing.pitch);
    if (voiceId === "bass" || note.startTick >= fromTick || note.startTick + note.durationTicks !== toTick ||
        landing.startTick !== toTick || !isWrittenStep(descent) ||
        descent.diatonicSteps !== -1 || descent.semitones >= 0) return;

    const steps = writtenInterval(bass.pitch, note.pitch).diatonicSteps;
    const isFourth = pitchClassEquals(bass.pitch, key.tonic) && steps >= 3 && steps % 7 === 3 &&
      pitchClassEquals(note.pitch, scaleDegreePitchClass(key, 4)) &&
      pitchClassEquals(landing.pitch, scaleDegreePitchClass(key, 3));
    const isNinth = steps >= 8 && steps % 7 === 1 &&
      pitchClassEquals(landing.pitch, bass.pitch);
    if (!isFourth && !isNinth) return;
    motions.push({ voiceId, noteId: note.id, resolutionNoteId: landing.id, figure: isFourth ? "4-3" : "9-8" });
  }
  const singleNinth = motions.length === 1 && motions[0].figure === "9-8";
  if (singleNinth) {
    if (rearticulatedVoiceIds.length || !soundedRootTriad(resolution.notes, bass)) return;
  } else if (motions.length > 2 || motions.filter(motion => motion.figure === "4-3").length !== 1 ||
      motions.some(m => m.figure === "9-8" && !pitchClassEquals(onset.notes[m.voiceId]!.pitch, scaleDegreePitchClass(key, 2)))) return;

  const preparation = findSoundedPreparation(input, fromTick, duration, motions, singleNinth);
  if (!preparation) return;
  return { fromTick, toTick, singleNinth, ...preparation, resolutionIndex, motions, heldVoiceIds, rearticulatedVoiceIds };
}

export type RaisedFifthFrame = Pick<AnalysisSlice, "tick" | "endTick" | "notes" | "key" | "completeSatb" | "chord">;

/** Spasobin §46.4: in root position V7(#5), the raised fifth and the seventh
 * approach the major tonic third from opposite sides. Both parts keep it. */
export function resolvesRaisedFifthToDoubledThird(source: RaisedFifthFrame, landing: RaisedFifthFrame, tonic: SpelledPitchClass) {
  const localMajor = { tonic, mode: "major" } as const;
  const root = scaleDegreePitchClass(localMajor, 5);
  const [, leading, , seventh] = chordToneSpellings(root, "dominant7");
  const raisedFifth = scaleDegreePitchClass(localMajor, 2, 1);
  const tonicThird = scaleDegreePitchClass(localMajor, 3);
  const target = landing.chord?.identity;
  if (source.endTick !== landing.tick || source.key.id !== landing.key.id ||
      !hasWrittenVoicing(source, [root, leading, raisedFifth, seventh]) ||
      !hasWrittenVoicing(landing, [tonic, tonicThird]) ||
      !pitchClassEquals(source.notes.bass!.pitch, root) || !pitchClassEquals(landing.notes.bass!.pitch, tonic) ||
      (source.chord && (!pitchClassEquals(source.chord.identity.root, root) || !soundsDeclaredChord(source))) ||
      (target && (!pitchClassEquals(target.root, tonic) || !pitchClassEquals(target.bass, tonic) ||
        target.structure.kind !== "tertian" || target.structure.quality !== "major" ||
        target.structure.extensions.length || target.structure.alterations.length))) return false;

  return VOICE_ORDER.every(voice => {
    const from = source.notes[voice]!;
    if (voice === "bass") {
      const to = landing.notes.bass!;
      const leap = writtenInterval(from.pitch, to.pitch);
      return from.startTick + from.durationTicks === landing.tick && to.startTick === landing.tick &&
        (leap.semitones === 5 || leap.semitones === -7);
    }
    if (pitchClassEquals(from.pitch, leading)) return resolvesInVoice(source, landing, voice, tonic, 1);
    return resolvesInVoice(source, landing, voice, tonicThird, pitchClassEquals(from.pitch, seventh) ? -1 : 1);
  });
}

function inWrittenKey(slice: AnalysisSlice, key: AnalysisSlice["key"]) {
  const reading = slice.chord?.semantics && primaryHarmonyInterpretation(slice.chord.semantics);
  const local = reading?.localKey ?? slice.key;
  return slice.key.id === key.id && !reading?.appliedTarget && keyEquals(local, key);
}

/** Spasobin §22.3, example 22-303: the leading-tone seventh in third
 * inversion may resolve to a third-doubled tonic 6/4 on the way to ii6. */
export function resolvesLeadingSeventhToPassingTonic(
  source: AnalysisSlice, tonic: AnalysisSlice, destination: AnalysisSlice,
) {
  const key = tonic.key;
  if (source.endTick !== tonic.tick || tonic.endTick !== destination.tick ||
      ![source, tonic, destination].every(slice => inWrittenKey(slice, key))) return false;

  const tonicQuality = key.mode === "major" ? "major" : "minor";
  const tonicTones = chordToneSpellings(key.tonic, tonicQuality);
  const leading = leadingTonePitchClass(key);
  const supertonic = scaleDegreePitchClass(key, 2);
  if (!matchesWrittenChord(tonic, key.tonic, tonicQuality) ||
      !matchesWrittenChord(destination, supertonic, key.mode === "major" ? "minor" : "diminished") ||
      !pitchClassEquals(tonic.notes.bass!.pitch, tonicTones[2]) ||
      !resolvesInVoice(tonic, destination, "bass", scaleDegreePitchClass(key, 4), -1)) return false;

  const qualities = ["diminished7", "halfDiminished7"] as const;
  const quality = qualities.find(value => matchesWrittenChord(source, leading, value));
  if (!quality) return false;
  const sourceTones = chordToneSpellings(leading, quality);
  if (!pitchClassEquals(source.notes.bass!.pitch, sourceTones[3])) return false;

  return resolvesLeadingSeventhToDoubledThird(source, tonic, sourceTones, tonicTones);
}
