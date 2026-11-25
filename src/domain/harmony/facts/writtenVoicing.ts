import {
  chordIdentityToneSpellings,
  chordToneSpellings,
  primaryHarmonyInterpretation,
  QUALITY_INTERVALS,
  type ChordIdentity,
  type ChordQuality,
} from "../../chordModel";
import {
  pitchClassEquals,
  spelledPitchEquals,
  writtenInterval,
  toMidi,
  type SpelledPitchClass,
  normalizePitchClassNumber,
  pitchClassValue,
  stepIndex,
} from "../../pitch";
import type { VoiceId } from "../../project/types";
import { VOICE_ORDER } from "../../project/voice";
import type { AnalysisNote, AnalysisSlice, ProjectSnapshot } from "../analysis";
import {
  belongsToWrittenHarmony, createWrittenOrnamentReader, type OrnamentalFrame, type WrittenOrnament,
} from "./ornamentalMotion";

type WrittenVoicingNote = Pick<AnalysisNote, "pitch" | "nonChordToneRole"> & Partial<Pick<AnalysisNote, "id">>;

/** Check sounding members and explicit roles independently of register. */
export function soundsCompleteWrittenMembers(
  tones: readonly SpelledPitchClass[], notes: readonly WrittenVoicingNote[], passingNoteId?: string,
) {
  return notes.every(note => (!note.nonChordToneRole || (passingNoteId !== undefined &&
    note.id === passingNoteId && note.nonChordToneRole === "passing")) &&
    tones.some(tone => pitchClassEquals(tone, note.pitch))) &&
    tones.every(tone => notes.some(note => pitchClassEquals(note.pitch, tone)));
}

/** Check the actual bass register, every sounding note and every required spelling. */
export function soundsCompleteWrittenTones(
  tones: readonly SpelledPitchClass[], notes: readonly WrittenVoicingNote[], bass: Pick<WrittenVoicingNote, "pitch">, passingNoteId?: string,
) {
  const lowest = toMidi(bass.pitch);
  return notes.every(note => toMidi(note.pitch) >= lowest) &&
    soundsCompleteWrittenMembers(tones, notes, passingNoteId);
}

export function soundsCompleteWrittenChord(
  identity: ChordIdentity, notes: readonly WrittenVoicingNote[], bass: Pick<WrittenVoicingNote, "pitch">, passingNoteId?: string,
) {
  return pitchClassEquals(bass.pitch, identity.bass) &&
    soundsCompleteWrittenTones(chordIdentityToneSpellings(identity), notes, bass, passingNoteId);
}

export function soundsDeclaredChord(slice: Pick<AnalysisSlice, "chord" | "completeSatb" | "notes">) {
  return !!slice.chord && slice.completeSatb && !!slice.notes.bass &&
    soundsCompleteWrittenChord(slice.chord.identity, Object.values(slice.notes), slice.notes.bass);
}

/** Exact spelling and register with caller-selected roles that are
 * consonant in this frame. The underlying note event is never rewritten. */
export function soundsWrittenMemberSet(
  slice: Pick<AnalysisSlice, "completeSatb" | "notes">,
  allowed: readonly SpelledPitchClass[],
  required: readonly SpelledPitchClass[] = allowed,
) {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass) return false;
  const notes = Object.values(slice.notes);
  return notes.every(note => toMidi(note.pitch) >= toMidi(bass.pitch) &&
    allowed.some(tone => pitchClassEquals(note.pitch, tone))) &&
    required.every(tone => notes.some(note => pitchClassEquals(note.pitch, tone)));
}

const writtenQualities = Object.keys(QUALITY_INTERVALS) as ChordQuality[];

export function readCompleteWrittenChord(slice: AnalysisSlice): ChordIdentity | undefined {
  if (slice.chord) return soundsDeclaredChord(slice) ? slice.chord.identity : undefined;
  return readSoundingTertianIdentity(slice);
}

