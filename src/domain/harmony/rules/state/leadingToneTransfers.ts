import { chordToneSpellings } from "../../../chordModel";
import {
  keyEquals,
  isWrittenStep,
  pitchClassEquals,
  pitchClassValue,
  scaleDegreePitchClass,
  spelledPitchEquals,
  toMidi,
  type SpelledPitchClass,
  leadingTonePitchClass,
  type KeyLike,
  writtenInterval,
} from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice } from "../../analysis";
import {
  readDominantSeventhExchange,
  readWrittenDominantSeventh,
  movesToWrittenTone,
} from "../../facts/dominantMotion";
import {
  allowsWrittenTertianIdentity,
  matchesWrittenChord,
  resolvesInVoice,
  hasWrittenVoicing,
  keepsWrittenMember,
} from "../../facts/tendencyResolution";
import { readCompleteWrittenChord } from "../../facts/writtenVoicing";
import type { RuleStepContext } from "../../runtime";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/core";
import { nextWrittenVoicingChange } from "../helpers/motionHarmony";
import {
  accentedOrnamentOverWrittenTriad,
  leadingNeighborFrame,
  leadingToneSourceKey,
  ornamentsSameLeadingHarmony,
} from "./leadingToneTargets";
import type { ObligationEnvironment, ObligationSource } from "./obligation";
import type { LeadingTonePayload } from "./tendency";
import {
  leadingToneResolutionKey,
  openedSourceNote,
  currentSpanRefs,
  supportsTendencyResolutionRules,
  allowsWrittenLocalRole,
} from "./tendencyContext";

function allowsReading(rules: HarmonyRuleContext, frame: AnalysisSlice, degree: number, tonic: SpelledPitchClass) {
  const chord = frame.chord;
  if (!chord?.semantics) return true;
  const reading = rules.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved" || chord.semantics.pedalContext || chord.semantics.cadenceRole) return false;
  return reading.value.degree === degree && pitchClassEquals(leadingToneResolutionKey(frame, rules.harmony).tonic, tonic);
}

function writtenSeventh(rules: HarmonyRuleContext, frame: AnalysisSlice) {
  if (!frame.completeSatb || !frame.notes.bass) return;
  const bassMidi = toMidi(frame.notes.bass.pitch);
  if (Object.values(frame.notes).some(note => note.nonChordToneRole || toMidi(note.pitch) < bassMidi)) return;
  const chord = readWrittenDominantSeventh(frame.notes);
  return chord && allowsWrittenTertianIdentity(frame, chord.root, "dominant7") &&
    allowsReading(rules, frame, 5, chord.target) ? chord : undefined;
}

function matchesWrittenSeventh(rules: HarmonyRuleContext, frame: AnalysisSlice, root: SpelledPitchClass) {
  const reading = writtenSeventh(rules, frame);
  return !!reading && pitchClassEquals(reading.root, root);
}

function writtenTransition(environment: ObligationEnvironment<LeadingTonePayload>, semitones: -1 | 0) {
  const { context, obligation } = environment;
  const { previous, slice, transitionFromPrevious, rules } = context;
  if (!previous || !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey) return;
  const { payload, openedAt } = obligation;
  const { voiceId } = payload;
  const source = previous.notes[voiceId], landing = slice.notes[voiceId];
  const leading = { step: payload.leadingStep, alter: payload.leadingAlter };
  if (!source || !landing || !pitchClassEquals(source.pitch, leading) || toMidi(source.pitch) !== payload.leadingMidi ||
      !movesBySemitone(previous, slice, voiceId, semitones) ||
      crossesManualPhraseBoundary(rules, openedAt.tick, slice.tick)) return;
  const opened = openedSourceNote(environment);
  if (!opened || !spelledPitchEquals(opened.pitch, source.pitch)) return;
  const sourceFrames = rules.slices({ overlapping: { fromTick: openedAt.tick, toTick: slice.tick } });
  if (!sourceFrames.all(frame => {
    const note = frame.notes[voiceId];
    return !!note && !note.nonChordToneRole && spelledPitchEquals(note.pitch, opened.pitch) && keyEquals(frame.key, slice.key);
  })) return;
  const target = { step: payload.targetStep, alter: payload.targetAlter };
  return { previous, slice, rules, sourceFrames, voiceId, source, landing, target };
}

function movesBySemitone(from: AnalysisSlice, to: AnalysisSlice, voice: VoiceId, semitones: number) {
  const before = from.notes[voice], after = to.notes[voice];
  return !!before && !!after && before.startTick + before.durationTicks === to.tick &&
    after.startTick === to.tick && toMidi(after.pitch) - toMidi(before.pitch) === semitones;
}

/** Huang p. 552: keep both semitone lines through a change of spelling,
 * with another strictly written link witnessing the continuation. */
