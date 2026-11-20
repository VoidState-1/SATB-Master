import { chordToneSpellings, QUALITY_INTERVALS, type ChordQuality } from "../../../chordModel";
import {
  keyEquals, pitchClassEquals, spelledPitchEquals, stepIndex, toMidi, type SpelledPitchClass,
} from "../../../pitch";
import { VOICE_ORDER, type VoiceId } from "../../../project";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import { keyAtTick } from "../../segments";
import { doublesMoveAgainstAlteration } from "../../writtenResolution";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { agreedMember, agreesWithExplicitIdentity, completeVoicings } from "./maskedChordSpelling";

const tertianQualities = Object.keys(QUALITY_INTERVALS) as ChordQuality[];

export function crossesWrittenBoundary(context: HarmonyRuleContext, from: number, to: number) {
  const { project, phraseBoundaries } = context.analysis;
  const initial = keyAtTick(project.keyEvents, from);
  return project.keyEvents.some(event => from < event.tick && event.tick <= to && !keyEquals(initial, event)) ||
    phraseBoundaries.some(boundary => !boundary.stale && from < boundary.tick && boundary.tick <= to);
}

export function unmarkedChordMembers(
  frame: AnalysisSlice, masked: VoiceId, member: SpelledPitchClass, tones: readonly SpelledPitchClass[],
  requireMasked = false,
) {
  const bass = frame.notes.bass;
  if (!bass || bass.nonChordToneRole || (requireMasked && frame.notes[masked]?.nonChordToneRole)) return false;
  return tones.every(tone => VOICE_ORDER.some(voice => {
    const note = frame.notes[voice];
    return note && !note.nonChordToneRole && pitchClassEquals(voice === masked ? member : note.pitch, tone);
  }));
}

export function readMaskedPreparation(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, voiceId } = motion;
  const entry = motion.writtenInterval.semitones;
  if (!motion.contiguous || !motion.sameKey || Math.abs(entry) !== 1 || previous.nonChordToneRole ||
      current.nonChordToneRole) return;
  const start = current.startTick, end = start + current.durationTicks;
  const before = context.sliceAt(start - 1), middle = context.sliceAt(start), target = context.sliceAt(end);
  if (!before?.completeSatb || !middle?.completeSatb || !target?.completeSatb ||
      before.notes[voiceId]?.id !== previous.id || middle.notes[voiceId]?.id !== current.id ||
      target.tick !== end || target.notes[voiceId]?.startTick !== end ||
      crossesWrittenBoundary(context, previous.startTick, end)) return;

  // The chromatic event must coincide with an independent change of written pitch.
  if (!VOICE_ORDER.some(voice => voice !== voiceId && middle.notes[voice]!.startTick === start &&
      !middle.notes[voice]!.nonChordToneRole &&
      !pitchClassEquals(before.notes[voice]!.pitch, middle.notes[voice]!.pitch))) return;

  const antecedents = completeVoicings(before, voiceId, tertianQualities);
  const source = agreedMember(antecedents);
  const trackLocked = context.analysis.project.chordTrack.locked;
  if (!source || !doublesMoveAgainstAlteration(before, middle, voiceId, source, entry) ||
      !antecedents.some(chord => unmarkedChordMembers(before, voiceId, source,
        chordToneSpellings(chord.root, chord.quality), true) &&
        agreesWithExplicitIdentity(before, voiceId, chord, trackLocked))) return;
  return { voiceId, source, middle, target, trackLocked };
}

export function writtenMemberAt(
  frame: AnalysisSlice, voice: VoiceId, masked: VoiceId, member: SpelledPitchClass,
) {
  return voice === masked ? member : frame.notes[voice]!.pitch;
}

export function resolvesMaskedStep(
  from: AnalysisSlice, to: AnalysisSlice, voice: VoiceId, expectedFrom: SpelledPitchClass,
  destination: SpelledPitchClass, semitones: -1 | 1,
) {
  const start = from.notes[voice]!, end = to.notes[voice]!;
  return !start.nonChordToneRole && !end.nonChordToneRole && start.startTick + start.durationTicks === to.tick &&
    end.startTick === to.tick && pitchClassEquals(end.pitch, destination) &&
    (stepIndex(destination.step) - stepIndex(expectedFrom.step) + 7) % 7 === (semitones + 7) % 7 &&
    toMidi(end.pitch) - toMidi(start.pitch) === semitones;
}

export function keepsWrittenMember(from: AnalysisSlice, to: AnalysisSlice, voice: VoiceId) {
  const start = from.notes[voice]!, end = to.notes[voice]!;
  return !start.nonChordToneRole && !end.nonChordToneRole && spelledPitchEquals(start.pitch, end.pitch) &&
    (start.id === end.id || (start.startTick + start.durationTicks === to.tick && end.startTick === to.tick));
}