/** Recover a complete triad or seventh from the written pitches, even if a label disagrees. */
export function readSoundingTertianIdentity(
  slice: Pick<AnalysisSlice, "completeSatb" | "notes">, allowPreparedConsonance = false,
): ChordIdentity | undefined {
  const bass = slice.notes.bass;
  if (!slice.completeSatb || !bass) return;
  const notes = Object.values(slice.notes).map(note => allowPreparedConsonance &&
    (note.nonChordToneRole === "suspension" || note.nonChordToneRole === "retardation")
    ? { ...note, nonChordToneRole: undefined } : note);
  for (const { pitch: root } of notes) {
    for (const quality of writtenQualities) {
      if (soundsCompleteWrittenTones(chordToneSpellings(root, quality), notes, bass)) {
        return {
          root: { step: root.step, alter: root.alter },
          bass: { step: bass.pitch.step, alter: bass.pitch.alter },
          structure: { kind: "tertian", quality, extensions: [], alterations: [] },
        };
      }
    }
  }
}

/** Recognize a complete written triad or seventh, including readings
 * outside the local functional catalogue. */
export function hasCompleteWrittenTertianVoicing(pitches: readonly SpelledPitchClass[]) {
  const bySound = new Map<number, SpelledPitchClass>();
  for (const pitch of pitches) {
    const sound = pitchClassValue(pitch);
    const previous = bySound.get(sound);
    if (previous && !pitchClassEquals(previous, pitch)) return false;
    bySound.set(sound, pitch);
  }
  const distinct = [...bySound.values()];
  if (distinct.length !== 3 && distinct.length !== 4) return false;

  return distinct.some(root => {
    let current = root;
    for (let degree = 1; degree < distinct.length; degree++) {
      const nextStep = (stepIndex(current.step) + 2) % 7;
      const next = distinct.find(pitch => stepIndex(pitch.step) === nextStep);
      if (!next) return false;
      const third = normalizePitchClassNumber(pitchClassValue(next) - pitchClassValue(current));
      if (third !== 3 && third !== 4) return false;
      current = next;
    }
    return true;
  });
}

export interface StructuralVoice {
  readonly voice: VoiceId;
  readonly sounding: AnalysisNote;
  readonly structural: AnalysisNote;
  readonly ornament?: WrittenOrnament;
}

export interface StructuralVoicing {
  readonly voices: readonly StructuralVoice[];
  readonly bass?: StructuralVoice;
  readonly unresolved: readonly VoiceId[];
  readonly missing: readonly SpelledPitchClass[];
}

/** Keep the surface untouched. Rank proven, same-voice endpoints by member
 * coverage, rejecting restorations that put another voice below the bass. */
