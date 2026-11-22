import {
  chordToneSpellings,
  QUALITY_INTERVALS,
  type ChordQuality,
  chordIdentityToneSpellings,
  type KeyReference,
} from "../../../../chordModel";
import {
  leadingTonePitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  stepIndex,
  toMidi,
  writtenInterval,
  type SpelledPitchClass,
  keyEquals,
  type KeyLike,
} from "../../../../pitch";
import type { VoiceId } from "../../../../project/types";
import { VOICE_ORDER } from "../../../../project/voice";
import { type AnalysisSlice, type MelodyTransition, sameChordIdentityWithoutBass } from "../../../analysis";
import { readDominantSeventhExchange, movesToWrittenTone } from "../../../facts/dominantMotion";
import { doublesMoveAgainstAlteration } from "../../../facts/tendencyResolution";
import { soundsCompleteWrittenChord } from "../../../facts/writtenVoicing";
import type { RuleStepContext } from "../../../runtime";
import type { HarmonyRuleContext } from "../../context/createRuleContext";
import {
  agreedMember,
  agreesWithExplicitIdentity,
  completeVoicings,
  type CompletedVoicing,
  readDoubleDominantResolution,
  supportsBassTriad,
} from "../../helpers/chordVoicing";
import { crossesWrittenBoundary, activeNotes, crossesManualPhraseBoundary } from "../../helpers/core";
import {
  keepsWrittenMember,
  readMaskedPreparation,
  resolvesMaskedStep,
  unmarkedChordMembers,
  writtenMemberAt,
} from "../../helpers/motionHarmony";
import { writtenSeventhHandoff } from "../../state/seventhState";
import { readWrittenAugmentedSixthSpelling } from "./augmentedSixth";

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

function completeWrittenChord(
  frame: AnalysisSlice, root: SpelledPitchClass, qualities: readonly ("major" | "dominant7")[],
) {
  return completeVoicings(frame, "bass", qualities).find(chord =>
    pitchClassEquals(chord.root, root) && pitchClassEquals(chord.member, frame.notes.bass!.pitch));
}

function hasLocalMajorConfirmation(
  context: HarmonyRuleContext, landing: AnalysisSlice, tonic: SpelledPitchClass, trackLocked: boolean,
) {
  const key = { tonic, mode: "major" } as const;
  const dominant = scaleDegreePitchClass(key, 5);
  const leading = scaleDegreePitchClass(key, 7);
  const tonicTones = chordToneSpellings(tonic, "major");
  const dominantTriad = chordToneSpellings(dominant, "major");
  const limit = landing.tick + 12 * context.analysis.project.ppq;
  let repeated = false;
  // A foreign I64 is ambiguous by itself. Require another written I64 and a later
  // bass V–I with another voice resolving the written leading tone in place.
  for (const frame of context.slices({ overlapping: { fromTick: landing.tick + 1, toTick: limit } })) {
    if (frame.tick <= landing.tick) continue;
    if (crossesWrittenBoundary(context, landing.tick, frame.tick)) break;
    if (!frame.completeSatb || !frame.attackVoiceIds.length) continue;
    const bass = frame.notes.bass!;
    if (bass.nonChordToneRole || !pitchClassEquals(bass.pitch, dominant)) continue;
    const echo = completeWrittenChord(frame, tonic, ["major"]);
    if (echo && unmarkedChordMembers(frame, "bass", echo.member, tonicTones) &&
        agreesWithExplicitIdentity(frame, "bass", echo, trackLocked)) repeated = true;
    if (!repeated) continue;
    const approach = completeWrittenChord(frame, dominant, ["major", "dominant7"]);
    if (!approach || !unmarkedChordMembers(frame, "bass", approach.member, dominantTriad) ||
        !agreesWithExplicitIdentity(frame, "bass", approach, trackLocked)) continue;
    const arrivalTick = bass.startTick + bass.durationTicks;
    if (arrivalTick >= limit || crossesWrittenBoundary(context, frame.tick, arrivalTick)) continue;
    const arrival = context.sliceAt(arrivalTick);
    if (!arrival?.completeSatb || arrival.tick !== arrivalTick) continue;
    const newBass = arrival.notes.bass!;
    if (newBass.startTick !== arrivalTick || newBass.nonChordToneRole || !pitchClassEquals(newBass.pitch, tonic)) continue;
    if (!VOICE_ORDER.every(voice =>
      tonicTones.some(tone => pitchClassEquals(tone, arrival.notes[voice]!.pitch)))) continue;
    // Only the actually written root and third are needed at the confirming arrival.
    // A fifth is still mandatory in both complete voicings used above.
    if (!VOICE_ORDER.some(voice => !arrival.notes[voice]!.nonChordToneRole &&
          pitchClassEquals(arrival.notes[voice]!.pitch, tonicTones[1])) ||
        !agreesWithExplicitIdentity(arrival, "bass", { root: tonic, quality: "major", member: tonic }, trackLocked)) continue;
    const immediatelyBefore = context.sliceAt(arrivalTick - 1);
    if (!immediatelyBefore?.completeSatb) continue;
    const finalApproach = completeWrittenChord(immediatelyBefore, dominant, ["major", "dominant7"]);
    if (!finalApproach || !unmarkedChordMembers(immediatelyBefore, "bass", finalApproach.member, dominantTriad) ||
        !agreesWithExplicitIdentity(immediatelyBefore, "bass", finalApproach, trackLocked)) continue;
    if (VOICE_ORDER.some(voice => voice !== "bass" &&
          pitchClassEquals(immediatelyBefore.notes[voice]!.pitch, leading) &&
          resolvesMaskedStep(immediatelyBefore, arrival, voice, leading, tonic, 1))) return true;
  }
  return false;
}

