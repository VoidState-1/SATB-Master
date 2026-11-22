import {
  chordIdentityToneSpellings,
  chordToneSpellings,
  type FunctionalTarget,
  type KeyReference,
  type ChordQuality,
  chordIdentityEquals,
} from "../../../../chordModel";
import {
  keyEquals,
  pitchClassEquals,
  scaleDegreePitchClass,
  spelledPitchEquals,
  writtenInterval,
  type SpelledPitchClass,
  toMidi,
  formatPitchClass,
  formatSpelledPitch,
  type Alteration,
} from "../../../../pitch";
import { VOICE_ORDER } from "../../../../project/voice";
import type { AnalysisSlice, MelodyTransition, AnalysisNote } from "../../../analysis";
import {
  continuesWrittenDominantSeventh,
  contextualMinorDominantTonic,
  contextualMinorSixthResolvesToFifth,
  dominantSixthInnerVoices as innerVoices,
  dominantSixthLowerVoices as lowerVoices,
  leadingToneDescendsToTonicFifth,
  movesToWrittenTone,
  resolvesDominantInnerVoice,
} from "../../../facts/dominantMotion";
import {
  hasWrittenVoicing,
  writtenCadentialSixFourExit,
  writtenDoubleDominantWindow,
  resolvesInVoice,
} from "../../../facts/tendencyResolution";
import type { RuleDiagnostic } from "../../../runtime";
import { functionalTargetMatches, isCadential64Span } from "../../connector";
import type { HarmonyRuleContext } from "../../context/createRuleContext";
import type { ConnectionView } from "../../context/views";
import { defineStatelessRule } from "../../defineRule";
import { respeltDegrees } from "../../helpers/chordVoicing";
import {
  activeNotes,
  diagnostic,
  noteEvidence,
  voiceName,
  crossesManualPhraseBoundary,
} from "../../helpers/core";

function respeltSeventhKey(context: HarmonyRuleContext, middle: AnalysisSlice) {
  const chord = middle.chord;
  if (!chord) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return;
  const { designation, appliedTarget, localKey } = reading.value;
  const key = localKey ?? middle.key;
  const kind = designation?.kind;
  if (
    key.mode !== "major" ||
    (kind !== "double-dominant-leading-tone" && kind !== "applied-leading-tone") ||
    (appliedTarget?.degree ?? (kind === "double-dominant-leading-tone" ? 5 : undefined)) !== 5
  ) return;

  const { identity } = chord;
  const { structure } = identity;
  if (
    structure.kind !== "tertian" || structure.quality !== "diminished7" ||
    structure.extensions.length !== 0 || structure.alterations.length !== 0 ||
    !pitchClassEquals(identity.root, scaleDegreePitchClass(key, 4, 1))
  ) return;

  // 第28章书186–188页，例28-423、427：原位或第一转位的重属导减七，
  // 其降III改写为升II，原声部上行半音解决到K46的三音。
  const [root, third, fifth, seventh] = chordIdentityToneSpellings(identity);
  const bass = middle.notes.bass;
  const sounding = activeNotes(middle);
  if (
    !pitchClassEquals(seventh, scaleDegreePitchClass(key, 3, -1)) ||
    (!pitchClassEquals(identity.bass, root) && !pitchClassEquals(identity.bass, third)) ||
    !bass || !pitchClassEquals(bass.pitch, identity.bass) ||
    ![root, third, fifth].every(tone => sounding.some(({ note }) =>
      !note.nonChordToneRole && pitchClassEquals(note.pitch, tone),
    ))
  ) return;

  return key;
}

export function cadentialSixFourInKey(context: HarmonyRuleContext, landing: AnalysisSlice, key: KeyReference) {
  const target = landing.chord;
  if (!target) return false;
  const targetReading = context.harmony.primaryInterpretation(target);
  if (targetReading.status !== "resolved" ||
      !keyEquals(targetReading.value.localKey ?? landing.key, key)) return false;

  const role = target.semantics?.cadenceRole;
  const cadential = role === "cadential64" ||
    (role === undefined && targetReading.value.designation?.kind === "cadential64");
  const dominant = scaleDegreePitchClass(key, 5);
  const targetStructure = target.identity.structure;
  return (
    cadential &&
    targetStructure.kind === "tertian" && targetStructure.quality === "major" &&
    targetStructure.extensions.length === 0 && targetStructure.alterations.length === 0 &&
    pitchClassEquals(target.identity.root, key.tonic) &&
    pitchClassEquals(target.identity.bass, dominant) &&
    !!landing.notes.bass && pitchClassEquals(landing.notes.bass.pitch, dominant) &&
    activeNotes(landing).some(({ note }) =>
      !note.nonChordToneRole && pitchClassEquals(note.pitch, key.tonic),
    )
  );
}

