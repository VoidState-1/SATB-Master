import {
  chordToneSpellings, QUALITY_INTERVALS, type ChordQuality,
} from "../../../chordModel";
import {
  leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass,
  spelledPitchEquals, stepIndex, toMidi, writtenInterval, type SpelledPitchClass,
} from "../../../pitch";
import { VOICE_ORDER, type VoiceId } from "../../../project";
import type { AnalysisSlice, MelodyTransition } from "../../analysis";
import { doublesMoveAgainstAlteration } from "../../writtenResolution";
import { agreedMember, agreesWithExplicitIdentity, completeVoicings, type CompletedVoicing } from "../helpers/maskedChordSpelling";
import type { HarmonyRuleContext } from "../context/createRuleContext";

const tertianQualities = Object.keys(QUALITY_INTERVALS) as ChordQuality[];
const dominantQualities = ["major", "dominant7", "halfDiminished7", "diminished7"] as const;
const tonicQualities = ["major", "minor"] as const;
const letter = (index: number) => ((index % 7) + 7) % 7;

// A chromatic ornament over three stationary pitches can spell a different
// chord by itself. Require a real attack by another sounding chord member
// before using the masked voice to supply a member missing in the peers.
function hasPeerAttack(
  context: HarmonyRuleContext, frame: AnalysisSlice, masked: VoiceId, tick: number, requireUnmarked = false,
) {
  const onset = context.sliceAt(tick), before = context.sliceAt(tick - 1);
  const voices = VOICE_ORDER.filter(voice => voice !== masked &&
    (!requireUnmarked || !frame.notes[voice]?.nonChordToneRole));
  const on = voices.flatMap(voice => onset?.notes[voice]?.pitch ?? []);
  const off = voices.flatMap(voice => before?.notes[voice]?.pitch ?? []);
  const differs = on.some(pitch => !off.some(other => pitchClassEquals(pitch, other))) ||
    off.some(pitch => !on.some(other => pitchClassEquals(pitch, other)));
  return differs && voices.some(voice => {
    const now = onset?.notes[voice], then = before?.notes[voice];
    return !!now && now.startTick === tick && now.id === frame.notes[voice]?.id &&
      (!then || !pitchClassEquals(now.pitch, then.pitch));
  });
}

function movesInto(middle: AnalysisSlice, target: AnalysisSlice, voice: VoiceId, requireUnmarked = false) {
  const from = middle.notes[voice], to = target.notes[voice];
  if (!from || !to || from.startTick + from.durationTicks !== target.tick || to.startTick !== target.tick ||
      (requireUnmarked && (from.nonChordToneRole || to.nonChordToneRole))) return;
  return { from: from.pitch, to: to.pitch };
}

function supportsTonic(
  middle: AnalysisSlice, target: AnalysisSlice, masked: VoiceId, chord: CompletedVoicing, tonic: SpelledPitchClass,
  requireUnmarked = false,
) {
  const key = { tonic, mode: "major" } as const;
  const leading = leadingTonePitchClass(key);
  const root = chord.quality === "major" || chord.quality === "dominant7"
    ? scaleDegreePitchClass(key, 5)
    : leading;
  if (!pitchClassEquals(chord.root, root)) return false;
  return VOICE_ORDER.some(voice => {
    const motion = movesInto(middle, target, voice, requireUnmarked);
    if (!motion || !pitchClassEquals(voice === masked ? chord.member : motion.from, leading) ||
        !pitchClassEquals(motion.to, tonic) || toMidi(motion.to) - toMidi(motion.from) !== 1) return false;
    if (voice !== masked) return true;
    // Do not infer a function solely from the inspected voice's semitone.
    return VOICE_ORDER.some(peer => {
      if (peer === masked) return false;
      const support = movesInto(middle, target, peer, requireUnmarked);
      if (!support) return false;
      const step = writtenInterval(support.from, support.to);
      return Math.abs(step.diatonicSteps) === 1 && Math.abs(step.semitones) >= 1 && Math.abs(step.semitones) <= 2;
    });
  });
}

function resolvesSeventh(
  context: HarmonyRuleContext, middle: AnalysisSlice, target: AnalysisSlice,
  masked: VoiceId, chord: CompletedVoicing, goal: CompletedVoicing, requireUnmarked = false,
) {
  const seventh = chordToneSpellings(chord.root, chord.quality)[3];
  if (!seventh) return true;
  const voice = VOICE_ORDER.find(id =>
    pitchClassEquals(id === masked ? chord.member : middle.notes[id]!.pitch, seventh));
  if (!voice) return false;
  const key = { tonic: goal.root, mode: goal.quality === "minor" ? "minor" : "major" } as const;
  const next = target.notes[voice]!, sounding = context.sliceAt(target.tick - 1)?.notes[voice];
  if (!pitchClassEquals(next.pitch, scaleDegreePitchClass(key, chord.quality === "dominant7" ? 3 : 5))) return false;

  // The seventh can settle early while another voice completes the cadence.
  const landing = sounding && spelledPitchEquals(sounding.pitch, next.pitch) ? sounding : next;
  const source = context.sliceAt(landing.startTick - 1)?.notes[voice];
  const initial = middle.notes[voice]!;
  if (landing.startTick <= middle.tick || !source || source.startTick + source.durationTicks !== landing.startTick ||
      (requireUnmarked && (initial.nonChordToneRole || source.nonChordToneRole ||
        landing.nonChordToneRole || next.nonChordToneRole)) ||
      toMidi(source.pitch) !== toMidi(initial.pitch) ||
      !pitchClassEquals(voice === masked && source.id === initial.id ? chord.member : source.pitch, seventh)) return false;
  const distance = toMidi(landing.pitch) - toMidi(source.pitch);
  return letter(stepIndex(seventh.step) - 1) === stepIndex(landing.pitch.step) && (distance === -1 || distance === -2);
}