function supertonicTendencies(
  middle: AnalysisSlice, target: AnalysisSlice, voiceId: VoiceId, chord: CompletedVoicing,
  tonic: SpelledPitchClass, toTonicSixFour: boolean,
) {
  const key = { tonic, mode: "major" } as const;
  const dominant = scaleDegreePitchClass(key, 5);
  if (!resolvesMaskedStep(middle, target, voiceId, chord.member, dominant, -1)) return false;
  const seventh = VOICE_ORDER.find(voice => pitchClassEquals(
    writtenMemberAt(middle, voice, voiceId, chord.member), tonic));
  if (!seventh) return false;
  if (!toTonicSixFour) {
    return resolvesMaskedStep(middle, target, seventh, tonic, scaleDegreePitchClass(key, 7), -1);
  }
  if (seventh === "bass" || !keepsWrittenMember(middle, target, seventh)) return false;
  const fourth = scaleDegreePitchClass(key, 4);
  return VOICE_ORDER.some(voice => pitchClassEquals(writtenMemberAt(middle, voice, voiceId, chord.member), fourth) &&
    resolvesMaskedStep(middle, target, voice, fourth, scaleDegreePitchClass(key, 3), -1));
}

// Spasobin §21: the lowered fifth descends to scale degree 5. The seventh
// descends into V, or stays in the same voice when the third descends into I64.
export function readWrittenSupertonicSpelling(context: HarmonyRuleContext, motion: MelodyTransition) {
  if (motion.voiceId === "bass" || motion.writtenInterval.semitones !== -1) return;
  const prep = readMaskedPreparation(context, motion);
  if (!prep || prep.middle.key.mode !== "major") return;
  const { voiceId, source, middle, target, trackLocked } = prep;
  const goals = completeVoicings(target, voiceId, ["major"]).filter(goal =>
    pitchClassEquals(goal.member, target.notes[voiceId]!.pitch));
  const candidates = completeVoicings(middle, voiceId, ["halfDiminished7"]);
  for (const goal of goals) {
    const bass = target.notes.bass!.pitch;
    const goalTones = chordToneSpellings(goal.root, goal.quality);
    const toTonicSixFour = pitchClassEquals(bass, goalTones[2]);
    if (!toTonicSixFour && !pitchClassEquals(bass, goal.root)) continue;
    const tonic = toTonicSixFour ? goal.root : scaleDegreePitchClass({ tonic: goal.root, mode: "major" }, 4);
    const key = { tonic, mode: "major" } as const;
    const home = pitchClassEquals(tonic, middle.key.tonic);
    if ((!toTonicSixFour && !home) || !pitchClassEquals(source, scaleDegreePitchClass(key, 6))) continue;
    const chord = candidates.find(candidate => pitchClassEquals(candidate.root, scaleDegreePitchClass(key, 2)) &&
      pitchClassEquals(candidate.member, scaleDegreePitchClass(key, 6, -1)));
    if (!chord || !supertonicTendencies(middle, target, voiceId, chord, tonic, toTonicSixFour) ||
        !unmarkedChordMembers(middle, voiceId, chord.member, chordToneSpellings(chord.root, chord.quality), true) ||
        !unmarkedChordMembers(target, voiceId, goal.member, goalTones, true) ||
        !agreesWithExplicitIdentity(middle, voiceId, chord, trackLocked) ||
        !agreesWithExplicitIdentity(target, voiceId, goal, trackLocked) ||
        (!home && !hasLocalMajorConfirmation(context, target, tonic, trackLocked))) continue;
    return { previous: source, current: chord.member };
  }
}