export function becomesRespelledChainSeventh(environment: ObligationEnvironment<LeadingTonePayload>) {
  const transition = writtenTransition(environment, -1);
  if (!transition) return false;
  const { previous, slice, rules, sourceFrames, voiceId, source, landing, target } = transition;
  const from = writtenSeventh(rules, previous), to = writtenSeventh(rules, slice);
  if (!from || !to || !pitchClassEquals(from.target, target) || !pitchClassEquals(source.pitch, from.third) ||
      !pitchClassEquals(landing.pitch, to.seventh) || pitchClassEquals(from.target, to.root) ||
      pitchClassValue(from.target) !== pitchClassValue(to.root)) return false;

  const otherLine = VOICE_ORDER.some(voice => voice !== voiceId &&
    pitchClassEquals(previous.notes[voice]!.pitch, from.seventh) &&
    pitchClassEquals(slice.notes[voice]!.pitch, to.third) && movesBySemitone(previous, slice, voice, -1));
  if (!otherLine || !sourceFrames.all(frame => matchesWrittenSeventh(rules, frame, from.root))) return false;
  const link = nextWrittenVoicingChange(rules, slice, frame => matchesWrittenSeventh(rules, frame, to.root));
  if (!link) return false;
  const after = writtenSeventh(rules, link.landing);
  return !!after && pitchClassEquals(after.root, to.target) &&
    VOICE_ORDER.some(voice => pitchClassEquals(link.departure.notes[voice]!.pitch, to.third) &&
      pitchClassEquals(link.landing.notes[voice]!.pitch, after.seventh) &&
      movesBySemitone(link.departure, link.landing, voice, -1) &&
      !!readDominantSeventhExchange(link.departure, link.landing, voice, to.root));
}

/** Spasobin §57.8a: the respelled diminished seventh leads to V7. The
 * old leading tone is retained as the V7 seventh and resolves downward. */
export function leavesLeadingToneAtRespelledDiminishedPivot(environment: ObligationEnvironment<LeadingTonePayload>) {
  const transition = writtenTransition(environment, 0);
  if (!transition) return false;
  const { previous, slice, rules, sourceFrames, voiceId, source, landing, target } = transition;
  if (pitchClassEquals(source.pitch, landing.pitch)) return false;
  const oldChord = readCompleteWrittenChord(previous), pivot = readCompleteWrittenChord(slice);
  if (!oldChord || !pivot || !matchesWrittenChord(slice, pivot.root, "diminished7") ||
      !pitchClassEquals(source.pitch, oldChord.root) ||
      !sourceFrames.all(frame => matchesWrittenChord(frame, oldChord.root, "diminished7") &&
        allowsReading(rules, frame, 7, target)) ||
      !VOICE_ORDER.every(voice => toMidi(previous.notes[voice]!.pitch) === toMidi(slice.notes[voice]!.pitch))) return false;

  const newTonic = scaleDegreePitchClass({ tonic: pivot.root, mode: "major" }, 2, -1);
  if (pitchClassValue(target) === pitchClassValue(newTonic) || !allowsReading(rules, slice, 7, newTonic)) return false;
  const firstLink = nextWrittenVoicingChange(rules, slice, frame =>
    matchesWrittenChord(frame, pivot.root, "diminished7") && allowsReading(rules, frame, 7, newTonic));
  const seventh = firstLink && writtenSeventh(rules, firstLink.landing);
  if (!firstLink || !seventh || !pitchClassEquals(pivot.root, seventh.third) ||
      !pitchClassEquals(seventh.target, newTonic) || !pitchClassEquals(landing.pitch, seventh.seventh)) return false;

  const { departure: pivotDeparture, landing: dominant } = firstLink;
  const pivotSeventh = chordToneSpellings(pivot.root, "diminished7")[3];
  if (!VOICE_ORDER.every(voice => pitchClassEquals(pivotDeparture.notes[voice]!.pitch, pivotSeventh)
    ? resolvesInVoice(pivotDeparture, dominant, voice, seventh.root, -1)
    : spelledPitchEquals(pivotDeparture.notes[voice]!.pitch, dominant.notes[voice]!.pitch))) return false;

  const secondLink = nextWrittenVoicingChange(rules, dominant, frame => matchesWrittenSeventh(rules, frame, seventh.root));
  const goal = secondLink && readCompleteWrittenChord(secondLink.landing);
  if (!secondLink || !goal || goal.structure.kind !== "tertian" ||
      (goal.structure.quality !== "major" && goal.structure.quality !== "minor") ||
      !pitchClassEquals(goal.root, seventh.target) ||
      !allowsWrittenTertianIdentity(secondLink.landing, goal.root, goal.structure.quality) ||
      !allowsReading(rules, secondLink.landing, 1, seventh.target)) return false;

  const { departure, landing: tonic } = secondLink;
  const third = chordToneSpellings(goal.root, goal.structure.quality)[1];
  return resolvesInVoice(departure, tonic, voiceId, third, -1) &&
    VOICE_ORDER.some(voice => pitchClassEquals(departure.notes[voice]!.pitch, seventh.third) &&
      resolvesInVoice(departure, tonic, voice, seventh.target, 1));
}

