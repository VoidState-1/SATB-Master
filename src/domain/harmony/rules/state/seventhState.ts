import {
  chordIdentityEquals,
  chordIdentityToneSpellingForDegree,
  chordVoicingPolicy,
  identityContainsWrittenPitchClass,
  isSeventhStructure,
  chordToneSpellings,
} from "../../../chordModel";
import {
  keyEquals,
  pitchClassEquals,
  spelledPitchEquals,
  toMidi,
  scaleDegreePitchClass,
  writtenInterval,
  type SpelledPitchClass,
} from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import type { AnalysisSlice, AnalysisNote } from "../../analysis";
import { returnsByWrittenStep } from "../../facts/prolongation";
import { hasWrittenVoicing } from "../../facts/tendencyResolution";
import type { RuleStepContext } from "../../runtime";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { crossesManualPhraseBoundary, activeNotes } from "../helpers/core";
import type { ObligationEnvironment } from "./obligation";
import type { SeventhPayload } from "./tendency";
import { supportsTendencyResolutionRules } from "./tendencyContext";

function soundsWrittenChordFrame(slice: AnalysisSlice, neighborNoteId?: string) {
  const identity = slice.chord?.identity;
  const bass = slice.notes.bass;
  if (!identity || !slice.completeSatb || !bass || !pitchClassEquals(bass.pitch, identity.bass)) return false;
  const notes = Object.values(slice.notes).filter(note => note.id !== neighborNoteId);
  return notes.every(note => !note.nonChordToneRole && toMidi(note.pitch) >= toMidi(bass.pitch) &&
    identityContainsWrittenPitchClass(identity, note.pitch)) &&
    chordVoicingPolicy(identity).requiredDegrees.every(degree => {
      const tone = chordIdentityToneSpellingForDegree(identity, degree);
      return tone && notes.some(note => pitchClassEquals(note.pitch, tone));
    });
}

/** A continuous voice can gain a seventh at an independently sounded harmonic entry. */
export function preparedSeventhEntries(context: RuleStepContext): VoiceId[] {
  const { previous, slice, transitionFromPrevious } = context;
  const prior = previous?.chord, chord = slice.chord;
  if (!previous || !prior || !chord || !isSeventhStructure(chord.identity.structure) ||
      !transitionFromPrevious?.contiguous || !transitionFromPrevious.sameKey ||
      crossesManualPhraseBoundary(context.rules, previous.tick, slice.tick)) return [];

  const seventh = chordIdentityToneSpellingForDegree(chord.identity, 7);
  const priorSeventh = chordIdentityToneSpellingForDegree(prior.identity, 7);
  if (!seventh || (priorSeventh && pitchClassEquals(priorSeventh, seventh))) return [];
  const hasMotion = transitionFromPrevious.changedVoiceIds.some(voice => {
    const before = previous.notes[voice], after = slice.notes[voice];
    return before && after && !spelledPitchEquals(before.pitch, after.pitch);
  });
  if (!hasMotion || !supportsTendencyResolutionRules(context, prior) ||
      !soundsWrittenChordFrame(previous) || !soundsWrittenChordFrame(slice)) return [];
  return VOICE_ORDER.filter(voice => {
    const note = slice.notes[voice];
    return note && previous.notes[voice]?.id === note.id && pitchClassEquals(note.pitch, seventh);
  });
}