/** Establish both sevenths at the actual chromatic attack, independently of the inspected spelling. */
export function readDominantSeventhHandoffSpelling(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { previous, current, voiceId } = transition;
  const tick = current.startTick;
  if (!transition.contiguous || !transition.sameKey || toMidi(current.pitch) - toMidi(previous.pitch) !== -1) return;
  const before = context.sliceAt(tick - 1), after = context.sliceAt(tick);
  if (!before || !after || after.tick !== tick || before.key.id !== after.key.id ||
      before.notes[voiceId]?.id !== previous.id || after.notes[voiceId]?.id !== current.id ||
      [before, after].some(frame => VOICE_ORDER.some(voice => frame.notes[voice]?.nonChordToneRole)) ||
      context.analysis.phraseBoundaries.some(boundary => !boundary.stale && boundary.tick === tick)) return;

  const options = { allowOmittedDominantFifth: true };
  const left = completeVoicings(before, voiceId, ["dominant7"], options);
  const right = completeVoicings(after, voiceId, ["dominant7"], options);
  const links = left.flatMap(source => {
    const exchange = readDominantSeventhExchange(before, after, voiceId, source.root);
    if (!exchange || !pitchClassEquals(source.member, exchange.third)) return [];
    return right.filter(target => pitchClassEquals(target.root, exchange.nextRoot) &&
      pitchClassEquals(target.member, exchange.nextSeventh)).map(target => ({ source, target, exchange }));
  });
  const previousMember = agreedMember(links.map(link => link.source));
  const currentMember = agreedMember(links.map(link => link.target));
  if (!previousMember || !currentMember) return;
  const trackLocked = context.analysis.project.chordTrack.locked;
  const link = links.find(({ source, target }) =>
    agreesWithExplicitIdentity(before, voiceId, source, trackLocked) &&
    agreesWithExplicitIdentity(after, voiceId, target, trackLocked));
  if (!link) return;
  return {
    previous: previousMember, current: currentMember,
    resolvingSeventh: link.exchange.resolvingSeventh, resolvedThird: link.exchange.resolvedThird,
  };
}

interface StructuralSpelling {
  previous: SpelledPitchClass;
  current: SpelledPitchClass;
  motionSameHarmony?: false;
  reason?: string;
}

function readResolvingSeventhSpelling(context: HarmonyRuleContext, transition: MelodyTransition): StructuralSpelling | undefined {
  if (transition.voiceId === "bass" || transition.writtenInterval.semitones !== 1) return;
  const tick = transition.current.startTick;
  const source = context.sliceAt(tick - 1), target = context.sliceAt(tick);
  if (!source || !target) return;
  const resolution = readDoubleDominantResolution(context, source, target);
  if (resolution?.voiceId === transition.voiceId) return {
    ...resolution,
    motionSameHarmony: false,
    reason: "此处重属导减七和弦进入 K46，升Ⅱ级在原声部上行解决到Ⅲ级。",
  };
}

