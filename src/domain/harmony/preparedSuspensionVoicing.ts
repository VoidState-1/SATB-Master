import { chordToneSpellings } from "../chordModel";
import { isWrittenStep, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval, type KeyLike } from "../pitch";
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