/** A weak upper neighbor over unchanged supporting voices leaves the same seventh pending. */
export function ornamentsPreparedSeventh(environment: ObligationEnvironment<SeventhPayload>) {
  const { context, obligation: { openedAt, payload } } = environment;
  const { rules, slice } = context;
  const voice = payload.voiceId;
  const neighbor = slice.notes[voice];
  if (!payload.preparedAtEntry || voice === "bass" || !neighbor ||
      toMidi(neighbor.pitch) <= payload.seventhMidi) return false;

  const start = neighbor.startTick, end = start + neighbor.durationTicks;
  const before = rules.sliceAt(start - 1), after = rules.sliceAt(end);
  const source = before?.notes[voice], returned = after?.notes[voice];
  if (!before?.chord || !after?.chord || !slice.chord || !source || !returned ||
      toMidi(source.pitch) !== payload.seventhMidi || !returnsByWrittenStep(source, neighbor, returned) ||
      !chordIdentityEquals(before.chord.identity, after.chord.identity) ||
      !supportsTendencyResolutionRules(context, after.chord)) return false;

  const seventh = chordIdentityToneSpellingForDegree(before.chord.identity, 7);
  const middle = slice.chord.identity;
  if (!seventh || !pitchClassEquals(source.pitch, seventh) || !pitchClassEquals(before.chord.identity.root, middle.root) ||
      middle.structure.kind !== "tertian" || middle.structure.extensions.length ||
      !["major", "minor", "diminished", "augmented"].includes(middle.structure.quality) ||
      !soundsWrittenChordFrame(before) || !soundsWrittenChordFrame(after) ||
      !VOICE_ORDER.every(other => other === voice || before.notes[other]?.id === after.notes[other]?.id)) return false;

  // A key restatement can split a held note. Compare the musical onsets and
  // check the intervening slices for real changes to the supporting voices.
  const preparation = Math.max(openedAt.tick, before.chord.startTick,
    ...Object.values(before.notes).map(note => note.startTick));
  if (rules.metric.compare(rules.metric.positionAt(start), rules.metric.positionAt(preparation)) !== "weaker" ||
      !keyEquals(before.key, after.key) || crossesManualPhraseBoundary(rules, preparation, end)) return false;

  const neighborId = neighbor.nonChordToneRole === "neighbor" ? neighbor.id : undefined;
  return rules.slices({ overlapping: { fromTick: preparation, toTick: end } }).all(frame => {
    if (!keyEquals(frame.key, before.key)) return false;
    if (frame.tick < start) return true;
    return !!frame.chord && chordIdentityEquals(frame.chord.identity, middle) &&
      supportsTendencyResolutionRules(context, frame.chord) &&
      soundsWrittenChordFrame(frame, neighborId) &&
      VOICE_ORDER.every(part => frame.notes[part]?.id === (part === voice ? neighbor.id : before.notes[part]?.id));
  });
}

function plainQuality(slice: AnalysisSlice, quality: "diminished7" | "dominant7") {
  const structure = slice.chord?.identity.structure;
  return structure?.kind === "tertian" && structure.quality === quality &&
    structure.extensions.length === 0 && structure.alterations.length === 0;
}

function descendsAt(before: AnalysisNote, after: AnalysisNote | undefined, tick: number, steps: 0 | -1) {
  if (!after || before.startTick + before.durationTicks !== tick || after.startTick !== tick) return false;
  const motion = writtenInterval(before.pitch, after.pitch);
  return motion.diatonicSteps === steps && motion.semitones === -1;
}

/** Spasobin §29.3, ex. 29-440a. Read the backward leading-tone motion at a
 * contiguous fully written DD leading-tone diminished seventh → V7 boundary. */