export function readWrittenStructuralSpelling(context: HarmonyRuleContext, transition: MelodyTransition): StructuralSpelling | undefined {
  const readings = [
    readResolvingSeventhSpelling(context, transition),
    readWrittenDominantSpelling(context, transition),
    readWrittenAugmentedSixthSpelling(context, transition),
    readWrittenSupertonicSpelling(context, transition),
  ].filter(reading => reading !== undefined);
  const first = readings[0];
  if (first && readings.every(reading =>
    pitchClassEquals(reading.previous, first.previous) && pitchClassEquals(reading.current, first.current))) return first;
}

function readHalfDiminishedSlot(slice: AnalysisSlice) {
  if (!slice.completeSatb || !slice.notes.bass) return;
  const notes = activeNotes(slice).map(({ note }) => note);
  const duration = slice.endTick - slice.tick;
  const bass = slice.notes.bass.pitch;
  if (notes.some(note => note.startTick !== slice.tick || note.durationTicks !== duration ||
      note.nonChordToneRole || toMidi(note.pitch) < toMidi(bass))) return;

  const { chord } = slice;
  if (chord) {
    const { structure } = chord.identity;
    if (structure.kind !== "tertian" || structure.quality !== "halfDiminished7" ||
        structure.extensions.length || structure.alterations.length || !pitchClassEquals(chord.identity.bass, bass) ||
        chord.semantics?.cadenceRole || chord.semantics?.pedalContext || chord.semantics?.mixture) return;
  }

  for (const { pitch: root } of notes) {
    if (chord && !pitchClassEquals(chord.identity.root, root)) continue;
    const tones = chordToneSpellings(root, "halfDiminished7");
    const voices = notes.map(note => ({
      note,
      member: tones.findIndex((tone, index) => pitchClassEquals(tone, note.pitch) &&
        (stepIndex(tone.step) - stepIndex(root.step) + 7) % 7 === 2 * index),
    }));
    if (voices.every(voice => voice.member >= 0) && new Set(voices.map(v => v.member)).size === 4)
      return { slice, duration, root, voices };
  }
}

type Slot = NonNullable<ReturnType<typeof readHalfDiminishedSlot>>;

// As the root rises a fourth, 1/3/5/7 go to 5/7/1/3. Checking all four
// signed distances also proves that each two-slot copy lies a whole tone lower.
const semitonesByMember = [-1, 0, -1, -2] as const;

function continuesModel(previous: Slot, current: Slot) {
  return previous.slice.endTick === current.slice.tick && previous.duration === current.duration &&
    previous.slice.key.id === current.slice.key.id && previous.voices.every(({ member, note }, i) => {
      const arrival = current.voices[i];
      return arrival.member === (member + 2) % 4 &&
        toMidi(arrival.note.pitch) - toMidi(note.pitch) === semitonesByMember[member];
    });
}

function writtenRootFourth(before: Slot, after: Slot) {
  return (stepIndex(after.root.step) - stepIndex(before.root.step) + 7) % 7 === 3;
}

// Without respelling, root and third keep their letter; fifth and seventh
// descend one letter. At a flat-to-sharp change every arrival shifts one
// further letter down, at exactly the sounding pitch proved by continuesModel.
function wholeChordRespelt(before: Slot, after: Slot) {
  return before.voices.every(({ member, note }, i) =>
    writtenInterval(note.pitch, after.voices[i].note.pitch).diatonicSteps === (member < 2 ? -1 : -2));
}

/** In a chain of dominant-function sevenths, the next seventh replaces
 * the expected tonic (Spasobin ch. 56, ex. 817). Verify the actual root
 * entering the fifth of that next chord in the same part. */