/** §28.2, ex. 28-423/427. IV falls a diminished third to written #II,
 * the respelt seventh of DDvii°, then rises in that voice to III of K64. */
export function resolvesRaisedSecondApproach(context: HarmonyRuleContext, motion: MelodyTransition) {
  const { previous, current, voiceId, writtenInterval: entry } = motion;
  if (!motion.contiguous || !motion.sameKey || voiceId === "bass" ||
      entry.diatonicSteps !== -2 || entry.semitones !== -2) return false;

  const tick = current.startTick;
  const end = tick + current.durationTicks;
  const prep = context.sliceAt(tick - 1);
  const middle = context.sliceAt(tick);
  const landing = context.sliceAt(end);
  const target = landing?.chord;
  const arrival = landing?.notes[voiceId];
  if (!prep?.chord || !middle?.notes.bass || !landing?.notes.bass || !target || !arrival ||
      arrival.startTick !== end || landing.tick !== end || prep.notes[voiceId]?.id !== previous.id ||
      middle.notes[voiceId]?.id !== current.id ||
      landing.key.id !== middle.key.id || prep.key.id !== middle.key.id ||
      context.analysis.phraseBoundaries.some(b => !b.stale && previous.startTick < b.tick && b.tick <= end)) return false;

  const reading = context.harmony.primaryInterpretation(target);
  if (reading.status !== "resolved" || reading.value.appliedTarget) return false;
  const key = reading.value.localKey ?? landing.key;
  if (key.mode !== "major" || !cadentialSixFourInKey(context, landing, key) ||
      !hasWrittenVoicing(landing, chordToneSpellings(key.tonic, "major"))) return false;
  const fourth = scaleDegreePitchClass(key, 4);
  const raisedSecond = scaleDegreePitchClass(key, 2, 1);
  if (!pitchClassEquals(previous.pitch, fourth) || !pitchClassEquals(current.pitch, raisedSecond) ||
      !pitchClassEquals(arrival.pitch, scaleDegreePitchClass(key, 3)) ||
      writtenInterval(current.pitch, arrival.pitch).semitones !== 1) return false;

  const preparation = context.harmony.primaryInterpretation(prep.chord);
  if (preparation.status !== "resolved" || !keyEquals(preparation.value.localKey ?? prep.key, key) ||
      preparation.value.appliedTarget || preparation.value.degreeAlteration !== 0 ||
      preparation.value.designation?.primaryFunction !== "subdominant") return false;
  const degree = preparation.value.degree;
  if (degree !== 4 && degree !== 2) return false;
  const quality = degree === 4 ? "major" : "minor";
  const root = scaleDegreePitchClass(key, degree);
  const from = prep.chord.identity;
  if (from.structure.kind !== "tertian" || from.structure.quality !== quality ||
      from.structure.extensions.length || from.structure.alterations.length ||
      !pitchClassEquals(from.root, root) || !prep.notes.bass || !pitchClassEquals(from.bass, prep.notes.bass.pitch) ||
      !hasWrittenVoicing(prep, chordToneSpellings(root, quality))) return false;

  const raisedFourth = scaleDegreePitchClass(key, 4, 1);
  const sixth = scaleDegreePitchClass(key, 6);
  const dominant = scaleDegreePitchClass(key, 5);
  if (!hasWrittenVoicing(middle, [raisedFourth, sixth, key.tonic, raisedSecond]) ||
      (!pitchClassEquals(middle.notes.bass.pitch, raisedFourth) && !pitchClassEquals(middle.notes.bass.pitch, sixth))) return false;
  // §28.4: of two copies of IV, one rises chromatically in its own voice;
  // the other descends a whole tone into the respelt diminished seventh.
  const leadingVoice = activeNotes(middle).find(({ note }) => pitchClassEquals(note.pitch, raisedFourth))!;
  const leadingPrep = prep.notes[leadingVoice.voiceId];
  if (!leadingPrep || !pitchClassEquals(leadingPrep.pitch, fourth) ||
      writtenInterval(leadingPrep.pitch, leadingVoice.note.pitch).semitones !== 1) return false;
  const middleKey = middle.chord ? respeltSeventhKey(context, middle) : middle.key;
  if (!middleKey || !keyEquals(middleKey, key) || (middle.chord && middle.chord.startTick !== tick)) return false;

  const bassTick = landing.notes.bass.startTick;
  if (target.startTick !== end && target.startTick !== bassTick) return false;
  if (middle.endTick !== end) {
    // The bass anticipates the cadential fourth and sixth. During the one
    // intervening sonority the two suspending upper notes must actually hold.
    const bridge = context.sliceAt(middle.endTick);
    if (!bridge?.completeSatb || bridge.tick !== bassTick || bridge.endTick !== end ||
        bridge.key.id !== middle.key.id || (bridge.chord && bridge.chord.id !== target.id) ||
        !pitchClassEquals(middle.notes.bass.pitch, raisedFourth) || bridge.notes.bass?.id !== landing.notes.bass.id) return false;
    for (const { voiceId: voice, note } of activeNotes(middle)) {
      if (voice === "bass") continue;
      const held = bridge.notes[voice];
      if (!held || held.nonChordToneRole || !spelledPitchEquals(held.pitch, note.pitch) ||
          (!pitchClassEquals(note.pitch, key.tonic) && held.id !== note.id)) return false;
    }
  } else if (bassTick !== end) return false;

  return activeNotes(middle).every(({ voiceId: voice, note }) => {
    const resolved = landing.notes[voice]!;
    if (voice === voiceId) return true;
    if (pitchClassEquals(note.pitch, key.tonic)) return spelledPitchEquals(note.pitch, resolved.pitch);
    return pitchClassEquals(resolved.pitch, dominant) &&
      writtenInterval(note.pitch, resolved.pitch).semitones === (pitchClassEquals(note.pitch, raisedFourth) ? 1 : -2);
  });
}