function soundingDominantQuality(frame: AnalysisSlice, root: SpelledPitchClass) {
  const bass = frame.notes.bass;
  if (!frame.completeSatb || !bass) return;
  const lowest = toMidi(bass.pitch);
  if (Object.values(frame.notes).some(note => note.nonChordToneRole || toMidi(note.pitch) < lowest)) return;
  const seventh = readWrittenDominantSeventh(frame.notes);
  if (seventh && pitchClassEquals(seventh.root, root)) return "dominant7";
  if (hasWrittenVoicing(frame, chordToneSpellings(root, "major"))) return "major";
}

function fitsWrittenDominant(rules: HarmonyRuleContext, frame: AnalysisSlice, target: KeyLike) {
  const root = scaleDegreePitchClass(target, 5);
  const quality = soundingDominantQuality(frame, root);
  const third = leadingTonePitchClass(target);
  if (!quality || Object.values(frame.notes).filter(note => pitchClassEquals(note.pitch, third)).length !== 1 ||
      !allowsWrittenTertianIdentity(frame, root, quality)) return false;
  const { chord } = frame;
  if (!chord) return true;
  const { semantics } = chord;
  return !semantics?.pedalContext && !semantics?.cadenceRole && !semantics?.mixture &&
    !semantics?.alternatives?.length && (!semantics || rules.harmony.primaryInterpretation(chord).status === "resolved") &&
    keyEquals(leadingToneResolutionKey(frame, rules.harmony), target);
}

function changesNoteAt(previous: AnalysisSlice, slice: AnalysisSlice, voice: VoiceId) {
  const before = previous.notes[voice], after = slice.notes[voice];
  return !!before && !!after && before.startTick + before.durationTicks === slice.tick && after.startTick === slice.tick;
}

function rotatesUpperVoices(previous: AnalysisSlice, slice: AnalysisSlice, from: VoiceId, receiver: VoiceId) {
  if (!previous.completeSatb || !slice.completeSatb || from === "bass" || receiver === "bass" ||
      previous.notes.bass!.id !== slice.notes.bass!.id) return false;
  const other = VOICE_ORDER.find(voice => voice !== "bass" && voice !== from && voice !== receiver)!;
  return [from, receiver, other].every(voice => changesNoteAt(previous, slice, voice)) &&
    spelledPitchEquals(previous.notes[from]!.pitch, slice.notes[receiver]!.pitch) &&
    pitchClassEquals(previous.notes[receiver]!.pitch, slice.notes[other]!.pitch) &&
    pitchClassEquals(previous.notes[other]!.pitch, slice.notes[from]!.pitch);
}

/** An exact upper-voice rotation can carry a declared dominant's target
 * into an unlabelled slice so that the receiving note opens its own obligation. */
export function inheritedLeadingToneKeyAtRotation({ previous, slice, rules, transitionFromPrevious }: RuleStepContext) {
  if (!previous?.chord || slice.chord || !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey ||
      crossesManualPhraseBoundary(rules, previous.tick, slice.tick)) return;
  const target = leadingToneResolutionKey(previous, rules.harmony);
  if (!fitsWrittenDominant(rules, previous, target) || !fitsWrittenDominant(rules, slice, target)) return;
  const third = leadingTonePitchClass(target);
  const from = VOICE_ORDER.find(voice => pitchClassEquals(previous.notes[voice]!.pitch, third))!;
  const receiver = VOICE_ORDER.find(voice => pitchClassEquals(slice.notes[voice]!.pitch, third))!;
  if (from !== receiver && rotatesUpperVoices(previous, slice, from, receiver)) return target;
}

/** A reciprocal exchange or a written rotation can pass the dominant's third
 * to a different part across a gap in the chord track. */