export function leadingRootContinuesInHalfDiminishedChain(
  context: HarmonyRuleContext, openedAt: number, arrival: AnalysisSlice, voice: VoiceId, targetKey: KeyLike,
) {
  const first = context.sliceAt(arrival.tick - 1);
  const source = first?.notes[voice];
  if (!first || first.tick !== openedAt || !source || targetKey.mode !== "major" || !keyEquals(first.key, targetKey) ||
      !pitchClassEquals(source.pitch, leadingTonePitchClass(targetKey))) return false;
  const head = readHalfDiminishedSlot(first);
  if (!head || !pitchClassEquals(head.root, source.pitch)) return false;
  // Three statements of the two-chord model distinguish a sequence
  // from an unresolved leading seventh followed by a single similar chord.
  const tail = [...context.slices({
    overlapping: { fromTick: arrival.tick, toTick: arrival.tick + 5 * head.duration },
  })];
  if (tail.length !== 5 || crossesManualPhraseBoundary(context, first.tick, tail[4].endTick - 1)) return false;
  let previous = head;
  for (const frame of [first, ...tail]) {
    if (frame.chord?.semantics) {
      const reading = context.harmony.primaryInterpretation(frame.chord);
      if (reading.status !== "resolved" || reading.value.appliedTarget) return false;
      if (frame === first && (reading.value.degree !== 7 || reading.value.degreeAlteration !== 0 ||
          (reading.value.designation && reading.value.designation.primaryFunction !== "dominant"))) return false;
      const key = reading.value.localKey ?? frame.key;
      if (!keyEquals(key, targetKey)) return false;
    }
    if (frame === first) continue;
    const next = readHalfDiminishedSlot(frame);
    if (!next || !continuesModel(previous, next) || !writtenRootFourth(previous, next)) return false;
    previous = next;
  }
  return true;
}

/**
 * A reattack in the same part can change from the written third to the
 * seventh of the next chord. Confirm the seventh actually resolves within
 * three statements of the model before dropping the stale leading obligation.
 */
export function reattackedLeadingToneResolvesAsChainSeventh(
  context: HarmonyRuleContext, openedAt: number, arrival: AnalysisSlice, voice: VoiceId,
) {
  const fromTick = arrival.tick - 5 * (arrival.endTick - arrival.tick);
  if (fromTick < 0) return false;
  const frames = [...context.slices({ overlapping: { fromTick, toTick: arrival.endTick } })];
  if (frames.length !== 6) return false;
  const origin = frames[3];
  const repeated = frames[4];
  const firstNote = origin.notes[voice];
  const seventh = repeated.notes[voice];
  const landing = arrival.notes[voice];
  if (origin.tick !== openedAt || !firstNote || !seventh || !landing ||
      !spelledPitchEquals(firstNote.pitch, seventh.pitch)) return false;
  const motion = writtenInterval(seventh.pitch, landing.pitch);
  if (motion.diatonicSteps !== -1 || motion.semitones !== -2 ||
      crossesManualPhraseBoundary(context, frames[0].tick, arrival.endTick - 1)) return false;

  const slots = frames.map(readHalfDiminishedSlot);
  if (!slots.every((slot): slot is Slot => slot !== undefined) ||
      !slots[3].voices.some(({ note, member }) => note.id === firstNote.id && member === 1) ||
      !slots[4].voices.some(({ note, member }) => note.id === seventh.id && member === 3)) return false;

  let respelt = false;
  for (let i = 1; i < slots.length; i++) {
    const before = slots[i - 1], after = slots[i];
    if (!continuesModel(before, after)) return false;
    if (writtenRootFourth(before, after)) continue;
    // One full enharmonic respelling may corroborate the earlier model.
    if (respelt || i > 3 || !wholeChordRespelt(before, after)) return false;
    respelt = true;
  }
  return true;
}

// Spasobin, ch. 56, example 817 and keyboard exercises. Require three
// two-chord statements and a continuing link beyond every exempt arrival.
export function halfDiminishedChainArrivals(context: HarmonyRuleContext) {
  const arrivals = new Set<string>();
  for (const slots of context.slices().select(readHalfDiminishedSlot).window(6)) {
    if (!slots.every((slot): slot is Slot => slot !== undefined)) continue;
    if (!slots.every((slot, i) => i === 0 || continuesModel(slots[i - 1], slot)) ||
        crossesManualPhraseBoundary(context, slots[0].slice.tick, slots[5].slice.endTick - 1)) continue;
    for (let i = 1; i < slots.length - 1; i++) {
      const before = slots[i - 1], after = slots[i];
      if (i > 1 && wholeChordRespelt(before, after) &&
          slots.every((slot, j) => j === 0 || j === i || writtenRootFourth(slots[j - 1], slot))) {
        before.voices.forEach(({ member }, v) => {
          if (member >= 2) arrivals.add(after.voices[v].note.id);
        });
      }
    }
  }
  return arrivals;
}