export function createStructuralVoicingReader(
  frames: readonly OrnamentalFrame[], cuts: readonly number[], maxMotionTicks: number,
) {
  const ornamentAt = createWrittenOrnamentReader(frames, cuts, maxMotionTicks);
  const byTick = new Map(frames.map((frame, index) => [frame.tick, index]));
  return (index: number, identity: ChordIdentity): StructuralVoicing | undefined => {
    const frame = frames[index];
    if (!frame?.completeSatb) return;
    const tones = chordIdentityToneSpellings(identity);
    const surface = VOICE_ORDER.map(voice => frame.notes[voice]!);
    if (surface.every(note => !note.nonChordToneRole) &&
        hasCompleteWrittenTertianVoicing(surface.map(note => note.pitch))) return;
    const options: StructuralVoice[][] = [];
    const unresolved: VoiceId[] = [];
    let retained = 0;
    for (const voice of VOICE_ORDER) {
      const sounding = frame.notes[voice]!;
      if (belongsToWrittenHarmony(identity, voice, sounding) &&
          (!sounding.nonChordToneRole || sounding.nonChordToneRole === "suspension" ||
            sounding.nonChordToneRole === "retardation")) {
        options.push([{ voice, sounding, structural: sounding }]);
        retained++;
        continue;
      }
      const ornament = ornamentAt(index, voice, identity);
      const approaches = ornament?.role === "passing" || ornament?.role === "neighbor";
      const endpoints = ornament
        ? (approaches ? [ornament.departure, ornament.arrival] : [ornament.arrival])
          .map(point => point.note)
          .filter((note, i, list) => belongsToWrittenHarmony(identity, voice, note) &&
            !list.slice(0, i).some(other => spelledPitchEquals(other.pitch, note.pitch)))
        : [];
      if (endpoints.length) {
        options.push(endpoints.map(structural => ({ voice, sounding, structural, ornament })));
      } else {
        unresolved.push(voice);
      }
    }
    if (!retained || !options.some(voices => voices[0].ornament)) return;

    const motions = options.flatMap(choices => choices[0].ornament ? [choices[0].ornament] : []);
    if ((motions.length === 3 && motions.every(motion => motion.role === "neighbor" || motion.role === "passing")) ||
        motions.some(motion => hasWrittenPerfectParallel(frames, byTick, motion))) return;
    let best: StructuralVoicing | undefined;
    const choose = (i: number, voices: readonly StructuralVoice[]) => {
      if (i < options.length) {
        for (const item of options[i]) choose(i + 1, [...voices, item]);
        return;
      }
      const bass = voices.find(item => item.voice === "bass");
      if (bass && voices.some(item => toMidi(item.structural.pitch) < toMidi(bass.structural.pitch))) return;
      const missing = tones.filter(tone => !voices.some(item => pitchClassEquals(tone, item.structural.pitch)));
      if (!best || missing.length < best.missing.length) best = { voices, bass, unresolved, missing };
    };
    choose(0, []);
    return best;
  };
}

/** An ornament projection must not hide the sounding parallel motion of
 * its own voice. Rules still analyze all sounding voice pairs independently. */
function hasWrittenPerfectParallel(
  frames: readonly OrnamentalFrame[], indices: ReadonlyMap<number, number>, motion: WrittenOrnament,
) {
  const perfect = (first: AnalysisNote, second: AnalysisNote) => {
    const interval = writtenInterval(first.pitch, second.pitch);
    const semitones = Math.abs(interval.semitones) % 12, steps = Math.abs(interval.diatonicSteps) % 7;
    return steps === 4 && semitones === 7 ? 5 : steps === 0 && semitones === 0 ? 8 : 0;
  };
  const events = new Set(motion.ornaments.map(note => note.id));
  return motion.crossedSliceTicks.some(tick => {
    const i = indices.get(tick)!;
    const before = frames[i - 1]?.notes, after = frames[i].notes;
    const from = before?.[motion.voice], to = after[motion.voice];
    if (!from || !to || (!events.has(from.id) && !events.has(to.id)) || toMidi(from.pitch) === toMidi(to.pitch)) return false;
    return VOICE_ORDER.some(voice => {
      if (voice === motion.voice) return false;
      const left = before[voice], right = after[voice];
      if (!left || !right || toMidi(left.pitch) === toMidi(right.pitch)) return false;
      const interval = perfect(from, left);
      return interval !== 0 && interval === perfect(to, right);
    });
  });
}

export function createSliceStructuralVoicingReader(
  slices: readonly AnalysisSlice[], project: ProjectSnapshot,
  metricAt: (tick: number) => OrnamentalFrame["metric"],
) {
  const cuts = [
    ...project.structure.phraseBoundaries.filter(boundary => boundary.source === "manual").map(boundary => boundary.tick),
    ...project.keyEvents.map(event => event.tick),
  ];
  const frames = slices.map(slice => {
    const identity = slice.chord?.identity ?? readSoundingTertianIdentity(slice, true);
    return {
      ...slice, identities: identity ? [identity] : [],
      harmonyRegionId: slice.chord?.id, metric: metricAt(slice.tick),
      harmonicKey: slice.chord?.semantics && primaryHarmonyInterpretation(slice.chord.semantics).localKey,
    };
  });
  return createStructuralVoicingReader(frames, cuts, 2 * project.ppq);
}