function readRespeltPreparation(context: HarmonyRuleContext, middle: AnalysisSlice, key: KeyReference) {
  const slice = context.sliceAt(middle.tick - 1);
  const chord = slice?.chord;
  if (!slice || !chord || slice.key.id !== middle.key.id) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status === "ambiguous" ||
      (reading.status === "resolved" && !keyEquals(reading.value.localKey ?? slice.key, key))) return;
  return { slice, chord, reading, tones: chordIdentityToneSpellings(chord.identity) };
}

function readRootDominant(
  context: HarmonyRuleContext,
  tick: number,
  key: KeyReference,
  keyId: AnalysisSlice["key"]["id"],
  dominant: SpelledPitchClass,
) {
  const slice = context.sliceAt(tick);
  const chord = slice?.chord;
  const bass = slice?.notes.bass;
  if (!slice || !chord || !bass || slice.tick !== tick || chord.startTick !== tick ||
      slice.key.id !== keyId ||
      ![bass.pitch, chord.identity.bass, chord.identity.root].every(pitch => pitchClassEquals(pitch, dominant))) return;
  const reading = context.harmony.primaryInterpretation(chord);
  const structure = chord.identity.structure;
  if (reading.status !== "resolved" || reading.value.appliedTarget || reading.value.degree !== 5 ||
      !keyEquals(reading.value.localKey ?? slice.key, key) || structure.kind !== "tertian" ||
      structure.extensions.length || structure.alterations.length ||
      (structure.quality !== "major" && structure.quality !== "dominant7")) return;
  const tones = chordToneSpellings(dominant, structure.quality);
  if (hasWrittenVoicing(slice, tones)) return { slice, reading: reading.value, omitsFifth: false };
  if (structure.quality === "dominant7" && hasWrittenVoicing(slice, [tones[0], tones[1], tones[3]])) {
    return { slice, reading: reading.value, omitsFifth: true };
  }
}

/** The first annotated slice may be an endpoint. An intervening label
 * cannot be skipped to reach a later one. */
function* throughFirstChord(context: HarmonyRuleContext, tick: number) {
  for (let slice = context.sliceAt(tick); slice; slice = context.sliceAt(slice.endTick)) {
    yield slice;
    if (slice.chord) return;
  }
}

function* throughCadentialEntry(context: HarmonyRuleContext, tick: number, key: KeyReference) {
  let landingChordId: string | undefined;
  for (let slice = context.sliceAt(tick); slice; slice = context.sliceAt(slice.endTick)) {
    if (landingChordId ? slice.chord?.id !== landingChordId :
        slice.chord && !cadentialSixFourInKey(context, slice, key)) return;
    landingChordId ??= slice.chord?.id;
    yield slice;
  }
}

function readRespeltContinuation(
  context: HarmonyRuleContext,
  middle: AnalysisSlice,
  key: KeyReference,
  { dominant }: ReturnType<typeof respeltDegrees>,
) {
  const manualBoundaries = context.analysis.phraseBoundaries
    .filter(boundary => boundary.source === "manual" && !boundary.stale).map(boundary => boundary.tick);
  const resolution = writtenDoubleDominantWindow(middle, throughCadentialEntry(context, middle.endTick, key),
    key, manualBoundaries);
  if (!resolution || !pitchClassEquals(middle.notes[resolution.voiceId]!.pitch, resolution.previous)) return;
  const { landing } = resolution;
  if (landing.chord) {
    const chord = landing.chord;
    if ((chord.startTick !== landing.tick && chord.startTick !== resolution.arrivalTicks.get("bass")) ||
        landing.endTick !== chord.startTick + chord.durationTicks ||
        !hasSingleInterpretation(landing) || !cadentialSixFourInKey(context, landing, key)) return;
    const reading = context.harmony.primaryInterpretation(chord);
    if (reading.status !== "resolved" || reading.value.appliedTarget || reading.value.degree !== 1 ||
        reading.value.degreeAlteration !== 0) return;
    return readRootDominant(context, landing.endTick, key, middle.key.id, dominant);
  }

  const exit = writtenCadentialSixFourExit(landing, throughFirstChord(context, landing.endTick), key, manualBoundaries);
  if (exit) return readRootDominant(context, exit.tick, key, middle.key.id, dominant);
}