function completeSupertonicSeventh(context: RuleStepContext, slice: AnalysisSlice) {
  const { chord, key, notes } = slice;
  if (!chord || !slice.completeSatb || !notes.bass || chord.semantics?.mixture || chord.semantics?.pedalContext)
    return false;
  const { identity } = chord;
  const { structure } = identity;
  if (structure.kind !== "tertian" || structure.quality !== "minor7" || structure.extensions.length ||
      structure.alterations.length || !pitchClassEquals(notes.bass.pitch, identity.bass)) return false;

  const reading = context.rules.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== 2 || reading.value.degreeAlteration !== 0 ||
      reading.value.appliedTarget) return false;
  const localKey = reading.value.localKey ?? key;
  if (localKey.mode !== "major" || !pitchClassEquals(identity.root, scaleDegreePitchClass(localKey, 2))) return false;
  const bassMidi = toMidi(notes.bass.pitch);
  const members = context.rules.harmony.chordMembersAt(slice);
  return members.every(member => member.isWrittenChordTone && !member.note.nonChordToneRole &&
    toMidi(member.note.pitch) >= bassMidi) && new Set(members.map(member => member.chordToneIndex)).size === 4;
}

/** The seventh rises to the root while that root steps down to take the seventh (chapter 21). */
export function exchangesSupertonicSeventhWithRoot(
  context: RuleStepContext,
  voice: VoiceId,
  seventhMidi: number,
  openedTick: number,
  receivers: readonly VoiceId[],
) {
  const { previous, slice } = context;
  const departure = previous?.notes[voice], arrival = slice.notes[voice];
  if (!previous?.chord || !slice.chord || !departure || !arrival ||
      toMidi(departure.pitch) !== seventhMidi || !sameChordIdentityWithoutBass(previous.chord.identity, slice.chord.identity) ||
      !pitchClassEquals(arrival.pitch, slice.chord.identity.root) ||
      !completeSupertonicSeventh(context, previous) || !completeSupertonicSeventh(context, slice) ||
      crossesManualPhraseBoundary(context.rules, openedTick, slice.tick)) return false;

  return receivers.some(receiver => {
    const handoff = writtenSeventhHandoff(context, voice, receiver, departure.pitch);
    return handoff && pitchClassEquals(handoff.partner.pitch, arrival.pitch) &&
      handoff.outgoing.diatonicSteps === 1 && handoff.outgoing.semitones === 2 &&
      handoff.incoming.diatonicSteps === -1 && handoff.incoming.semitones === -2;
  });
}