export function transfersLeadingToneInWrittenDominant(
  environment: ObligationEnvironment<LeadingTonePayload>, receivers: readonly VoiceId[],
) {
  const { context, obligation } = environment;
  const { previous, slice, rules, transitionFromPrevious } = context;
  if (receivers.length !== 1 || !previous || (previous.chord && slice.chord) ||
      !transitionFromPrevious?.contiguous) return false;

  const { payload, openedAt, openedBy } = obligation;
  const voice = payload.voiceId, receiver = receivers[0], tick = slice.tick;
  const leaving = previous.notes[voice];
  if (!leaving || !openedBy.noteIds?.includes(leaving.id) || !changesNoteAt(previous, slice, voice) ||
      !changesNoteAt(previous, slice, receiver) ||
      crossesManualPhraseBoundary(rules, openedAt.tick, tick)) return false;

  const target = { tonic: { step: payload.targetStep, alter: payload.targetAlter }, mode: payload.targetMode };
  const third = { step: payload.leadingStep, alter: payload.leadingAlter };
  if (!pitchClassEquals(leaving.pitch, third) || toMidi(leaving.pitch) !== payload.leadingMidi) return false;
  const reciprocal = pitchClassEquals(slice.notes[voice]!.pitch, previous.notes[receiver]!.pitch);
  if (!reciprocal && !rotatesUpperVoices(previous, slice, voice, receiver)) return false;

  // Include the opening of this particular obligation and its actual landing.
  // A later return to the same chord cannot rescue a different opening.
  if (!rules.slices({ overlapping: { fromTick: openedAt.tick, toTick: tick + 1 } }).all(frame =>
    keyEquals(frame.key, slice.key) && fitsWrittenDominant(rules, frame, target) &&
    (!reciprocal || keyEquals(leadingToneResolutionKey(frame, rules.harmony), target)))) return false;

  // The old obligation ends only when the receiver can open one for the same target.
  return reciprocal || leadingToneSource.collect(environment).some(({ payload: candidate }) =>
    candidate.voiceId === receiver && candidate.targetStep === payload.targetStep &&
    candidate.targetAlter === payload.targetAlter && candidate.targetMode === payload.targetMode);
}

function writtenEvidenceFrame(rules: HarmonyRuleContext, frame: AnalysisSlice) {
  const { chord } = frame;
  if (!chord || chord.locked || rules.analysis.project.chordTrack.locked) return frame;
  const readings = chord.semantics?.interpretations;
  return readings?.length && readings.every(reading => reading.source === "inferred")
    ? { ...frame, chord: undefined } : frame;
}

function sequenceDominantSeventh(rules: HarmonyRuleContext, frame: AnalysisSlice) {
  const written = writtenEvidenceFrame(rules, frame);
  const chord = readWrittenDominantSeventh(frame.notes);
  if (chord && allowsWrittenTertianIdentity(written, chord.root, "dominant7") &&
      Object.values(frame.notes).every(note => toMidi(note.pitch) >= toMidi(frame.notes.bass!.pitch))) return chord;
}

function minorSeventhOnBass(rules: HarmonyRuleContext, frame: AnalysisSlice, root: SpelledPitchClass) {
  return !!frame.notes.bass && pitchClassEquals(frame.notes.bass.pitch, root) &&
    matchesWrittenChord(writtenEvidenceFrame(rules, frame), root, "minor7");
}

/** A minor seventh on the local target can bridge two dominants. The old
 * leading tone still needs a diagnostic because it has not resolved upward. */
export function descendsThroughSequentialMinorSeventh(environment: ObligationEnvironment<LeadingTonePayload>) {
  const transition = writtenTransition(environment, -1);
  if (!transition) return false;
  const { previous, slice, rules, voiceId, source, landing, target } = transition;
  const dominantRoot = scaleDegreePitchClass({ tonic: target, mode: "major" }, 5);
  const inDominant = (frame: AnalysisSlice) => {
    const seventh = sequenceDominantSeventh(rules, frame);
    return (!!seventh && pitchClassEquals(seventh.root, dominantRoot)) ||
      matchesWrittenChord(writtenEvidenceFrame(rules, frame), dominantRoot, "major");
  };
  const opening = rules.sliceAt(environment.obligation.openedAt.tick);
  if (!opening || !inDominant(opening) || !inDominant(previous)) return false;

  const [, minorThird, , minorSeventh] = chordToneSpellings(target, "minor7");
  if (source.pitch.step !== landing.pitch.step || !pitchClassEquals(landing.pitch, minorSeventh) ||
      !minorSeventhOnBass(rules, slice, target)) return false;
  const conversion = nextWrittenVoicingChange(rules, slice, frame => minorSeventhOnBass(rules, frame, target));
  if (!conversion) return false;

  const { departure, landing: nextDominant } = conversion;
  const seventh = sequenceDominantSeventh(rules, nextDominant);
  if (!seventh || !pitchClassEquals(seventh.root, target) ||
      !keepsWrittenMember(departure, nextDominant, "bass") ||
      !VOICE_ORDER.some(voice => voice !== voiceId && voice !== "bass" &&
        pitchClassEquals(departure.notes[voice]!.pitch, minorThird) &&
        pitchClassEquals(nextDominant.notes[voice]!.pitch, seventh.third) &&
        movesBySemitone(departure, nextDominant, voice, 1))) return false;

  const exit = nextWrittenVoicingChange(rules, nextDominant, frame =>
    !!sequenceDominantSeventh(rules, frame) && spelledPitchEquals(nextDominant.notes.bass!.pitch, frame.notes.bass!.pitch));
  if (!exit) return false;
  const goal = writtenEvidenceFrame(rules, exit.landing);
  const goalSeventh = sequenceDominantSeventh(rules, goal);
  return (goalSeventh && pitchClassEquals(goalSeventh.root, seventh.target)) ||
    matchesWrittenChord(goal, seventh.target, "major") || matchesWrittenChord(goal, seventh.target, "minor");
}