/** §28.5, examples 28-427/428. The written #II may take the seventh's
 * place in a double-dominant preparation. Check the original voices even
 * when there is no chord annotation on that sonority. */
function targetsDominant(target: FunctionalTarget | undefined) {
  return target?.degree === 5 && target.primaryFunction === "dominant" && !target.secondaryFunction;
}

function hasSingleInterpretation(slice: AnalysisSlice) {
  return slice.chord?.semantics?.interpretations.length === 1;
}

function hasMemberRulePreparation(
  preparation: NonNullable<ReturnType<typeof readRespeltPreparation>>,
  source: AnalysisSlice,
  key: KeyReference,
  degrees: ReturnType<typeof respeltDegrees>,
) {
  const { slice, chord, reading, tones } = preparation;
  if (reading.status !== "resolved" || !hasSingleInterpretation(slice) || reading.value.degreeAlteration !== 0 ||
      !slice.notes.bass || !pitchClassEquals(slice.notes.bass.pitch, chord.identity.bass) ||
      !hasWrittenVoicing(slice, tones)) return false;

  const { root, structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.extensions.length || structure.alterations.length) return false;
  const { designation, appliedTarget, degree } = reading.value;
  if (targetsDominant(appliedTarget)) {
    return (designation?.kind === "double-dominant" || designation?.kind === "applied-dominant") &&
      degree === 5 && structure.quality === "dominant7" &&
      pitchClassEquals(root, scaleDegreePitchClass(key, 2));
  }
  if (appliedTarget || designation?.primaryFunction !== "subdominant" ||
      !(degree === 4 && structure.quality === "major" ||
        degree === 2 && (structure.quality === "minor" || structure.quality === "minor7")) ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, degree))) return false;

  const fourth = scaleDegreePitchClass(key, 4);
  return activeNotes(source).some(({ voiceId, note }) => {
    const previous = slice.notes[voiceId];
    return previous && pitchClassEquals(previous.pitch, fourth) &&
      pitchClassEquals(note.pitch, degrees.raisedFourth) &&
      writtenInterval(previous.pitch, note.pitch).semitones === 1;
  });
}

/** A labelled DDVII with a proved #II may satisfy the two written member checks. */
export function respeltDoubleDominantMember(context: HarmonyRuleContext, source: AnalysisSlice) {
  const chord = source.chord;
  if (!chord || !hasSingleInterpretation(source) || source.tick !== chord.startTick ||
      source.endTick !== chord.startTick + chord.durationTicks) return;
  const key = respeltSeventhKey(context, source);
  if (!key) return;
  const reading = context.harmony.primaryInterpretation(chord);
  if (reading.status !== "resolved") return;
  const { degree, degreeAlteration, designation, appliedTarget } = reading.value;
  if (degree !== 7 || degreeAlteration !== 0 || designation?.primaryFunction !== "dominant" ||
      (appliedTarget ? !targetsDominant(appliedTarget) : designation.kind !== "double-dominant-leading-tone")) return;

  const degrees = respeltDegrees(key);
  const preparation = readRespeltPreparation(context, source, key);
  if (!preparation || !hasMemberRulePreparation(preparation, source, key, degrees)) return;
  const arrival = readRespeltContinuation(context, source, key, degrees);
  if (!arrival || !hasSingleInterpretation(arrival.slice) ||
      context.analysis.phraseBoundaries.some(boundary =>
        boundary.source === "manual" && !boundary.stale &&
        preparation.slice.tick < boundary.tick && boundary.tick <= arrival.slice.tick)) return;

  if (arrival.reading.degreeAlteration !== 0 || arrival.reading.designation?.kind !== "primary" ||
      arrival.reading.designation.primaryFunction !== "dominant") return;
  if (arrival.omitsFifth && activeNotes(arrival.slice)
    .filter(({ note }) => pitchClassEquals(note.pitch, degrees.dominant)).length !== 2) return;

  const written = activeNotes(source).find(({ note }) => pitchClassEquals(note.pitch, degrees.raisedSecond));
  if (written) return { noteId: written.note.id, seventh: chordIdentityToneSpellings(chord.identity)[3] };
}