// Chapter 21 §§5–6. Cadential and passing tonic six-fours share the
// same written tones. Neither licenses this upward third in the seventh's voice.
export function seventhLeapsToUnlabelledSixFour(
  context: RuleStepContext, voice: VoiceId, openingNoteId: string | undefined, openedTick: number,
) {
  const { previous, slice, rules } = context;
  const bass = slice.notes.bass;
  if (slice.chord || !previous?.chord || !slice.completeSatb || !bass ||
      previous.key.id !== slice.key.id || slice.key.mode !== "major" ||
      previous.tick !== openedTick || previous.endTick !== slice.tick ||
      previous.chord.startTick + previous.chord.durationTicks !== slice.tick ||
      previous.notes[voice]?.id !== openingNoteId || previous.chord.semantics?.cadenceRole ||
      crossesManualPhraseBoundary(rules, openedTick, slice.endTick - 1) ||
      !completeSupertonicSeventh(context, previous)) return false;

  const { key } = slice;
  const dominant = scaleDegreePitchClass(key, 5);
  if (!pitchClassEquals(previous.chord.identity.root, scaleDegreePitchClass(key, 2)) ||
      !pitchClassEquals(previous.chord.identity.bass, scaleDegreePitchClass(key, 4)) ||
      !pitchClassEquals(bass.pitch, dominant)) return false;

  const duration = slice.endTick - slice.tick;
  const sourceDuration = previous.endTick - previous.tick;
  const stableForBeat = (at: number, length: number) => {
    const metric = rules.metric.positionAt(at);
    const measure = metric && context.analysis.metricTimeline.measures[metric.measureNumber - 1];
    return !!measure && length >= measure.beatLength;
  };
  if (!stableForBeat(previous.tick, sourceDuration) || !stableForBeat(slice.tick, duration)) return false;
  return rules.harmony.chordMembersAt(previous).every(({ voiceId, note, chordToneIndex }) => {
    const next = slice.notes[voiceId];
    if (!next || next.nonChordToneRole || note.startTick !== openedTick || note.durationTicks !== sourceDuration ||
        next.startTick !== slice.tick || next.durationTicks !== duration || toMidi(next.pitch) < toMidi(bass.pitch)) return false;
    switch (chordToneIndex) {
      case 0: return movesToWrittenTone(note.pitch, next.pitch, key.tonic, -1, -2);
      case 1: return voiceId === "bass" && movesToWrittenTone(note.pitch, next.pitch, dominant, 1, 2);
      case 2: return movesToWrittenTone(note.pitch, next.pitch, dominant, -1, -2);
      case 3: return voiceId === voice && movesToWrittenTone(note.pitch, next.pitch, scaleDegreePitchClass(key, 3), 2, 4);
      default: return false;
    }
  });
}

/** Check the functional reading against all four sounding notes at the edge.
 * The root-position V7 may omit its fifth and double its root. */
function seventhKey(
  context: HarmonyRuleContext, slice: AnalysisSlice, quality: "major7" | "dominant7",
): KeyReference | undefined {
  const chord = slice.chord;
  const bass = slice.notes.bass;
  if (!chord || !bass || !slice.completeSatb) return;
  const { root, structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.quality !== quality ||
      structure.alterations.length || structure.extensions.length ||
      !pitchClassEquals(chord.identity.bass, root) || !pitchClassEquals(bass.pitch, root)) return;

  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return;
  const { appliedTarget, confidence, designation, degree, degreeAlteration, localKey } = reading.value;
  if (appliedTarget || (confidence !== "certain" && confidence !== "probable")) return;
  const key = localKey ?? slice.key;
  const dominant = quality === "dominant7";
  if (dominant) {
    if (degree !== 5 || degreeAlteration !== 0 || designation?.kind !== "primary" ||
        designation.primaryFunction !== "dominant" || !pitchClassEquals(root, scaleDegreePitchClass(key, 5))) return;
  } else if (degree !== 2 || degreeAlteration !== -1 ||
      (designation?.kind !== "side-degree" && designation?.kind !== "neapolitan") ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, 2, -1))) return;

  const tones = chordIdentityToneSpellings(chord.identity);
  const sounding = activeNotes(slice).map(({ note }) => note);
  if (sounding.some(note => note.nonChordToneRole || toMidi(note.pitch) < toMidi(bass.pitch) ||
      !tones.some(tone => pitchClassEquals(note.pitch, tone)))) return;
  const counts = tones.map(tone => sounding.filter(note => pitchClassEquals(note.pitch, tone)).length);
  const complete = counts.every(count => count === 1);
  const [roots, thirds, fifths, sevenths] = counts;
  if (complete || (dominant && roots === 2 && thirds === 1 && fifths === 0 && sevenths === 1)) return key;
}

