import { chordToneSpellings } from "../../../chordModel";
import {
  keyEquals,
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

export const leadingToneSource: ObligationSource<LeadingTonePayload> = {
  id: "source.leading-tone-attacks",
  requires: ["written-pitches"],
  collect({ context, moment }) {
    const { slice, previous, transitionFromPrevious } = context;
    const chord = slice.chord;
    if (!supportsTendencyResolutionRules(context, chord)) return [];
    const targetKey = leadingToneSourceKey(context.rules, slice) ?? inheritedLeadingToneKeyAtRotation(context);
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