function arrivesOnWrittenTonic(rules: HarmonyRuleContext, slice: AnalysisSlice, key: KeyLike) {
  const bass = slice.notes.bass;
  const frame = writtenEvidenceFrame(rules, slice);
  if (!bass || frame.chord?.semantics?.cadenceRole ||
      !allowsWrittenLocalRole(rules, frame, key, 1) || !allowsWrittenTertianIdentity(frame, key.tonic, key.mode)) return false;
  const tones = chordToneSpellings(key.tonic, key.mode);
  if (pitchClassEquals(bass.pitch, tones[0])) {
    return hasWrittenVoicing(frame, tones) || hasWrittenVoicing(frame, tones.slice(0, 2));
  }
  return pitchClassEquals(bass.pitch, tones[1]) && hasWrittenVoicing(frame, tones);
}

function writtenRootDominant(rules: HarmonyRuleContext, slice: AnalysisSlice, key: KeyLike) {
  const frame = writtenEvidenceFrame(rules, slice);
  const root = scaleDegreePitchClass(key, 5);
  const bass = frame.notes.bass;
  if (!bass || !pitchClassEquals(bass.pitch, root) || !allowsWrittenLocalRole(rules, frame, key, 5)) return false;
  if (matchesWrittenChord(frame, root, "major")) return true;
  const seventh = sequenceDominantSeventh(rules, frame);
  return !!seventh && pitchClassEquals(seventh.root, root);
}

function isWeakPedalPassage(
  rules: HarmonyRuleContext, before: AnalysisSlice, weak: AnalysisSlice, after: AnalysisSlice,
) {
  const position = rules.metric.positionAt(weak.tick);
  if (position?.confidence !== "certain" ||
      rules.metric.compare(rules.metric.positionAt(before.tick), position) !== "stronger" ||
      rules.metric.compare(rules.metric.positionAt(after.tick), position) !== "stronger") return false;
  return VOICE_ORDER.some(voice => {
    if (voice === "bass" || !changesNoteAt(before, weak, voice) || !changesNoteAt(weak, after, voice)) return false;
    const first = writtenInterval(before.notes[voice]!.pitch, weak.notes[voice]!.pitch);
    const second = writtenInterval(weak.notes[voice]!.pitch, after.notes[voice]!.pitch);
    return isWrittenStep(first) && isWrittenStep(second) && first.diatonicSteps === second.diatonicSteps &&
      Math.sign(first.semitones) === first.diatonicSteps && Math.sign(second.semitones) === second.diatonicSteps;
  });
}

/** The receiving part must keep the leading tone under the same sounding
 * bass note up to its semitone resolution into the tonic. */
export function transfersLeadingToneAcrossPedalPassage(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context: { rules, previous, slice: weak }, obligation: { openedAt, payload } } = environment;
  const source = openedSourceNote(environment);
  const bass = previous?.notes.bass;
  const key = { tonic: { step: payload.targetStep, alter: payload.targetAlter }, mode: payload.targetMode };
  const opening = rules.sliceAt(openedAt.tick);
  if (!opening || !writtenRootDominant(rules, opening, key) ||
      !previous || previous.endTick !== weak.tick || !source || !bass || payload.voiceId === "bass" ||
      !changesNoteAt(previous, weak, payload.voiceId) ||
      !spelledPitchEquals(previous.notes[payload.voiceId]!.pitch, source.pitch) ||
      !writtenRootDominant(rules, previous, key) || weak.notes.bass?.id !== bass.id ||
      Object.values(weak.notes).some(note => pitchClassEquals(note.pitch, source.pitch))) return false;

  const handoff = rules.sliceAt(weak.endTick);
  const exitTick = bass.startTick + bass.durationTicks;
  const tonic = rules.sliceAt(exitTick);
  if (!handoff || handoff.tick !== weak.endTick || handoff.notes.bass?.id !== bass.id ||
      !isWeakPedalPassage(rules, previous, weak, handoff) || !tonic || tonic.tick !== exitTick ||
      crossesManualPhraseBoundary(rules, openedAt.tick, exitTick) || !arrivesOnWrittenTonic(rules, tonic, key) ||
      !rules.slices({ overlapping: { fromTick: previous.tick, toTick: exitTick + 1 } })
        .all(frame => keyEquals(previous.key, frame.key))) return false;

  const receivers = VOICE_ORDER.filter(voice => {
    const note = handoff.notes[voice];
    return voice !== payload.voiceId && voice !== "bass" && !!note && !note.nonChordToneRole &&
      note.startTick === handoff.tick && toMidi(note.pitch) > toMidi(bass.pitch) && pitchClassEquals(note.pitch, source.pitch);
  });
  const departure = rules.sliceAt(exitTick - 1);
  if (receivers.length !== 1 || !departure) return false;
  const receiver = receivers[0];
  const first = handoff.notes[receiver]!;
  return rules.slices({ overlapping: { fromTick: handoff.tick, toTick: exitTick } }).all(frame => {
    const note = frame.notes[receiver];
    return frame.notes.bass?.id === bass.id && !!note && !note.nonChordToneRole &&
      spelledPitchEquals(note.pitch, first.pitch);
  }) && resolvesInVoice(departure, tonic, receiver, key.tonic, 1);
}