function hasWrittenChord(
  slice: AnalysisSlice, root: SpelledPitchClass, bass: SpelledPitchClass, quality: ChordQuality,
  allowOmittedFifth = false,
) {
  const chord = slice.chord?.identity;
  const soundingBass = slice.notes.bass;
  if (!slice.completeSatb || !soundingBass || !pitchClassEquals(soundingBass.pitch, bass) ||
      (chord && (chord.structure.kind !== "tertian" || chord.structure.quality !== quality ||
        chord.structure.extensions.length || chord.structure.alterations.length ||
        !pitchClassEquals(chord.root, root) || !pitchClassEquals(chord.bass, bass)))) return false;
  const tones = chordToneSpellings(root, quality);
  const notes = Object.values(slice.notes);
  if (!notes.every(note => !note.nonChordToneRole && toMidi(note.pitch) >= toMidi(soundingBass.pitch) &&
      tones.some(tone => pitchClassEquals(note.pitch, tone)))) return false;
  const hasTone = (tone: SpelledPitchClass) => notes.some(note => pitchClassEquals(tone, note.pitch));
  if (tones.every(hasTone)) return true;
  return allowOmittedFifth && !hasTone(tones[2]) && hasTone(tones[1]) && hasTone(tones[3]) &&
    notes.filter(note => pitchClassEquals(note.pitch, root)).length === 2;
}

function isHeldDoubleDominantFrame(
  rules: HarmonyRuleContext, slice: AnalysisSlice, key: KeyReference, leadingTone: SpelledPitchClass,
) {
  const root = scaleDegreePitchClass(key, 2);
  if (!slice.chord) return false;
  const reading = rules.harmony.primaryInterpretation(slice.chord);
  if (reading.status !== "resolved") return false;
  const { degree, degreeAlteration, appliedTarget, designation, localKey } = reading.value;
  if (!keyEquals(localKey ?? slice.key, key) || degreeAlteration !== 0 || designation?.primaryFunction !== "dominant" ||
      appliedTarget?.degree !== 5 || appliedTarget.primaryFunction !== "dominant" ||
      appliedTarget.secondaryFunction) return false;
  const kind = designation.kind;
  if (degree === 7 && (kind === "double-dominant-leading-tone" || kind === "applied-leading-tone"))
    return hasWrittenChord(slice, leadingTone, leadingTone, "diminished7");
  if (degree !== 5 || (kind !== "double-dominant" && kind !== "applied-dominant")) return false;
  return hasWrittenChord(slice, root, leadingTone, "major") ||
    hasWrittenChord(slice, root, leadingTone, "dominant7");
}

function hasRootPositionDominant(
  rules: HarmonyRuleContext, connection: ConnectionView, slice: AnalysisSlice, key: KeyReference,
) {
  const target = rules.spanAt(slice.tick);
  if (!slice.chord || !target || target.span.fromTick !== slice.tick ||
      !functionalTargetMatches(rules.analysis, connection.source.span.id, target.span.id,
        { degree: 5, primaryFunction: "dominant" })) return false;
  const reading = rules.harmony.primaryInterpretation(slice.chord);
  if (reading.status !== "resolved" || reading.value.appliedTarget ||
      !keyEquals(reading.value.localKey ?? slice.key, key)) return false;
  const dominant = scaleDegreePitchClass(key, 5);
  return hasWrittenChord(slice, dominant, dominant, "major") ||
    hasWrittenChord(slice, dominant, dominant, "dominant7", true);
}

function boundedByOneMeasure(rules: HarmonyRuleContext, from: number, to: number) {
  const measure = rules.analysis.metricTimeline.measures.find(m => m.startTick <= from && from < m.endTick);
  return !!measure && to - from <= measure.endTick - measure.startTick;
}

/** The bass of DD6/DD65 and the root of DDvii7 can be the same held
 * leading tone of V. Spasobin ch. 28 §§2,5 and ch. 29 ex. 29-445(8)
 * show the shared target and the K46 route. Require its actual arrival
 * before excusing an internal G.2 boundary. */
export function isProvenHeldDoubleDominantContinuation(rules: HarmonyRuleContext, connection: ConnectionView) {
  const { sourceBoundary, targetBoundary } = connection;
  const bass = sourceBoundary.notes.bass;
  if (!sourceBoundary.chord || !bass || bass.id !== targetBoundary.notes.bass?.id ||
      bass.startTick >= targetBoundary.tick) return false;
  const sourceReading = rules.harmony.primaryInterpretation(sourceBoundary.chord);
  if (sourceReading.status !== "resolved") return false;
  const key = sourceReading.value.localKey ?? sourceBoundary.key;
  return resolvesHeldLeadingBass(rules, bass, key, sourceBoundary, connection);
}

