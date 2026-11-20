import { chordToneSpellings } from "../../../chordModel";
import {
  keyEquals, pitchClassEquals, pitchClassValue, scaleDegreePitchClass, spelledPitchEquals, toMidi, type SpelledPitchClass,
} from "../../../pitch";
import { VOICE_ORDER, type VoiceId } from "../../../project";
import type { AnalysisSlice } from "../../analysis";
import { readDominantSeventhExchange, readWrittenDominantSeventh } from "../../writtenDominantSeventh";
import { allowsWrittenTertianIdentity, matchesWrittenChord, resolvesInVoice } from "../../writtenResolution";
import { readCompleteWrittenChord } from "../../writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary } from "../helpers/phraseBoundary";
import { nextWrittenVoicingChange } from "../helpers/writtenVoicingChange";
import { leadingToneResolutionKey } from "./leadingToneTarget";
import type { ObligationEnvironment } from "./obligation";
import type { LeadingTonePayload } from "./tendency";
import { openedSourceNote } from "./tendencyContext";

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