/** The former part may leave the dominant third as it becomes the
 * root of the written leading-tone chord in another upper voice.
 * Prove the receiving line through its first distinct attack. */
export function resolvedSameRegisterLeadingHandoff(
  environment: ObligationEnvironment<LeadingTonePayload>, receivers: readonly VoiceId[],
) {
  const { context: { previous, slice, rules, transitionFromPrevious }, obligation } = environment;
  const { payload, openedAt } = obligation;
  if (receivers.length !== 1 || !previous || payload.voiceId === "bass" ||
      !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey) return;
  const receiver = receivers[0];
  if (receiver === "bass" || !changesNoteAt(previous, slice, payload.voiceId) ||
      !changesNoteAt(previous, slice, receiver)) return;
  const from = previous.notes[payload.voiceId]!, taken = slice.notes[receiver]!;
  if (taken.nonChordToneRole || toMidi(from.pitch) !== payload.leadingMidi ||
      !spelledPitchEquals(from.pitch, taken.pitch)) return;

  const key = { tonic: { step: payload.targetStep, alter: payload.targetAlter }, mode: payload.targetMode };
  const root = leadingTonePitchClass(key);
  const receivingHarmony = (frame: AnalysisSlice) => {
    const written = writtenEvidenceFrame(rules, frame);
    const reading = leadingToneSourceKey(rules, frame);
    return (!reading || keyEquals(reading, key)) &&
      (["diminished", "halfDiminished7", "diminished7"] as const).some(quality =>
        matchesWrittenChord(written, root, quality));
  };
  if (!fitsWrittenDominant(rules, writtenEvidenceFrame(rules, previous), key) ||
      !receivingHarmony(slice)) return;
  const limit = slice.tick + 2 * rules.analysis.project.ppq;
  let sustained = taken;
  for (let attacks = 0; attacks < 3; attacks++) {
    const end = sustained.startTick + sustained.durationTicks;
    if (end > limit || crossesManualPhraseBoundary(rules, openedAt.tick, end)) return;
    const departure = rules.sliceAt(end - 1), landing = rules.sliceAt(end);
    const next = landing?.notes[receiver];
    if (!departure || !landing || !next || next.startTick !== end || next.nonChordToneRole ||
        !keyEquals(slice.key, landing.key) ||
        rules.analysis.project.keyEvents.some(event => slice.tick < event.tick && event.tick <= end) ||
        !rules.slices({ overlapping: { fromTick: sustained.startTick, toTick: end } })
          .all(frame => frame.notes[receiver]?.id === sustained.id && receivingHarmony(frame))) return;
    if (spelledPitchEquals(next.pitch, taken.pitch)) {
      sustained = next;
      continue;
    }
    if (resolvesInVoice(departure, landing, receiver, key.tonic, 1) &&
        toMidi(next.pitch) - toMidi(taken.pitch) === 1 && arrivesOnWrittenTonic(rules, landing, key))
      return { receiver, takeover: taken, resolution: next };
    return;
  }
}

/** Recover the local target of an unlabelled dominant before judging its
 * leading tone. This supplies the same obligation in blind and given input. */