function resolvesHeldLeadingBass(
  rules: HarmonyRuleContext, bass: AnalysisNote, key: KeyReference, sourceBoundary: AnalysisSlice,
  connection: ConnectionView,
) {
  const leadingTone = scaleDegreePitchClass(key, 4, 1);
  const arrivalTick = bass.startTick + bass.durationTicks;
  if (!pitchClassEquals(bass.pitch, leadingTone) ||
      !boundedByOneMeasure(rules, bass.startTick, arrivalTick)) return false;

  const chain = rules.slices({ overlapping: { fromTick: bass.startTick, toTick: arrivalTick } });
  if (chain.any(slice => slice.notes.bass?.id !== bass.id ||
      !isHeldDoubleDominantFrame(rules, slice, key, leadingTone))) return false;

  const arrival = rules.sliceAt(arrivalTick);
  const arrivalBass = arrival?.notes.bass;
  if (!arrival || arrival.tick !== arrivalTick || !arrivalBass || arrivalBass.startTick !== arrivalTick) return false;
  const motion = writtenInterval(bass.pitch, arrivalBass.pitch);
  if (motion.diatonicSteps !== 1 || motion.semitones !== 1 ||
      !pitchClassEquals(arrivalBass.pitch, scaleDegreePitchClass(key, 5))) return false;

  let endTick = arrivalTick;
  if (!hasRootPositionDominant(rules, connection, arrival, key)) {
    const sixFour = rules.spanAt(arrivalTick);
    if (!sixFour || sixFour.span.fromTick !== arrivalTick || !isCadential64Span(sixFour.span) ||
        !boundedByOneMeasure(rules, arrivalTick, sixFour.span.toTick)) return false;
    const role = sixFour.span.semantics?.cadenceRole;
    if (role && role !== "cadential64") return false;
    const reading = rules.harmony.primaryInterpretation(sixFour.span);
    if (reading.status !== "resolved" || reading.value.appliedTarget || reading.value.degree !== 1 ||
        !keyEquals(reading.value.localKey ?? arrival.key, key)) return false;
    if (!sixFour.slices.every(slice => !!slice.chord && hasWrittenChord(slice, key.tonic, arrivalBass.pitch, key.mode) &&
        !!slice.notes.bass && spelledPitchEquals(slice.notes.bass.pitch, arrivalBass.pitch))) return false;
    endTick = sixFour.span.toTick;
    const dominant = rules.sliceAt(endTick);
    if (!dominant || dominant.tick !== endTick || !dominant.notes.bass ||
        !spelledPitchEquals(dominant.notes.bass.pitch, arrivalBass.pitch) ||
        !hasRootPositionDominant(rules, connection, dominant, key)) return false;
  }
  return !rules.analysis.project.keyEvents.some(event =>
    bass.startTick < event.tick && event.tick <= endTick && !keyEquals(event, sourceBoundary.key)) &&
    !rules.analysis.phraseBoundaries.some(boundary =>
      !boundary.stale && bass.startTick < boundary.tick && boundary.tick <= endTick);
}

const RULE_ID = "resolution.altered-dominant-fifth";

function findUnresolvedFifths(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const target of context.slices()) {
    const source = context.sliceAt(target.tick - 1);
    const bass = source?.notes.bass;
    if (!source?.completeSatb || !target.completeSatb || !bass ||
      source.key.id !== target.key.id || crossesManualPhraseBoundary(context, source.tick, target.tick)) continue;

    const tonic = scaleDegreePitchClass({ tonic: bass.pitch, mode: "major" }, 4);
    if (!pitchClassEquals(target.notes.bass!.pitch, tonic)) continue;
    const [root, third, fifth, seventh] = chordToneSpellings(bass.pitch, "dominant7");
    const seventhVoice = VOICE_ORDER.find(voice => pitchClassEquals(source.notes[voice]!.pitch, seventh));
    if (!seventhVoice) continue;

    for (const direction of [-1, 1] as const) {
      const alteration = fifth.alter + direction;
      if (alteration < -2 || alteration > 2) continue;
      const alteredFifth = { step: fifth.step, alter: alteration as Alteration };
      if (!hasWrittenVoicing(source, [root, third, alteredFifth, seventh])) continue;

      // Require the independent resolution of the seventh. The receiving tonic
      // may omit its fifth, as in the doubled-third voicing in §46.
      for (const quality of direction === 1 ? ["major"] as const : ["major", "minor"] as const) {
        const tonicTones = chordToneSpellings(tonic, quality);
        const tonicThird = tonicTones[1];
        if (!resolvesInVoice(source, target, seventhVoice, tonicThird, -1) ||
          (!hasWrittenVoicing(target, tonicTones) && !hasWrittenVoicing(target, [tonic, tonicThird]))) continue;

        const voice = VOICE_ORDER.find(part => pitchClassEquals(source.notes[part]!.pitch, alteredFifth))!;
        const from = source.notes[voice]!, to = target.notes[voice]!;
        const destination = direction === 1 ? tonicThird : tonic;
        if (from.startTick + from.durationTicks !== target.tick || to.startTick !== target.tick ||
          resolvesInVoice(source, target, voice, destination, direction)) continue;

        const name = voiceName(context.analysis, voice);
        const chordIds = source.chord && target.chord ? [source.chord.id, target.chord.id] : [];
        const motion = direction === 1 ? "上行至主和弦三音" : "下行至主和弦根音";
        diagnostics.push(diagnostic(RULE_ID, target.tick, target.endTick, [voice], [from, to],
          "属和弦变五音未解决",
          `${name}的属和弦变五音 ${formatSpelledPitch(from.pitch)} 应级进${motion} ${formatPitchClass(destination)}，实际到达 ${formatSpelledPitch(to.pitch)}。`,
          { chordIds, params: { direction, destination: formatPitchClass(destination) },
            evidence: [
              noteEvidence(from, name),
              noteEvidence(to, name),
              noteEvidence(source.notes[seventhVoice]!, "属七音"),
              noteEvidence(target.notes[seventhVoice]!, "七音落点"),
            ] },
        ));
      }
    }
  }
  return diagnostics;
}