function resolvesCheckedLeadingFifth(
  middle: AnalysisSlice, target: AnalysisSlice, masked: VoiceId, chord: CompletedVoicing, goal: CompletedVoicing,
  requireUnmarked = false,
) {
  if (chord.quality !== "halfDiminished7" && chord.quality !== "diminished7") return true;
  const fifth = chordToneSpellings(chord.root, chord.quality)[2];
  if (!pitchClassEquals(chord.member, fifth)) return true;
  const motion = movesInto(middle, target, masked, requireUnmarked);
  if (!motion || !pitchClassEquals(motion.to, chordToneSpellings(goal.root, goal.quality)[1])) return false;
  const distance = toMidi(motion.to) - toMidi(motion.from);
  return letter(stepIndex(fifth.step) - 1) === stepIndex(motion.to.step) && (distance === -1 || distance === -2);
}

function hasUnmarkedMembers(
  context: HarmonyRuleContext, frame: AnalysisSlice, masked: VoiceId, voicing: CompletedVoicing, attackTick?: number,
) {
  const note = frame.notes[masked], bass = frame.notes.bass;
  if (!note || !bass || bass.nonChordToneRole || (attackTick !== undefined && note.nonChordToneRole)) return false;
  const peers = VOICE_ORDER.flatMap(voice => {
    const peer = frame.notes[voice];
    return voice !== masked && peer && !peer.nonChordToneRole ? [peer.pitch] : [];
  });
  const missing = chordToneSpellings(voicing.root, voicing.quality)
    .filter(tone => !peers.some(pitch => pitchClassEquals(tone, pitch)));
  if (!missing.length) return true;
  return !note.nonChordToneRole && missing.length === 1 && pitchClassEquals(voicing.member, missing[0]) &&
    (attackTick === undefined || hasPeerAttack(context, frame, masked, attackTick, true));
}

// Spasobin §§32.2, 32.4: the sounding local tonic and the actual tendency-tone
// resolutions establish spelling without using inferred chord labels.
export function readWrittenDominantSpelling(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { previous, current, voiceId } = transition;
  if (!transition.contiguous || !transition.sameKey || Math.abs(toMidi(current.pitch) - toMidi(previous.pitch)) !== 1) return;
  const start = current.startTick;
  const end = start + current.durationTicks;
  const before = context.sliceAt(start - 1), middle = context.sliceAt(start), target = context.sliceAt(end);
  if (!before || !middle || !target || target.tick !== end ||
      before.notes[voiceId]?.id !== previous.id || middle.notes[voiceId]?.id !== current.id ||
      target.notes[voiceId]?.startTick !== end || before.key.id !== middle.key.id || middle.key.id !== target.key.id ||
      context.analysis.phraseBoundaries.some(boundary => !boundary.stale && previous.startTick < boundary.tick && boundary.tick <= end)) return;

  const goals = completeVoicings(target, voiceId, tonicQualities)
    .filter(chord => pitchClassEquals(chord.member, target.notes[voiceId]!.pitch));
  if (!goals.length) return;
  const atAttack = completeVoicings(middle, voiceId, dominantQualities,
    { canSupplyMissingMember: hasPeerAttack(context, middle, voiceId, start) });
  const resolvesToTonic = (chord: CompletedVoicing, goal: CompletedVoicing, requireUnmarked = false) =>
    supportsTonic(middle, target, voiceId, chord, goal.root, requireUnmarked) &&
    resolvesSeventh(context, middle, target, voiceId, chord, goal, requireUnmarked) &&
    resolvesCheckedLeadingFifth(middle, target, voiceId, chord, goal, requireUnmarked);
  const connections = atAttack.flatMap(chord => goals.filter(goal => resolvesToTonic(chord, goal))
    .map(goal => ({ chord, goal })));
  const currentMember = agreedMember(connections.map(connection => connection.chord));
  if (!currentMember) return;

  const antecedents = completeVoicings(before, voiceId, tertianQualities,
    { canSupplyMissingMember: hasPeerAttack(context, before, voiceId, previous.startTick) });
  const previousMember = agreedMember(antecedents);
  if (previousMember?.step !== currentMember.step ||
      !doublesMoveAgainstAlteration(before, middle, voiceId, previousMember, transition.writtenInterval.semitones)) return;

  // Roles and explicit identities can veto a witness after spelling agrees.
  // Neither can make the acoustic readings agree in the first place.
  const trackLocked = context.analysis.project.chordTrack.locked;
  if (!antecedents.some(chord => hasUnmarkedMembers(context, before, voiceId, chord, previous.startTick) &&
        agreesWithExplicitIdentity(before, voiceId, chord, trackLocked)) ||
      !connections.some(({ chord, goal }) =>
        hasUnmarkedMembers(context, middle, voiceId, chord, start) &&
        hasUnmarkedMembers(context, target, voiceId, goal) &&
        resolvesToTonic(chord, goal, true) &&
        agreesWithExplicitIdentity(middle, voiceId, chord, trackLocked) &&
        agreesWithExplicitIdentity(target, voiceId, goal, trackLocked))) return;

  return { previous: previousMember, current: currentMember };
}