function localTargetAtWrittenLink(rules: HarmonyRuleContext, slice: AnalysisSlice): KeyLike | undefined {
  if (writtenEvidenceFrame(rules, slice).chord || !slice.completeSatb || !slice.attackVoiceIds.length) return;
  const bass = slice.notes.bass!;
  const seventh = sequenceDominantSeventh(rules, slice);
  if (seventh) {
    const voice = VOICE_ORDER.find(voice => pitchClassEquals(slice.notes[voice]!.pitch, seventh.third))!;
    const lead = slice.notes[voice]!;
    const next = rules.sliceAt(lead.startTick + lead.durationTicks);
    const arrival = next?.notes[voice];
    if (next && arrival?.pitch.step === lead.pitch.step && movesBySemitone(slice, next, voice, -1) &&
        keyEquals(slice.key, next.key) && minorSeventhOnBass(rules, next, seventh.target)) {
      return { tonic: seventh.target, mode: "minor" };
    }
  }

  const written = writtenEvidenceFrame(rules, slice);
  if (!matchesWrittenChord(written, bass.pitch, "major")) return;
  const weak = rules.sliceAt(slice.endTick);
  const handoff = weak && rules.sliceAt(weak.endTick);
  if (!weak || !handoff || !isWeakPedalPassage(rules, slice, weak, handoff)) return;
  const root = scaleDegreePitchClass({ tonic: bass.pitch, mode: "major" }, 4);
  const tonic = rules.sliceAt(bass.startTick + bass.durationTicks);
  for (const mode of ["major", "minor"] as const) {
    const key = { tonic: root, mode };
    if (tonic && keyEquals(slice.key, tonic.key) && handoff.notes.bass?.id === bass.id &&
        arrivesOnWrittenTonic(rules, tonic, key)) return key;
  }

  // A nearby written dominant label can confirm the local key even when
  // the bass connection itself is broken and must fail the transfer test.
  const end = handoff.tick + rules.analysis.project.ppq;
  for (const frame of rules.slices({ overlapping: { fromTick: handoff.tick, toTick: end } })) {
    if (!frame.chord || !writtenEvidenceFrame(rules, frame).chord || !keyEquals(slice.key, frame.key)) continue;
    const target = leadingToneResolutionKey(frame, rules.harmony);
    if (pitchClassEquals(root, target.tonic) && writtenRootDominant(rules, frame, target)) return target;
  }
}

export const leadingToneSource: ObligationSource<LeadingTonePayload> = {
  id: "source.leading-tone-attacks",
  requires: ["written-pitches"],
  collect({ context, moment }) {
    const { slice, previous, transitionFromPrevious } = context;
    const chord = slice.chord;
    if (!supportsTendencyResolutionRules(context, chord)) return [];
    const targetKey = leadingToneSourceKey(context.rules, slice) ?? inheritedLeadingToneKeyAtRotation(context) ??
      localTargetAtWrittenLink(context.rules, slice);
    if (!targetKey) return [];
    const { tonic: targetTonic, mode: targetMode } = targetKey;
    const leadingTone = leadingTonePitchClass(targetKey);

    // A sustained note can acquire a tendency when the harmony changes under
    // it (for instance the seventh of Imaj7 becomes the third of V).
    const heldLeading = previous && transitionFromPrevious?.contiguous && transitionFromPrevious.sameKey &&
      VOICE_ORDER.some(voice => {
        const note = slice.notes[voice];
        return note && previous.notes[voice]?.id === note.id && pitchClassEquals(note.pitch, leadingTone);
      });
    const previousTarget = heldLeading && supportsTendencyResolutionRules(context, previous.chord)
      ? leadingToneSourceKey(context.rules, previous) : undefined;
    const canStartHeld = heldLeading && (!previousTarget || !keyEquals(previousTarget, targetKey));
    const voices = canStartHeld ? VOICE_ORDER : moment.attackedVoiceIds;
    return voices.flatMap((voiceId) => {
      const note = slice.notes[voiceId];
      if (!note || note.nonChordToneRole || !pitchClassEquals(note.pitch, leadingTone)) return [];
      if (!moment.attackedVoiceIds.includes(voiceId) && previous?.notes[voiceId]?.id !== note.id) return [];
      if (moment.attackedVoiceIds.includes(voiceId)) {
        const frame = leadingNeighborFrame(context.rules, voiceId, note);
        if (frame && (ornamentsSameLeadingHarmony(context.rules, frame) ||
            accentedOrnamentOverWrittenTriad(context.rules, frame))) return [];
      }
      return [
        {
          partitionKey: `voice:${voiceId}|target:${targetTonic.step}:${targetTonic.alter}`,
          payload: {
            voiceId,
            leadingMidi: toMidi(note.pitch),
            leadingStep: leadingTone.step,
            leadingAlter: leadingTone.alter,
            targetStep: targetTonic.step,
            targetAlter: targetTonic.alter,
            targetMode,
            sourceKeyStep: context.slice.key.tonic.step,
            sourceKeyAlter: context.slice.key.tonic.alter,
            sourceKeyMode: context.slice.key.mode,
          },
          subjectRefs: {
            voiceIds: [voiceId],
            noteIds: [note.id],
            ...currentSpanRefs(context),
          },
        },
      ];
    });
  },
};

function rootPositionMajorTriad(frame: AnalysisSlice, root: SpelledPitchClass) {
  const bass = frame.notes.bass;
  return !!bass && pitchClassEquals(bass.pitch, root) && matchesWrittenChord(frame, root, "major");
}