/** Spasobin §47.5–6, ex. 47-705. Both directions belong to the bass alone. */
export function isNeapolitanSeventhBassTritone(context: HarmonyRuleContext, transition: MelodyTransition) {
  if (transition.voiceId !== "bass" || !transition.contiguous ||
      Math.abs(transition.writtenInterval.semitones) !== 6) return false;
  const tick = transition.current.startTick;
  const source = context.sliceAt(tick - 1);
  const landing = context.sliceAt(tick);
  if (!source || !landing || source.endTick !== tick || landing.chord?.startTick !== tick ||
      source.notes.bass?.id !== transition.previous.id || landing.notes.bass?.id !== transition.current.id ||
      source.key.id !== landing.key.id || context.analysis.phraseBoundaries.some(boundary =>
        !boundary.stale && source.tick < boundary.tick && boundary.tick <= tick)) return false;

  const from = seventhKey(context, source, "major7");
  const to = seventhKey(context, landing, "dominant7");
  return !!from && !!to && keyEquals(from, to);
}

// Spasobin, ch. 12 §4: the bass of iv6 can drop a diminished seventh to V6 and resolve to i.
export function isMinorSixthChordBassLine(context: HarmonyRuleContext, transition: MelodyTransition) {
  const { voiceId, previous, current, contiguous, sameKey, writtenInterval } = transition;
  const descendingSeventh = writtenInterval.diatonicSteps === -6 && writtenInterval.semitones === -9;
  if (voiceId !== "bass" || !descendingSeventh || !contiguous || !sameKey ||
      previous.nonChordToneRole || current.nonChordToneRole) return false;

  const key = context.keyAt(previous.startTick);
  if (key?.mode !== "minor" || !pitchClassEquals(previous.pitch, scaleDegreePitchClass(key, 6))) return false;

  const next = context.notes({ voiceId, startingAfter: current.startTick }).first()?.note;
  if (!next || next.startTick !== current.startTick + current.durationTicks || next.nonChordToneRole) return false;
  const leading = leadingTonePitchClass(key);
  const step = toMidi(next.pitch) - toMidi(current.pitch);
  if (!pitchClassEquals(current.pitch, leading) || !pitchClassEquals(next.pitch, key.tonic) || step !== 1) return false;

  if (context.analysis.project.keyEvents.some(event =>
    previous.startTick < event.tick && event.tick <= next.startTick &&
    (!keyEquals(event, key))) ||
    context.analysis.phraseBoundaries.some(boundary =>
      !boundary.stale && previous.startTick < boundary.tick && boundary.tick <= next.startTick)) return false;

  const soloBass = context.analysis.project.satbTracks.every(track => track.voice === "bass" || !track.notes.length);
  return supportsBassTriad(context, key, previous, current.startTick, 4, "minor", soloBass) &&
    supportsBassTriad(context, key, current, next.startTick, 5, "major", soloBass) &&
    supportsBassTriad(context, key, next, next.startTick + 1, 1, "minor", soloBass);
}

function writtenRootTriad(context: HarmonyRuleContext, slice: AnalysisSlice, degree: 3 | 4) {
  const { chord, notes } = slice;
  if (!chord || !slice.completeSatb || !notes.bass || chord.semantics?.mixture ||
      chord.semantics?.cadenceRole || chord.semantics?.pedalContext) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || reading.value.degree !== degree ||
      reading.value.degreeAlteration !== 0 || reading.value.appliedTarget) return;
  const key = reading.value.localKey ?? slice.key;
  const { root, bass, structure } = chord.identity;
  if (key.mode === "major" && structure.kind === "tertian" && structure.quality === (degree === 3 ? "minor" : "major") &&
      !structure.extensions.length && !structure.alterations.length &&
      pitchClassEquals(root, scaleDegreePitchClass(key, degree)) && pitchClassEquals(bass, root) &&
      soundsCompleteWrittenChord(chord.identity, Object.values(notes), notes.bass)) return key;
}

/** Spasobin §24.4–5: the mediant has both tonic and dominant functions. */
export function majorMediantToSubdominant(context: HarmonyRuleContext, before: AnalysisSlice, after: AnalysisSlice) {
  if (before.endTick !== after.tick || before.key.id !== after.key.id || after.chord?.startTick !== after.tick) return;
  const sourceKey = writtenRootTriad(context, before, 3);
  if (!sourceKey) return;
  const targetKey = writtenRootTriad(context, after, 4);
  if (targetKey && pitchClassEquals(sourceKey.tonic, targetKey.tonic)) return sourceKey;
}
