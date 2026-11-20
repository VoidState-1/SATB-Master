import { chordToneSpellings } from "../../../chordModel";
import {
  keyEquals, leadingTonePitchClass, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi,
  type KeyLike, type SpelledPitchClass,
} from "../../../pitch";
import { VOICE_ORDER, type VoiceId } from "../../../project";
import type { AnalysisSlice } from "../../analysis";
import type { RuleStepContext } from "../../runtime";
import { readWrittenDominantSeventh } from "../../writtenDominantSeventh";
import { allowsWrittenTertianIdentity, hasWrittenVoicing } from "../../writtenResolution";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import { leadingToneResolutionKey } from "./leadingToneTarget";
import type { ObligationEnvironment } from "./obligation";
import { leadingToneSource, type LeadingTonePayload } from "./tendency";

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
