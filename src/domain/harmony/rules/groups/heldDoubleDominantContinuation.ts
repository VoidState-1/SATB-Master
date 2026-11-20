import { chordToneSpellings, type ChordQuality, type KeyReference } from "../../../chordModel";
import { keyEquals, pitchClassEquals, scaleDegreePitchClass, spelledPitchEquals, toMidi, writtenInterval, type SpelledPitchClass } from "../../../pitch";
import type { AnalysisNote, AnalysisSlice } from "../../analysis";
import { functionalTargetMatches, isCadential64Span } from "../connector";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { ConnectionView } from "../context/views";

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
