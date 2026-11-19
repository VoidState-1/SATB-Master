import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, writtenInterval, type KeyLike } from "../pitch";
import type { NoteEvent, VoiceId } from "../project/types";
import { VOICE_ORDER } from "../project/voice";
import { compareMetricStrength, type MetricPosition } from "../rhythm/metric";
import { hasCompleteWrittenTertianVoicing } from "./writtenTertian";

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
  readonly preparationAt: (index: number) => PreparationSupport;
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

    const support = preparationAt(index);
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

/** Verify a synchronous 4–3, optionally with a 9–8, over a newly attacked
 * tonic bass. Durations are measured between real note events, even when
 * the caller's timeline includes cuts introduced by chord annotations. */
export function verifyPreparedSuspensionVoicing(input: PreparedSuspensionInput) {
  const { slices, onsetIndex, key, beatTicks, metricAt } = input;
  const onset = slices[onsetIndex];
  const bass = onset?.notes.bass;
  const beforeBass = slices[onsetIndex - 1]?.notes.bass;
  if (!onset || !bass || !beforeBass || bass.startTick !== onset.fromTick ||
      !pitchClassEquals(bass.pitch, key.tonic) || pitchClassEquals(bass.pitch, beforeBass.pitch)) return;
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
    const isFourth = steps >= 3 && steps % 7 === 3 &&
      pitchClassEquals(note.pitch, scaleDegreePitchClass(key, 4)) &&
      pitchClassEquals(landing.pitch, scaleDegreePitchClass(key, 3));
    const isNinth = steps >= 8 && steps % 7 === 1 &&
      pitchClassEquals(note.pitch, scaleDegreePitchClass(key, 2)) &&
      pitchClassEquals(landing.pitch, key.tonic);
    if (!isFourth && !isNinth) return;
    motions.push({ voiceId, noteId: note.id, resolutionNoteId: landing.id, figure: isFourth ? "4-3" : "9-8" });
  }
  if (motions.length > 2 || motions.filter(motion => motion.figure === "4-3").length !== 1) return;

  const preparation = findSoundedPreparation(input, fromTick, duration, motions);
  if (!preparation) return;
  return { fromTick, toTick, ...preparation, resolutionIndex, motions, heldVoiceIds, rearticulatedVoiceIds };
}