export const ALTERED_DOMINANT_FIFTH_RESOLUTION_RULE = defineStatelessRule({
  id: RULE_ID,
  catalogNumber: "E.6",
  label: "属和弦变五音未解决",
  description: "检查实写变五音属七和弦进入目标主和弦时，变五音是否在原声部按方向级进解决。",
  rationale: "升五音上行半音到大调主和弦三音，降五音下行半音到主和弦根音。",
  group: "resolution",
  defaultSeverity: "warning",
  requires: ["written-pitches"],
  dependencyScope: "phrase",
  coveredRuleIds: ["resolution.altered-tone"],
  evaluate: findUnresolvedFifths,
});

type SixthRuleContext = Pick<HarmonyRuleContext, "analysis" | "sliceAt">;

function hasPlainRootPosition(slice: AnalysisSlice, degree: 1 | 5, quality: ChordQuality, allowWrittenSixth = false) {
  const { chord, key } = slice;
  const bass = slice.notes.bass;
  if (!chord || !bass || !slice.completeSatb || Object.values(slice.notes).some(note => note.nonChordToneRole)) return false;

  const { root, structure } = chord.identity;
  if (structure.kind !== "tertian" || structure.quality !== quality ||
      (structure.extensions.length && !(allowWrittenSixth && structure.extensions.length === 1 && structure.extensions[0] === 6)) ||
      structure.alterations.length ||
      !pitchClassEquals(root, scaleDegreePitchClass(key, degree)) ||
      !pitchClassEquals(root, chord.identity.bass) || !pitchClassEquals(root, bass.pitch)) return false;

  const { semantics } = chord;
  if (!semantics) return true;
  if (semantics.pedalContext || semantics.mixture || semantics.cadenceRole ||
      semantics.interpretations.length !== 1 || semantics.alternatives?.length) return false;
  const [interpretation] = semantics.interpretations;
  const { localKey, designation } = interpretation;
  return (interpretation.confidence === "certain" || interpretation.confidence === "probable") &&
    interpretation.degree === degree && interpretation.degreeAlteration === 0 && !interpretation.appliedTarget &&
    (!localKey || keyEquals(localKey, key)) &&
    (!designation || (designation.kind === "primary" &&
      designation.primaryFunction === (degree === 5 ? "dominant" : "tonic")));
}