export function readDoubleDominantSeventhLanding(rules: HarmonyRuleContext, tick: number) {
  const landing = rules.sliceAt(tick);
  const source = rules.sliceAt(tick - 1);
  const dominant = landing?.chord;
  if (!landing || !source || !dominant || landing.tick !== tick || dominant.startTick !== tick ||
      source.endTick !== tick || source.key.id !== landing.key.id ||
      rules.phraseAt(source.tick)?.id !== rules.phraseAt(tick)?.id ||
      crossesManualPhraseBoundary(rules, source.tick, tick) || !plainQuality(landing, "dominant7")) return;

  const reading = rules.harmony.primaryInterpretation(dominant);
  if (reading.status !== "resolved" || reading.value.appliedTarget || reading.value.degree !== 5 ||
      reading.value.degreeAlteration !== 0 || reading.value.designation?.primaryFunction !== "dominant") return;
  const key = reading.value.localKey ?? landing.key;
  const dominantRoot = scaleDegreePitchClass(key, 5);
  const dominantTones = chordToneSpellings(dominantRoot, "dominant7");
  if (!pitchClassEquals(dominant.identity.root, dominantRoot) || !hasWrittenVoicing(landing, dominantTones) ||
      !pitchClassEquals(dominant.identity.bass, landing.notes.bass!.pitch)) return;

  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const sourceTones = chordToneSpellings(raisedFourth, "diminished7");
  if (!hasWrittenVoicing(source, sourceTones)) return;
  const annotated = source.chord;
  if (annotated) {
    const sourceReading = rules.harmony.primaryInterpretation(annotated);
    if (sourceReading.status !== "resolved" || !plainQuality(source, "diminished7") ||
        !pitchClassEquals(annotated.identity.root, raisedFourth) ||
        !pitchClassEquals(annotated.identity.bass, source.notes.bass!.pitch)) return;
    const meaning = sourceReading.value;
    const designation = meaning.designation?.kind;
    if (!keyEquals(meaning.localKey ?? source.key, key) || meaning.degree !== 7 || meaning.degreeAlteration !== 0 ||
        (designation !== "applied-leading-tone" && designation !== "double-dominant-leading-tone") ||
        (meaning.appliedTarget?.degree ?? (designation === "double-dominant-leading-tone" ? 5 : undefined)) !== 5) return;
  } else if (!keyEquals(source.key, key)) return;

  const notes = activeNotes(source);
  const leading = notes.find(({ note }) => pitchClassEquals(note.pitch, raisedFourth))!;
  const seventh = notes.find(({ note }) => pitchClassEquals(note.pitch, sourceTones[3]))!;
  const leadingArrival = landing.notes[leading.voiceId];
  const seventhArrival = landing.notes[seventh.voiceId];
  if (!leadingArrival || !seventhArrival ||
      !pitchClassEquals(leadingArrival.pitch, dominantTones[3]) ||
      !pitchClassEquals(seventhArrival.pitch, dominantTones[2]) ||
      !descendsAt(leading.note, leadingArrival, tick, 0) ||
      !descendsAt(seventh.note, seventhArrival, tick, -1) ||
      rules.keyAt(leading.note.startTick)?.id !== source.key.id ||
      crossesManualPhraseBoundary(rules, leading.note.startTick, tick)) return;

  return { source, landing, key, leading, leadingArrival, seventh, seventhArrival, dominantRoot };
}

/** Evidence for a direct handoff; chord function and the legality of either motion belong to the caller. */
export function writtenSeventhHandoff(context: RuleStepContext, voice: VoiceId, receiver: VoiceId, seventh: SpelledPitchClass) {
  const { previous, slice, rules } = context;
  const sourceChord = previous?.chord;
  const departure = previous?.notes[voice];
  const landing = slice.notes[voice];
  const partner = previous?.notes[receiver];
  const received = slice.notes[receiver];
  if (!previous || !sourceChord || !departure || !landing || !partner || !received ||
      voice === receiver || previous.endTick !== slice.tick || previous.key.id !== slice.key.id ||
      !previous.completeSatb || !slice.completeSatb ||
      landing.startTick !== slice.tick || received.startTick !== slice.tick ||
      departure.startTick + departure.durationTicks !== slice.tick || partner.startTick + partner.durationTicks !== slice.tick ||
      departure.nonChordToneRole || landing.nonChordToneRole || partner.nonChordToneRole || received.nonChordToneRole ||
      !pitchClassEquals(departure.pitch, seventh) || !pitchClassEquals(received.pitch, seventh) ||
      pitchClassEquals(partner.pitch, seventh) || pitchClassEquals(landing.pitch, seventh)) return;

  if ([previous, slice].some(frame => Object.values(frame.notes)
      .filter(note => note && pitchClassEquals(note.pitch, seventh)).length !== 1)) return;
  if (crossesManualPhraseBoundary(context, departure.startTick, slice.tick)) return;
  const fromTick = Math.max(sourceChord.startTick, departure.startTick);
  const frames = rules.slices({ overlapping: { fromTick, toTick: slice.tick } });
  if (!frames.toArray().every(frame => {
    const note = frame.notes[receiver];
    return note && !note.nonChordToneRole && spelledPitchEquals(note.pitch, partner.pitch);
  })) return;

  return { departure, landing, partner, received,
    outgoing: writtenInterval(departure.pitch, landing.pitch), incoming: writtenInterval(partner.pitch, received.pitch) };
}