// Called only for complete written four-part voicings.
function upperVoiceSpan(frame: AnalysisSlice) {
  const top = toMidi(frame.notes.soprano!.pitch);
  const middle = toMidi(frame.notes.alto!.pitch);
  const bottom = toMidi(frame.notes.tenor!.pitch);
  if (bottom <= toMidi(frame.notes.bass!.pitch) || middle <= bottom || top <= middle ||
      middle - bottom > 12 || top - middle > 12) return 0;
  return top - bottom;
}

/** Spasobin §7.2, ex. 7-83: in an open-to-close V–I connection, the
 * tenor may leap from the dominant's third to the tonic's third. */
export function tenorLeapsToTonicThird(environment: ObligationEnvironment<LeadingTonePayload>) {
  const { context, obligation: { payload, openedAt } } = environment;
  const { previous, slice, rules, transitionFromPrevious } = context;
  if (payload.voiceId !== "tenor" || payload.targetMode !== "major" ||
      !previous || !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey) return false;

  const key = { tonic: { step: payload.targetStep, alter: payload.targetAlter }, mode: payload.targetMode };
  const dominant = scaleDegreePitchClass(key, 5);
  if (!rootPositionMajorTriad(previous, dominant) || !rootPositionMajorTriad(slice, key.tonic) ||
      !allowsWrittenLocalRole(rules, slice, key, 1)) return false;

  const before = previous.notes, after = slice.notes;
  const [, dominantThird, dominantFifth] = chordToneSpellings(dominant, "major");
  const tenor = before.tenor!.pitch, tonicThird = after.tenor!.pitch;
  const leap = writtenInterval(tenor, tonicThird);
  if (!pitchClassEquals(tenor, dominantThird) || toMidi(tenor) !== payload.leadingMidi ||
      !pitchClassEquals(tonicThird, scaleDegreePitchClass(key, 3)) ||
      leap.diatonicSteps !== 3 || leap.semitones !== 5) return false;

  const landingSpan = upperVoiceSpan(slice);
  const bassMove = writtenInterval(before.bass!.pitch, after.bass!.pitch);
  if (!pitchClassEquals(before.alto!.pitch, dominant) || !spelledPitchEquals(before.alto!.pitch, after.alto!.pitch) ||
      !pitchClassEquals(before.soprano!.pitch, dominantFifth) ||
      !resolvesInVoice(previous, slice, "soprano", key.tonic, -1) ||
      upperVoiceSpan(previous) <= 12 || landingSpan === 0 || landingSpan >= 12 ||
      !((bassMove.diatonicSteps === 3 && bassMove.semitones === 5) ||
        (bassMove.diatonicSteps === -4 && bassMove.semitones === -7)) ||
      crossesManualPhraseBoundary(rules, openedAt.tick, slice.tick)) return false;

  return rules.slices({ overlapping: { fromTick: openedAt.tick, toTick: slice.tick } }).all(frame => {
    const note = frame.notes.tenor;
    return !!note && spelledPitchEquals(note.pitch, tenor) && keyEquals(frame.key, slice.key) &&
      rootPositionMajorTriad(frame, dominant) && allowsWrittenLocalRole(rules, frame, key, 5);
  });
}

// Spasobin §14.4, ex. 14-195. The root goes to the tonic; the fifth and
// seventh step down in their own voices while the inner third goes to the tonic fifth.
export function supportsWrittenInnerLeadingToneDescent(
  source: AnalysisSlice, target: AnalysisSlice, dominant: SpelledPitchClass, tonic: SpelledPitchClass,
) {
  const fromBass = source.notes.bass;
  const toBass = target.notes.bass;
  if (!fromBass || !toBass || !pitchClassEquals(fromBass.pitch, dominant) ||
      !matchesWrittenChord(source, dominant, "dominant7") ||
      !(movesToWrittenTone(fromBass.pitch, toBass.pitch, tonic, 3, 5) ||
        movesToWrittenTone(fromBass.pitch, toBass.pitch, tonic, -4, -7))) return false;

  const quality = (["major", "minor"] as const).find(mode => matchesWrittenChord(target, tonic, mode));
  if (!quality) return false;

  const [, , fifth, seventh] = chordToneSpellings(dominant, "dominant7");
  const [, tonicThird] = chordToneSpellings(tonic, quality);
  const fifthVoice = VOICE_ORDER.find(voice => pitchClassEquals(source.notes[voice]!.pitch, fifth));
  const seventhVoice = VOICE_ORDER.find(voice => pitchClassEquals(source.notes[voice]!.pitch, seventh));
  return !!fifthVoice && !!seventhVoice &&
    resolvesInVoice(source, target, fifthVoice, tonic, -1) &&
    resolvesInVoice(source, target, seventhVoice, tonicThird, -1);
}