export function resolvesContextualMinorDominantSixth(source: AnalysisSlice, context: SixthRuleContext) {
  const soprano = source.notes.soprano;
  if (!soprano) return false;
  const onset = context.sliceAt(soprano.startTick);
  const chord = onset?.chord;
  if (!onset || !chord) return false;
  const fifth = context.sliceAt(soprano.startTick + soprano.durationTicks);
  const fifthNote = fifth?.notes.soprano;
  if (!fifth?.chord || !fifthNote || !chordIdentityEquals(chord.identity, fifth.chord.identity)) return false;
  const landing = context.sliceAt(fifthNote.startTick + fifthNote.durationTicks);
  if (!landing?.chord || onset.key.id !== fifth.key.id || fifth.key.id !== landing.key.id ||
      crossesManualPhraseBoundary(context, onset.tick, landing.tick)) return false;

  const opening = contextualMinorDominantTonic(chord, onset.key);
  if (!opening || !contextualMinorSixthResolvesToFifth(onset, fifth, landing, opening.tonic, opening.applied)) return false;
  const arrivalRoot = opening.applied ? scaleDegreePitchClass({ tonic: opening.tonic, mode: "minor" }, 6) : opening.tonic;
  const { root, bass, structure } = landing.chord.identity;
  if (!pitchClassEquals(root, arrivalRoot) || !pitchClassEquals(bass, arrivalRoot) ||
      structure.kind !== "tertian" || structure.quality !== (opening.applied ? "major" : "minor") ||
      structure.extensions.length || structure.alterations.length) return false;

  for (let tick = onset.tick; tick < landing.tick;) {
    const slice = context.sliceAt(tick);
    const expected = tick < fifth.tick ? onset : fifth;
    if (!slice?.chord || slice.tick !== tick || slice.key.id !== onset.key.id ||
        !chordIdentityEquals(chord.identity, slice.chord.identity) ||
        slice.notes.soprano?.id !== expected.notes.soprano?.id ||
        !lowerVoices.every(voice => slice.notes[voice]?.id === onset.notes[voice]?.id)) return false;
    const reading = contextualMinorDominantTonic(slice.chord, slice.key);
    if (!reading || reading.applied !== opening.applied || !pitchClassEquals(reading.tonic, opening.tonic)) return false;
    tick = slice.endTick;
  }
  return true;
}

export function resolvesDominantSixthSubstitution(
  source: AnalysisSlice,
  context: SixthRuleContext,
  allowWrittenSixth = false,
) {
  if (resolvesContextualMinorDominantSixth(source, context)) return true;
  const { notes, key } = source;
  const { bass, soprano } = notes;
  if (!bass || !soprano) return false;
  const sixth = scaleDegreePitchClass(key, 3);
  if (!pitchClassEquals(soprano.pitch, sixth)) return false;
  const attackTick = soprano.startTick;
  const resolutionTick = attackTick + soprano.durationTicks;
  const following = context.sliceAt(resolutionTick);
  const arrival = following?.notes.soprano?.pitch;
  if (!following || following.tick !== resolutionTick || following.key.id !== key.id || !arrival ||
      crossesManualPhraseBoundary(context, attackTick, resolutionTick)) return false;

  // A chord-label split can subdivide the same note. Read the actual attack and
  // its whole sounding voicing before treating any of those slices as a sixth.
  for (let tick = attackTick; tick < resolutionTick;) {
    const slice = context.sliceAt(tick);
    if (!slice || slice.tick !== tick || slice.key.id !== key.id ||
        !hasPlainRootPosition(slice, 5, "dominant7", allowWrittenSixth) ||
        slice.notes.soprano?.id !== soprano.id ||
        !lowerVoices.every(voice => slice.notes[voice]?.id === notes[voice]?.id)) return false;
    tick = slice.endTick;
  }
  const newBass = bass.startTick === attackTick;
  const [, leadingTone, fifth, seventh] = chordToneSpellings(bass.pitch, "dominant7");
  const alto = notes.alto?.pitch;
  const tenor = notes.tenor?.pitch;
  if (!alto || !tenor ||
      !((pitchClassEquals(alto, leadingTone) && pitchClassEquals(tenor, seventh)) ||
        (pitchClassEquals(alto, seventh) && pitchClassEquals(tenor, leadingTone)))) return false;

  if (hasPlainRootPosition(following, 5, "dominant7")) {
    return newBass && movesToWrittenTone(soprano.pitch, arrival, fifth, -1) &&
      lowerVoices.every(voice => {
        const before = notes[voice];
        const after = following.notes[voice];
        return before && after && spelledPitchEquals(before.pitch, after.pitch);
      });
  }

  if (!hasPlainRootPosition(following, 1, key.mode) ||
      !movesToWrittenTone(soprano.pitch, arrival, key.tonic, -2)) return false;

  const tonicFifth = scaleDegreePitchClass(key, 5);
  const descendingLeading = innerVoices.some(voice => leadingToneDescendsToTonicFifth(
    notes[voice]?.pitch, following.notes[voice]?.pitch, leadingTone, tonicFifth,
  ));
  if (!newBass) {
    const previous = context.sliceAt(attackTick - 1);
    if (!descendingLeading || !previous || previous.endTick !== attackTick || previous.key.id !== key.id ||
        !hasPlainRootPosition(previous, 5, "dominant7") ||
        !continuesWrittenDominantSeventh(previous.notes, notes, bass.pitch)) return false;
    const previousAttack = Math.max(previous.key.tick, ...Object.values(previous.notes).map(note => note.startTick));
    if (crossesManualPhraseBoundary(context, previousAttack, attackTick)) return false;
  }

  return innerVoices.every(voice => resolvesDominantInnerVoice(
    notes[voice]?.pitch, following.notes[voice]?.pitch, leadingTone, seventh, key.tonic, sixth,
    tonicFifth,
  ));
}
